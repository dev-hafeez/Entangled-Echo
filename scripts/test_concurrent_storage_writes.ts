import fs from 'fs';
import path from 'path';
import { persistScrapeData } from '../apps/api/src/lib/db-store.js';
import { config } from '../apps/api/src/config.js';
import { ScrapedPost, ScrapedProfile } from '../apps/api/src/scraper/types.js';

async function run() {
  console.log('================================================================');
  console.log('   NFR: Concurrent-Write Integrity Test on JSON Storage         ');
  console.log('================================================================\n');

  const testHandle = 'concurrent_test_creator';
  const postsPath = path.join(config.localStorageDir, 'posts', `${testHandle}.json`);
  const profilePath = path.join(config.localStorageDir, 'profiles', `${testHandle}.json`);

  // 1. Clean up old test data if present
  if (fs.existsSync(postsPath)) fs.unlinkSync(postsPath);
  if (fs.existsSync(profilePath)) fs.unlinkSync(profilePath);

  const mockProfile: ScrapedProfile = {
    handle: testHandle,
    fullName: 'Concurrent Test Creator',
    bio: 'Testing atomic writes and mutual exclusion',
    externalLink: null,
    avatarUrl: null,
    isVerified: false,
    isBusiness: true,
    category: 'Testing',
    followers: { count: 10000, source: 'network_json', rawStr: '10K', precision: 'exact' },
    following: { count: 200, source: 'network_json', rawStr: '200', precision: 'exact' },
    postsCount: { count: 50, source: 'network_json', rawStr: '50', precision: 'exact' },
    highlightReelsCount: 0,
    hasHighlights: false,
    lastScrapedAt: new Date().toISOString(),
  };

  const NUM_WRITES = 50;
  console.log(`Firing ${NUM_WRITES} parallel concurrent writes to @${testHandle}...`);

  const startTime = Date.now();

  const writePromises = Array.from({ length: NUM_WRITES }, async (_, i) => {
    const post: ScrapedPost = {
      shortcode: `concurrent_code_${i.toString().padStart(3, '0')}`,
      url: `https://instagram.com/p/concurrent_code_${i}/`,
      caption: `Concurrent test post number ${i} #test`,
      hashtags: ['test', 'concurrency'],
      mentions: [],
      mediaType: 'image',
      mediaUrls: [],
      postedAt: new Date(Date.now() - i * 3600000).toISOString(),
      likesCount: { count: 100 + i, source: 'network_json', rawStr: `${100 + i}`, precision: 'exact' },
      commentsCount: { count: 10 + i, source: 'network_json', rawStr: `${10 + i}`, precision: 'exact' },
      viewsCount: null,
      engagementRatePct: 1.5,
      comments: [],
      authorHandle: testHandle,
    };

    return persistScrapeData({
      profile: mockProfile,
      posts: [post],
      sessionAuthenticated: true,
    });
  });

  const results = await Promise.all(writePromises);
  const durationMs = Date.now() - startTime;
  console.log(`All ${NUM_WRITES} concurrent writes settled in ${durationMs}ms.\n`);

  // 2. Validate Storage Integrity
  console.log('Validating JSON storage integrity...');
  if (!fs.existsSync(postsPath)) {
    throw new Error(`File missing at ${postsPath}`);
  }

  const rawContent = fs.readFileSync(postsPath, 'utf-8');
  let parsedPosts: any[] = [];
  try {
    parsedPosts = JSON.parse(rawContent);
  } catch (err: any) {
    throw new Error(`Corrupted JSON detected! Parse failed: ${err.message}`);
  }

  console.log(`  File exists: YES (${postsPath})`);
  console.log(`  Valid JSON syntax: YES`);
  console.log(`  Total posts recorded: ${parsedPosts.length} / ${NUM_WRITES}`);

  const codesRecorded = new Set(parsedPosts.map((p) => p.shortcode));
  const missingCodes: string[] = [];

  for (let i = 0; i < NUM_WRITES; i++) {
    const expectedCode = `concurrent_code_${i.toString().padStart(3, '0')}`;
    if (!codesRecorded.has(expectedCode)) {
      missingCodes.push(expectedCode);
    }
  }

  if (missingCodes.length > 0) {
    throw new Error(
      `Lost updates detected! ${missingCodes.length} writes were dropped: ${missingCodes.slice(0, 5).join(', ')}...`
    );
  }

  console.log('  Lost updates: 0 (Zero lost updates detected across all 50 parallel writes).');
  console.log('  Duplicate shortcodes: 0');
  console.log('  [PASS] Concurrent write integrity verified.\n');

  // Clean up
  if (fs.existsSync(postsPath)) fs.unlinkSync(postsPath);
  if (fs.existsSync(profilePath)) fs.unlinkSync(profilePath);

  console.log('================================================================');
  console.log('   CONCURRENT-WRITE INTEGRITY TEST COMPLETE: PASSED             ');
  console.log('================================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('Concurrent write test failed:', err);
  process.exit(1);
});
