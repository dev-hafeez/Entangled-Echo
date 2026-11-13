import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.dirname(__dirname);

async function runBenchmarkAndRetryTest() {
  console.log('====================================================');
  console.log('🧪 FR-26/27/28: Publishing Latency & Retry Circuit Test');
  console.log('====================================================');

  const { schedulerService } = await import('../apps/api/dist/services/scheduler.js');
  const { notificationStore } = await import('../apps/api/dist/services/notifications.js');

  const testUserId = 'bench_user_fr26_28';
  const testFile = path.join(rootDir, 'storage', 'scheduled_posts', `${testUserId}.json`);
  const notifFile = path.join(rootDir, 'storage', 'notifications', `${testUserId}.json`);

  // Cleanup old test files
  if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  if (fs.existsSync(notifFile)) fs.unlinkSync(notifFile);

  // -----------------------------------------------------------------
  // Part 1: Measure Publish Latency over 50 scheduled posts
  // -----------------------------------------------------------------
  console.log('\n--- Part 1: Measuring Mock Publish Latency over 50 Posts ---');
  const latencies: number[] = [];
  const postIds: string[] = [];

  for (let i = 0; i < 50; i++) {
    const post = schedulerService.createPost(testUserId, {
      accountHandle: 'cristiano',
      caption: `Benchmark post #${i + 1} for publishing latency measurement`,
      scheduledTime: new Date().toISOString(),
      status: 'SCHEDULED',
    });
    postIds.push(post.id);

    const t0 = performance.now();
    await schedulerService.publishPost(post.id, testUserId, false);
    const t1 = performance.now();
    latencies.push(t1 - t0);
  }

  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const variance = latencies.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / latencies.length;
  const std = Math.sqrt(variance);
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  console.log(`Results over N = 50 runs:`);
  console.log(`  Mean Latency: ${mean.toFixed(2)} ms (std: ${std.toFixed(2)} ms)`);
  console.log(`  Median (p50): ${p50.toFixed(2)} ms`);
  console.log(`  95th % (p95): ${p95.toFixed(2)} ms`);
  console.log(`  Min / Max   : ${min.toFixed(2)} ms / ${max.toFixed(2)} ms`);

  // Verify all 50 posts reached PUBLISHED status
  for (const pid of postIds) {
    const p = schedulerService.getPost(pid, testUserId);
    if (p?.status !== 'PUBLISHED') throw new Error(`Post ${pid} failed to publish`);
    schedulerService.deletePost(pid, testUserId);
  }

  // -----------------------------------------------------------------
  // Part 2: Test Retry Exponential Back-off & FAILED Alert (Fake Clock)
  // -----------------------------------------------------------------
  console.log('\n--- Part 2: Testing Retry Back-off and FAILED Transition (Fake Clock) ---');

  const tStart = new Date('2026-11-13T12:00:00.000Z');
  const failPost = schedulerService.createPost(testUserId, {
    accountHandle: 'cristiano',
    caption: 'Forced provider failure post [fail_test]',
    scheduledTime: tStart.toISOString(),
    status: 'SCHEDULED',
  });
  console.log(`Initial post created at T0=${tStart.toISOString()}, status=${failPost.status}, retryCount=${failPost.retryCount}`);

  // Tick 1 at T0 (Attempt 1 fails)
  console.log('\n[Clock: T0 (12:00:00)] Running automated tick...');
  const tick1 = await schedulerService.runTick(tStart);
  console.log(`  Tick 1 processed: ${tick1.processed}, retrying: ${tick1.retrying}`);
  const postAfterTick1 = schedulerService.getPost(failPost.id, testUserId);
  console.log(`  Status: ${postAfterTick1?.status}, retryCount: ${postAfterTick1?.retryCount}, next scheduled: ${postAfterTick1?.scheduledTime}`);
  if (postAfterTick1?.status !== 'SCHEDULED' || postAfterTick1?.retryCount !== 1) {
    throw new Error('Tick 1 should set status=SCHEDULED and retryCount=1');
  }

  // Tick at T0 + 30s: Post should NOT be due yet
  const tEarly = new Date('2026-11-13T12:00:30.000Z');
  console.log('\n[Clock: T0 + 30s (12:00:30)] Running tick before backoff expiry...');
  const tickEarly = await schedulerService.runTick(tEarly);
  console.log(`  Tick early processed: ${tickEarly.processed} (correctly ignored, backoff holding)`);
  if (tickEarly.processed !== 0) throw new Error('Early tick should not process un-due post');

  // Tick 2 at T0 + 60s (Attempt 2 fails)
  const tTick2 = new Date(postAfterTick1.scheduledTime);
  console.log(`\n[Clock: T0 + 60s (${tTick2.toISOString()})] Running tick after backoff 1...`);
  const tick2 = await schedulerService.runTick(tTick2);
  console.log(`  Tick 2 processed: ${tick2.processed}, retrying: ${tick2.retrying}`);
  const postAfterTick2 = schedulerService.getPost(failPost.id, testUserId);
  console.log(`  Status: ${postAfterTick2?.status}, retryCount: ${postAfterTick2?.retryCount}, next scheduled: ${postAfterTick2?.scheduledTime}`);
  if (postAfterTick2?.status !== 'SCHEDULED' || postAfterTick2?.retryCount !== 2) {
    throw new Error('Tick 2 should set status=SCHEDULED and retryCount=2');
  }

  // Tick 3 at T0 + 180s (Attempt 3 fails -> final FAILED transition)
  const tTick3 = new Date(postAfterTick2.scheduledTime);
  console.log(`\n[Clock: T0 + 180s (${tTick3.toISOString()})] Running tick after backoff 2...`);
  const tick3 = await schedulerService.runTick(tTick3);
  console.log(`  Tick 3 processed: ${tick3.processed}, failed: ${tick3.failed}`);
  const postAfterTick3 = schedulerService.getPost(failPost.id, testUserId);
  console.log(`  Final Status: ${postAfterTick3?.status}, retryCount: ${postAfterTick3?.retryCount}, lastError: "${postAfterTick3?.lastError}"`);

  if (postAfterTick3?.status !== 'FAILED') throw new Error('Post should transition to FAILED after 3 attempts');

  // Verify failure notification alert was generated (FR-28)
  const notifications = notificationStore.getNotifications(testUserId);
  const failureNotif = notifications.find((n) => n.type === 'publish_failure');
  console.log(`\nFailure notification generated: ${failureNotif ? 'YES' : 'NO'}`);
  if (failureNotif) {
    console.log(`  Alert Title: "${failureNotif.title}"`);
    console.log(`  Alert Message: "${failureNotif.message}"`);
  } else {
    throw new Error('FR-28 Failure notification missing');
  }

  // Cleanup test files
  if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  if (fs.existsSync(notifFile)) fs.unlinkSync(notifFile);

  console.log('\n====================================================');
  console.log('🎉 FR-26/27/28 Test PASSED: Latency benchmarked, backoff verified, and failure alert triggered.');
  console.log('   (Note: Live Meta Graph publishing is untested; verified against official mock provider interface)');
  console.log('====================================================');
}

runBenchmarkAndRetryTest().catch((err) => {
  console.error('Test FAILED:', err);
  process.exit(1);
});
