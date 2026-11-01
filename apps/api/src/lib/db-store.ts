import { getSupabaseAdmin } from './supabase.js';
import { ScrapedPost, ScrapedProfile } from '../scraper/types.js';

export async function persistScrapeData(params: {
  jobId?: string | null;
  profile: ScrapedProfile;
  posts?: ScrapedPost[];
  rawCaptures?: Array<{ captureType: string; endpointUrl: string; payload: any }>;
}): Promise<{ accountId: string }> {
  const supabase = getSupabaseAdmin();
  const { profile, posts = [], rawCaptures = [], jobId } = params;

  // 1. Upsert Account
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
    last_scraped_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: accountRow, error: accountErr } = await supabase
    .from('accounts')
    .upsert(accountPayload, { onConflict: 'handle' })
    .select('id')
    .single();

  if (accountErr || !accountRow) {
    throw new Error(`Failed to upsert account ${profile.handle}: ${accountErr?.message}`);
  }

  const accountId = accountRow.id;

  // 2. Insert Account Snapshot (one row per scrape)
  await supabase.from('account_snapshots').insert({
    account_id: accountId,
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
  });

  // 3. Upsert Posts & Post Snapshots
  for (const p of posts) {
    const postPayload = {
      account_id: accountId,
      shortcode: p.shortcode,
      url: p.url,
      media_type: p.mediaType,
      media_type_source: p.mediaTypeSource,
      caption: p.caption,
      caption_source: p.captionSource,
      hashtags: p.hashtags,
      mentions: p.mentions,
      posted_at: p.postedAt, // STRICT: NULL if unavailable, never now!
      posted_at_source: p.postedAtSource,
      location_tag: p.locationTag,
      location_tag_source: p.locationTagSource,
      audio_name: p.audioName,
      audio_name_source: p.audioNameSource,
      media_urls: p.mediaUrls,
      storage_paths: p.storagePaths,
      carousel_size: p.carouselSize,
      updated_at: new Date().toISOString(),
    };

    const { data: postRow, error: postErr } = await supabase
      .from('posts')
      .upsert(postPayload, { onConflict: 'shortcode' })
      .select('id')
      .single();

    if (postErr || !postRow) {
      console.warn(`[db-store] Failed to upsert post ${p.shortcode}: ${postErr?.message}`);
      continue;
    }

    const postId = postRow.id;

    // Insert Post Snapshot
    await supabase.from('post_snapshots').insert({
      post_id: postId,
      likes_count: p.likesCount,
      likes_source: p.likesSource,
      likes_raw_str: p.likesRawStr,
      comments_count: p.commentsCount,
      comments_source: p.commentsSource,
      comments_raw_str: p.commentsRawStr,
      views_count: p.viewsCount,
      views_source: p.viewsSource,
      views_raw_str: p.viewsRawStr,
    });

    // Insert Comments
    if (p.topComments && p.topComments.length > 0) {
      const commentsData = p.topComments.map((c) => ({
        post_id: postId,
        comment_id: c.commentId,
        author: c.author,
        text: c.text,
        likes_count: c.likesCount,
        posted_at: c.postedAt,
        author_source: c.authorSource,
        text_source: c.textSource,
        likes_source: c.likesSource,
        posted_at_source: c.postedAtSource,
      }));
      await supabase.from('comments').insert(commentsData);
    }
  }

  // 4. Save Raw Captures
  if (rawCaptures.length > 0) {
    const rawData = rawCaptures.map((rc) => ({
      job_id: jobId || null,
      account_id: accountId,
      capture_type: rc.captureType,
      endpoint_url: rc.endpointUrl,
      payload: rc.payload,
    }));

    // Insert in batches of 20 to avoid large payload error
    for (let i = 0; i < rawData.length; i += 20) {
      const batch = rawData.slice(i, i + 20);
      await supabase.from('raw_captures').insert(batch);
    }
  }

  return { accountId };
}
