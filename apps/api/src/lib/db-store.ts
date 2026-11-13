import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';
import { getSupabaseAdmin } from './supabase.js';
import { ScrapedPost, ScrapedProfile } from '../scraper/types.js';
import { writeJsonAtomic, withFileLock } from './atomic-file.js';

export async function persistScrapeData(params: {
  jobId?: string | null;
  profile: ScrapedProfile;
  posts?: ScrapedPost[];
  rawCaptures?: Array<{ captureType: string; endpointUrl: string; payload: any }>;
  sessionAuthenticated?: boolean;
}): Promise<{ accountId: string }> {
  const { profile, posts = [], rawCaptures = [], jobId, sessionAuthenticated = true } = params;

  // 1. Prepare Account Payload
  const accountPayload = {
    handle: profile.handle,
    full_name: profile.fullName,
    bio: profile.bio,
    external_link: profile.externalLink,
    avatar_url: profile.avatarUrl,
    is_verified: profile.isVerified,
    is_business: profile.isBusiness,
    category: profile.category,
    followers_count: profile.followers.count,
    followers_source: profile.followers.source,
    followers_raw_str: profile.followers.rawStr,
    followers_precision: profile.followers.precision,
    following_count: profile.following.count,
    following_source: profile.following.source,
    following_raw_str: profile.following.rawStr,
    following_precision: profile.following.precision,
    posts_count: profile.postsCount.count,
    posts_count_source: profile.postsCount.source,
    posts_count_raw_str: profile.postsCount.rawStr,
    posts_count_precision: profile.postsCount.precision,
    session_authenticated: sessionAuthenticated,
    scraper_version: '2.0.0-depth',
    last_scraped_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 2. SAVE LOCALLY FIRST (guaranteed persistent, zero timeout, 100% offline)
  let accountId: string = crypto.randomUUID();
  try {
    const profilesDir = path.join(config.localStorageDir, 'profiles');
    const postsDir = path.join(config.localStorageDir, 'posts');
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.mkdirSync(postsDir, { recursive: true });

    const localProfileFile = path.join(profilesDir, `${profile.handle}.json`);
    if (fs.existsSync(localProfileFile)) {
      try {
        const existingData = JSON.parse(fs.readFileSync(localProfileFile, 'utf-8'));
        if (existingData?.id) accountId = existingData.id;
      } catch {}
    }

    await withFileLock(localProfileFile, () => {
      writeJsonAtomic(localProfileFile, { ...accountPayload, id: accountId });
    });

    if (posts.length > 0) {
      // Annotate posts with session_authenticated and scraper_version
      const annotatedPosts = posts.map((p) => ({
        ...p,
        session_authenticated: sessionAuthenticated,
        scraper_version: '2.0.0-depth',
      }));

      // Merge with any existing posts for this account with mutual exclusion lock
      const localPostFile = path.join(postsDir, `${profile.handle}.json`);
      await withFileLock(localPostFile, () => {
        let combinedPosts = annotatedPosts;
        if (fs.existsSync(localPostFile)) {
          try {
            const oldPosts = JSON.parse(fs.readFileSync(localPostFile, 'utf-8'));
            if (Array.isArray(oldPosts)) {
              const seenCodes = new Set(annotatedPosts.map((p) => p.shortcode));
              const newOldPosts = oldPosts.filter((p: any) => p.shortcode && !seenCodes.has(p.shortcode));
              combinedPosts = [...annotatedPosts, ...newOldPosts];
            }
          } catch {}
        }
        writeJsonAtomic(localPostFile, combinedPosts);
      });
    }
    console.log(`[local-storage] Saved @${profile.handle} profile & ${posts.length} posts to local disk.`);
  } catch (localErr: any) {
    console.warn(`[local-storage] Error saving locally: ${localErr.message}`);
  }

  return { accountId };
}
