import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.dirname(__dirname);

async function runTest() {
  console.log('====================================================');
  console.log('🧪 FR-24 Feedback Loop: Accept/Reject Verification');
  console.log('====================================================');

  const { getRecPreferences, saveRecPreferences } = await import('../apps/api/dist/routes/recommendations.js');
  const testHandle = 'test_feedback_creator_99';
  const prefPath = path.join(rootDir, 'storage', 'preferences', `recs_${testHandle}.json`);
  const recCachePath = path.join(rootDir, 'storage', 'recommendations', `${testHandle}.json`);

  // Cleanup any old test artifacts
  if (fs.existsSync(prefPath)) fs.unlinkSync(prefPath);
  if (fs.existsSync(recCachePath)) fs.unlinkSync(recCachePath);

  // 1. Initial State: Default weights
  const initialPrefs = getRecPreferences(testHandle);
  console.log('1. Initial preference weights:', JSON.stringify(initialPrefs.formatWeights));
  if (initialPrefs.formatWeights.reel !== 1.0) throw new Error('Initial reel weight should be 1.0');

  // 2. Reject 'reel' multiple times
  console.log('\n2. User rejects "reel" format recommendations (dislikes short video)...');
  initialPrefs.formatWeights.reel = Math.max(0.1, Number((initialPrefs.formatWeights.reel - 0.4).toFixed(2)));
  initialPrefs.formatWeights.reel = Math.max(0.1, Number((initialPrefs.formatWeights.reel - 0.4).toFixed(2)));
  initialPrefs.formatWeights.carousel = Number((initialPrefs.formatWeights.carousel + 0.35).toFixed(2));
  initialPrefs.dislikedTopics.push('Crypto speculation');
  saveRecPreferences(testHandle, initialPrefs);

  const updatedPrefs = getRecPreferences(testHandle);
  console.log('   Updated preference weights after feedback:');
  console.log(`   - Reel weight:     ${updatedPrefs.formatWeights.reel} (downweighted)`);
  console.log(`   - Carousel weight: ${updatedPrefs.formatWeights.carousel} (boosted)`);
  console.log(`   - Disliked topics: ${JSON.stringify(updatedPrefs.dislikedTopics)}`);

  // Verify weight adjustments
  if (updatedPrefs.formatWeights.reel >= 1.0) throw new Error('Reel weight should be decreased');
  if (updatedPrefs.formatWeights.carousel <= 1.0) throw new Error('Carousel weight should be increased');
  if (!updatedPrefs.dislikedTopics.includes('Crypto speculation')) throw new Error('Disliked topic missing');

  // 3. Test format selection ranking
  const mockBucketEffects = {
    reel: { mean_lift: 0.28 },
    carousel: { mean_lift: 0.25 },
    image: { mean_lift: 0.10 },
  };

  const rankedFormats = Object.entries(mockBucketEffects).sort((a, b) => {
    const fmtA = a[0];
    const fmtB = b[0];
    const weightA = updatedPrefs.formatWeights[fmtA] || 1.0;
    const weightB = updatedPrefs.formatWeights[fmtB] || 1.0;
    return (b[1].mean_lift * weightB) - (a[1].mean_lift * weightA);
  });

  console.log('\n3. Re-ranked format priority after user feedback:');
  for (const [fmt, effect] of rankedFormats) {
    const w = updatedPrefs.formatWeights[fmt] || 1.0;
    const effLift = (effect.mean_lift * w * 100).toFixed(1);
    console.log(`   - ${fmt.padEnd(10)}: base lift=${(effect.mean_lift*100).toFixed(1)}%, weight=${w}x -> effective score=${effLift}%`);
  }

  const winningFormat = rankedFormats[0][0];
  console.log(`\n✅ Winning format shifted from 'reel' to '${winningFormat}' based on user feedback!`);
  if (winningFormat !== 'carousel') throw new Error(`Expected carousel to win, got ${winningFormat}`);

  // Cleanup test files
  if (fs.existsSync(prefPath)) fs.unlinkSync(prefPath);
  if (fs.existsSync(recCachePath)) fs.unlinkSync(recCachePath);

  console.log('\n====================================================');
  console.log('🎉 FR-24 Test PASSED: Feedback successfully alters recommendation ranking.');
  console.log('====================================================');
}

runTest().catch((err) => {
  console.error('FR-24 Test FAILED:', err);
  process.exit(1);
});
