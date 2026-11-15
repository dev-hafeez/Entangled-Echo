import { InstagramScraper } from '../apps/api/dist/scraper/instagram.js';
import fs from 'fs';
import path from 'path';

interface DepthTestResult {
  handle: string;
  bucket: string;
  requestedMaxPosts: number;
  postsFound: number;
  postsDetailed: number;
  postsFailed: number;
  timeTakenMs: number;
  loginWall: boolean;
  rateLimited: boolean;
  emptyGrid: boolean;
  scrollsNeeded: boolean;
  nullCounts: {
    likes: number;
    comments: number;
    timestamp: number;
    caption: number;
  };
  sampleShortcodes: string[];
}

async function runDepthTest() {
  const targets = [
    { handle: 'shitposts.pk', bucket: 'under 100K' },
    { handle: 'softwarewithnick', bucket: '100K-1M' },
    { handle: 'techcrunch', bucket: 'over 1M' }
  ];

  const results: DepthTestResult[] = [];

  for (const t of targets) {
    console.log(`\n========================================`);
    console.log(`Starting Scraper Depth Test for: @${t.handle} (${t.bucket}) [Target max: 100]`);
    console.log(`========================================`);

    const scraper = new InstagramScraper({ headless: true });
    const startTime = Date.now();

    let lastProgress = { found: 0, detailed: 0, failed: 0 };
    const { result, rawCaptures } = await scraper.scrape(t.handle, {
      maxPosts: 100,
      onProgress: (p) => {
        if (p.detailed !== lastProgress.detailed || p.found !== lastProgress.found) {
          lastProgress = p;
          process.stdout.write(`\rProgress: Found ${p.found} | Detailed: ${p.detailed} | Failed: ${p.failed}`);
        }
      }
    });

    const elapsed = Date.now() - startTime;
    console.log(`\nCompleted in ${(elapsed / 1000).toFixed(1)}s. Success: ${result.success}`);

    const posts = result.posts || [];
    let nullLikes = 0;
    let nullComments = 0;
    let nullTimestamp = 0;
    let nullCaption = 0;

    for (const post of posts) {
      if (post.likeCount?.count === null || post.likeCount?.count === undefined) nullLikes++;
      if (post.commentCount?.count === null || post.commentCount?.count === undefined) nullComments++;
      if (!post.postedAt) nullTimestamp++;
      if (!post.captionText && post.captionText !== '') nullCaption++;
    }

    results.push({
      handle: t.handle,
      bucket: t.bucket,
      requestedMaxPosts: 100,
      postsFound: result.postsFound,
      postsDetailed: result.postsDetailed,
      postsFailed: result.postsFailed,
      timeTakenMs: elapsed,
      loginWall: result.failureReason === 'login_wall',
      rateLimited: result.failureReason === 'rate_limit',
      emptyGrid: result.postsFound === 0,
      scrollsNeeded: result.postsFound > 12,
      nullCounts: {
        likes: nullLikes,
        comments: nullComments,
        timestamp: nullTimestamp,
        caption: nullCaption,
      },
      sampleShortcodes: posts.slice(0, 5).map(p => p.shortcode),
    });
  }

  console.log('\n\n================ DEPTH TEST SUMMARY ================');
  console.log(JSON.stringify(results, null, 2));

  fs.writeFileSync('scripts/depth_test_results.json', JSON.stringify(results, null, 2));
}

runDepthTest().catch((err) => {
  console.error('Fatal depth test error:', err);
  process.exit(1);
});
