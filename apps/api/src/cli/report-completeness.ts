import { getSupabaseAdmin } from '../lib/supabase.js';

async function run() {
  const supabase = getSupabaseAdmin();

  console.log(`\n======================================================`);
  console.log(`      ENTANGLED ECHO — DATA COMPLETENESS REPORT       `);
  console.log(`======================================================\n`);

  // Fetch all accounts
  const { data: accounts, error: accErr } = await supabase
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false });

  if (accErr) {
    console.error('Error fetching accounts:', accErr.message);
    process.exit(1);
  }

  if (!accounts || accounts.length === 0) {
    console.log('No accounts found in the database. Run a scrape first!');
    return;
  }

  console.log(`Total Accounts in Database: ${accounts.length}\n`);

  for (const acc of accounts) {
    console.log(`------------------------------------------------------`);
    console.log(`Account: @${acc.handle} (ID: ${acc.id})`);
    console.log(`Followers: ${acc.followers_count ?? 'NULL'} [source: ${acc.followers_source ?? 'NULL'}, raw: "${acc.followers_raw_str ?? ''}"]`);
    console.log(`Following: ${acc.following_count ?? 'NULL'} [source: ${acc.following_source ?? 'NULL'}]`);
    console.log(`Posts Count: ${acc.posts_count ?? 'NULL'} [source: ${acc.posts_count_source ?? 'NULL'}]`);
    console.log(`Last Scraped: ${acc.last_scraped_at ?? 'Never'}`);

    // Fetch posts for this account
    const { data: posts, error: postErr } = await supabase
      .from('posts')
      .select('id, shortcode, media_type, media_type_source, caption, caption_source, posted_at, posted_at_source, storage_paths')
      .eq('account_id', acc.id);

    if (postErr) {
      console.warn(`Error fetching posts for ${acc.handle}: ${postErr.message}`);
      continue;
    }

    const totalPosts = posts?.length || 0;
    if (totalPosts === 0) {
      console.log(`  No posts found for this account.`);
      continue;
    }

    // Fetch latest post snapshots for these posts
    const postIds = posts.map((p) => p.id);
    const { data: snapshots } = await supabase
      .from('post_snapshots')
      .select('post_id, likes_count, likes_source, comments_count, comments_source, views_count, views_source')
      .in('post_id', postIds);

    const snapshotMap = new Map<string, any>();
    if (snapshots) {
      for (const s of snapshots) {
        // keep latest
        snapshotMap.set(s.post_id, s);
      }
    }

    let realLikesCount = 0;
    let realCommentsCount = 0;
    let realTimestampCount = 0;
    let realCaptionCount = 0;
    let storedMediaCount = 0;
    let reelsCount = 0;
    let realViewsCount = 0;

    const sourceStats: Record<string, number> = {};

    for (const p of posts) {
      const snap = snapshotMap.get(p.id);

      if (snap?.likes_count !== null && snap?.likes_count !== undefined) {
        realLikesCount++;
        const src = snap.likes_source || 'unknown';
        sourceStats[src] = (sourceStats[src] || 0) + 1;
      }

      if (snap?.comments_count !== null && snap?.comments_count !== undefined) {
        realCommentsCount++;
      }

      if (p.posted_at !== null && p.posted_at !== undefined) {
        realTimestampCount++;
      }

      if (p.caption !== null && p.caption !== undefined && p.caption.trim().length > 0) {
        realCaptionCount++;
      }

      if (p.storage_paths && p.storage_paths.length > 0) {
        storedMediaCount++;
      }

      if (p.media_type === 'reel') {
        reelsCount++;
        if (snap?.views_count !== null && snap?.views_count !== undefined) {
          realViewsCount++;
        }
      }
    }

    console.log(`\n  Posts Collected: ${totalPosts}`);
    console.log(`  Real Likes:      ${realLikesCount}/${totalPosts} (${((realLikesCount / totalPosts) * 100).toFixed(1)}%) | NULL: ${totalPosts - realLikesCount} (${(((totalPosts - realLikesCount) / totalPosts) * 100).toFixed(1)}%)`);
    console.log(`  Real Comments:   ${realCommentsCount}/${totalPosts} (${((realCommentsCount / totalPosts) * 100).toFixed(1)}%) | NULL: ${totalPosts - realCommentsCount} (${(((totalPosts - realCommentsCount) / totalPosts) * 100).toFixed(1)}%)`);
    console.log(`  Real Timestamps: ${realTimestampCount}/${totalPosts} (${((realTimestampCount / totalPosts) * 100).toFixed(1)}%) | NULL: ${totalPosts - realTimestampCount} (${(((totalPosts - realTimestampCount) / totalPosts) * 100).toFixed(1)}%)`);
    console.log(`  Real Captions:   ${realCaptionCount}/${totalPosts} (${((realCaptionCount / totalPosts) * 100).toFixed(1)}%) | NULL: ${totalPosts - realCaptionCount} (${(((totalPosts - realCaptionCount) / totalPosts) * 100).toFixed(1)}%)`);
    console.log(`  Stored in Bucket: ${storedMediaCount}/${totalPosts} (${((storedMediaCount / totalPosts) * 100).toFixed(1)}%)`);
    if (reelsCount > 0) {
      console.log(`  Reel Views:      ${realViewsCount}/${reelsCount} (${((realViewsCount / reelsCount) * 100).toFixed(1)}%) | NULL: ${reelsCount - realViewsCount}`);
    }

    console.log(`  Metric Sources breakdown: ${JSON.stringify(sourceStats)}`);
  }

  console.log(`\n======================================================\n`);
}

run().catch((err) => {
  console.error('Error generating completeness report:', err);
  process.exit(1);
});
