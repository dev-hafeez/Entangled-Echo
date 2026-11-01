import { InstagramScraper } from '../scraper/instagram.js';
import { persistScrapeData } from '../lib/db-store.js';

async function run() {
  const args = process.argv.slice(2);
  const handleOrUrl = args.find((a) => !a.startsWith('--'));

  if (!handleOrUrl) {
    console.error('Usage: npm run scrape -- <handle_or_url> [--max=N] [--headed]');
    process.exit(1);
  }

  const maxArg = args.find((a) => a.startsWith('--max='));
  const maxPosts = maxArg ? parseInt(maxArg.split('=')[1], 10) : 12;
  const isHeaded = args.includes('--headed');

  console.log(`\n======================================================`);
  console.log(`Starting scrape for target: "${handleOrUrl}"`);
  console.log(`Options: maxPosts=${maxPosts}, headless=${!isHeaded}`);
  console.log(`======================================================\n`);

  const scraper = new InstagramScraper({ headless: !isHeaded });
  const startTime = Date.now();

  const { result, rawCaptures } = await scraper.scrape(handleOrUrl, {
    maxPosts,
    onProgress: (p) => {
      console.log(`[progress] Found: ${p.found} | Detailed: ${p.detailed} | Failed: ${p.failed}`);
    },
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!result.success || !result.profile) {
    console.error(`\n❌ Scrape FAILED after ${durationSec}s:`);
    console.error(`   Reason: ${result.failureReason}`);
    console.error(`   Error: ${result.error || 'N/A'}`);
    process.exit(1);
  }

  console.log(`\n✅ Scrape SUCCEEDED in ${durationSec}s!`);
  console.log(`\n--- PROFILE DATA ---`);
  console.log(`Handle:             @${result.profile.handle}`);
  console.log(`Full Name:          ${result.profile.fullName ?? 'NULL'}`);
  console.log(`Bio:                ${result.profile.bio ? JSON.stringify(result.profile.bio) : 'NULL'}`);
  console.log(`Verified:           ${result.profile.isVerified ?? 'NULL'}`);
  console.log(`Business:           ${result.profile.isBusiness ?? 'NULL'}`);
  console.log(`Category:           ${result.profile.category ?? 'NULL'}`);
  console.log(
    `Followers:          ${result.profile.followers.count ?? 'NULL'} (raw: "${result.profile.followers.rawStr}", precision: ${result.profile.followers.precision}, source: ${result.profile.followers.source})`
  );
  console.log(
    `Following:          ${result.profile.following.count ?? 'NULL'} (raw: "${result.profile.following.rawStr}", precision: ${result.profile.following.precision}, source: ${result.profile.following.source})`
  );
  console.log(
    `Posts Count:        ${result.profile.postsCount.count ?? 'NULL'} (raw: "${result.profile.postsCount.rawStr}", precision: ${result.profile.postsCount.precision}, source: ${result.profile.postsCount.source})`
  );

  console.log(`\n--- POSTS SUMMARY ---`);
  console.log(`Total Found:        ${result.postsFound}`);
  console.log(`Detailed Fetched:   ${result.postsDetailed}`);
  console.log(`Failed Details:     ${result.postsFailed}`);

  // Persist to database
  console.log(`\nPersisting to Supabase database...`);
  const { accountId } = await persistScrapeData({
    profile: result.profile,
    posts: result.posts,
    rawCaptures,
  });
  console.log(`Saved to database with account ID: ${accountId}`);

  // Report null rates on collected posts
  const posts = result.posts || [];
  if (posts.length > 0) {
    const nullLikes = posts.filter((p) => p.likesCount === null).length;
    const nullComments = posts.filter((p) => p.commentsCount === null).length;
    const nullPostedAt = posts.filter((p) => p.postedAt === null).length;
    const nullCaption = posts.filter((p) => p.caption === null).length;
    const nullViews = posts.filter((p) => p.viewsCount === null).length;

    console.log(`\n--- FIELD NULL RATES (${posts.length} posts) ---`);
    console.log(`Likes count NULL:     ${nullLikes}/${posts.length} (${((nullLikes / posts.length) * 100).toFixed(1)}%)`);
    console.log(`Comments count NULL:  ${nullComments}/${posts.length} (${((nullComments / posts.length) * 100).toFixed(1)}%)`);
    console.log(`Upload time NULL:     ${nullPostedAt}/${posts.length} (${((nullPostedAt / posts.length) * 100).toFixed(1)}%)`);
    console.log(`Caption NULL:         ${nullCaption}/${posts.length} (${((nullCaption / posts.length) * 100).toFixed(1)}%)`);
    console.log(`Views count NULL:     ${nullViews}/${posts.length} (${((nullViews / posts.length) * 100).toFixed(1)}%)`);

    console.log(`\n--- SAMPLE SCRAPED POST (Post #1) ---`);
    const p1 = posts[0];
    console.log(`Shortcode:   ${p1.shortcode}`);
    console.log(`URL:         ${p1.url}`);
    console.log(`Media Type:  ${p1.mediaType} (source: ${p1.mediaTypeSource})`);
    console.log(`Posted At:   ${p1.postedAt ?? 'NULL'} (source: ${p1.postedAtSource ?? 'NULL'})`);
    console.log(`Likes:       ${p1.likesCount ?? 'NULL'} (source: ${p1.likesSource ?? 'NULL'})`);
    console.log(`Comments:    ${p1.commentsCount ?? 'NULL'} (source: ${p1.commentsSource ?? 'NULL'})`);
    console.log(`Views:       ${p1.viewsCount ?? 'NULL'} (source: ${p1.viewsSource ?? 'NULL'})`);
    console.log(`Hashtags:    ${JSON.stringify(p1.hashtags)}`);
    console.log(`Mentions:    ${JSON.stringify(p1.mentions)}`);
    console.log(`Storage:     ${JSON.stringify(p1.storagePaths)}`);
    console.log(`Top Comments Count: ${p1.topComments.length}`);
    console.log(`Caption:     ${p1.caption ? p1.caption.slice(0, 150) + '...' : 'NULL'}`);
  }
}

run().catch((err) => {
  console.error('Fatal CLI error:', err);
  process.exit(1);
});
