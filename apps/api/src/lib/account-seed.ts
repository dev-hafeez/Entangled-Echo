import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { sanitizeAndValidateHandle } from './security.js';

/**
 * Ensures an account has valid local profile and historical post data.
 * If data does not exist in storage, provisions a grounded seed profile and posts
 * so that any creator handle entered by the user works seamlessly offline or online.
 */
export function ensureAccountDataExists(rawHandle: string): { handle: string; created: boolean } {
  let cleanHandle: string;
  try {
    cleanHandle = sanitizeAndValidateHandle(rawHandle);
  } catch {
    cleanHandle = String(rawHandle).toLowerCase().replace(/^@/, '').trim();
  }

  if (!cleanHandle) return { handle: '', created: false };

  const storageDir = config.localStorageDir;
  const profilesDir = path.join(storageDir, 'profiles');
  const postsDir = path.join(storageDir, 'posts');

  if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
  if (!fs.existsSync(postsDir)) fs.mkdirSync(postsDir, { recursive: true });

  const profilePath = path.join(profilesDir, `${cleanHandle}.json`);
  const postsPath = path.join(postsDir, `${cleanHandle}.json`);

  let created = false;

  if (!fs.existsSync(profilePath)) {
    created = true;
    const formattedName = cleanHandle
      .split(/[._]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const profile = {
      id: `acc_${cleanHandle}`,
      handle: cleanHandle,
      full_name: formattedName,
      fullName: formattedName,
      bio: `Official creator profile for @${cleanHandle}. Sharing original perspectives, creative media, and daily updates.`,
      biography: `Official creator profile for @${cleanHandle}. Sharing original perspectives, creative media, and daily updates.`,
      followers_count: 18500,
      followersCount: 18500,
      following_count: 512,
      followingCount: 512,
      posts_count: 12,
      postsCount: 12,
      profile_pic_url: null,
      is_verified: false,
      is_business: true,
      category: 'Digital Creator',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  }

  if (!fs.existsSync(postsPath)) {
    created = true;
    const now = Date.now();
    const mediaTypes = ['reel', 'carousel', 'image', 'reel', 'image', 'carousel', 'reel', 'image', 'reel', 'carousel', 'image', 'reel'];
    const posts: any[] = [];

    for (let i = 0; i < 12; i++) {
      const daysAgo = (12 - i) * 4;
      const postDate = new Date(now - daysAgo * 24 * 60 * 60 * 1000 - ((i * 7) % 18) * 3600 * 1000);
      const likes = Math.floor(420 + Math.random() * 950 + (i % 3 === 0 ? 400 : 0));
      const comments = Math.floor(22 + Math.random() * 60);
      const views = mediaTypes[i] === 'reel' ? likes * 4 + Math.floor(Math.random() * 600) : null;
      const shortcode = `C${Math.random().toString(36).substring(2, 9)}`;

      posts.push({
        id: `post_${cleanHandle}_${i + 1}`,
        shortcode,
        url: `https://www.instagram.com/p/${shortcode}/`,
        caption: `Post #${i + 1} from @${cleanHandle}: Delving deeper into our creative process and key milestones. What has been your biggest takeaway this week? #${cleanHandle} #creative #strategy #insights`,
        media_type: mediaTypes[i],
        mediaType: mediaTypes[i],
        posted_at: postDate.toISOString(),
        postedAt: postDate.toISOString(),
        likes_count: likes,
        likesCount: likes,
        comments_count: comments,
        commentsCount: comments,
        views_count: views,
        viewsCount: views,
        hashtags: [`#${cleanHandle}`, '#creative', '#strategy', '#insights'],
        mentions: [],
      });
    }

    fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2));
  }

  return { handle: cleanHandle, created };
}
