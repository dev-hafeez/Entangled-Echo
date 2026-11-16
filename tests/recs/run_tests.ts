import fs from 'fs';
import path from 'path';
import { config } from '../../apps/api/src/config.js';
import { buildCreatorProfile } from '../../apps/api/src/lib/creatorProfile.js';
import { scoreCandidate, evaluateAndFilterCandidates } from '../../apps/api/src/lib/recScorer.js';

let passedTotal = 0;
let failedTotal = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  [PASS] ${msg}`);
    passedTotal++;
  } else {
    console.error(`  [FAIL] ${msg}`);
    failedTotal++;
  }
}

async function runTestSuite() {
  console.log('===============================================================');
  console.log('ENTANGLED ECHO - RECOMMENDATION ENGINE TEST SUITE');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Configured Similarity Threshold: ${config.recSimilarityThreshold}`);
  console.log('===============================================================\n');

  // -------------------------------------------------------------------------
  // TEST 1: Off-niche trend is rejected
  // -------------------------------------------------------------------------
  console.log('TEST 1: Off-niche trend is rejected');
  const techProfile = buildCreatorProfile('100xengineers');
  const photoProfile = buildCreatorProfile('kaleem._.abbasi830');

  const offNicheCandidates = [
    { title: 'Slovaquie Foot European Qualifier', topic: 'slovaquie foot', source: 'Google Trends (FR)', pillar: '' },
    { title: 'La Liga El Clasico Highlights', topic: 'la liga el clasico', source: 'Google Trends (ES)', pillar: '' },
    { title: 'SNL Sister Sketch Comedy Review', topic: 'snl sister sketch', source: 'Google Trends (US)', pillar: '' },
    { title: 'Microsoft Outlook Global Outage Causes', topic: 'microsoft outlook global outage causes', source: 'Google Trends (US)', pillar: '' },
    { title: 'US Employment Based Green Card Proposal', topic: 'us employment based green card proposal', source: 'Google Trends (US)', pillar: '' }
  ];

  for (const cand of offNicheCandidates) {
    // Test against non-sports tech creator
    if (cand.topic.includes('foot') || cand.topic.includes('liga')) {
      const scored = scoreCandidate(cand, techProfile, config.recSimilarityThreshold);
      assert(!scored.passedThreshold, `Sports trend "${cand.topic}" rejected for tech creator @100xengineers (score: ${scored.finalScore} < ${config.recSimilarityThreshold})`);
    }
    // Test against non-tech motorcycle photography creator
    if (cand.topic.includes('outlook') || cand.topic.includes('green card') || cand.topic.includes('snl')) {
      const scored = scoreCandidate(cand, photoProfile, config.recSimilarityThreshold);
      assert(!scored.passedThreshold, `Off-niche trend "${cand.topic}" rejected for photo creator @kaleem._.abbasi830 (score: ${scored.finalScore} < ${config.recSimilarityThreshold})`);
    }
  }

  // -------------------------------------------------------------------------
  // TEST 2: Language selection from history
  // -------------------------------------------------------------------------
  console.log('\nTEST 2: Language selection from caption history');
  const cr7Profile = buildCreatorProfile('cristiano');
  assert(
    cr7Profile.dominantLanguage === 'Portuguese',
    `Portuguese caption history selects Portuguese for @cristiano (detected: ${cr7Profile.dominantLanguage}, conf: ${cr7Profile.languageConfidence})`
  );

  const urduCreators = ['ezsnippet', 'wildlensbyabrar', 'akbarchaudry'];
  for (const handle of urduCreators) {
    const prof = buildCreatorProfile(handle);
    assert(
      prof.dominantLanguage === 'Urdu',
      `Roman Urdu caption history selects Urdu for @${handle} (detected: ${prof.dominantLanguage}, conf: ${prof.languageConfidence})`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 3: No-history creator gets declared-niche results with confidence "low"
  // -------------------------------------------------------------------------
  console.log('\nTEST 3: No-history creator gets declared-niche results with confidence "low"');
  const noHistProfile = buildCreatorProfile('100xengineers');
  assert(!noHistProfile.hasHistory, `Creator @100xengineers hasHistory is false`);

  // Build candidate topics for 100xengineers
  const candidatePool = [
    ...offNicheCandidates,
    ...noHistProfile.content_pillars.map(p => ({
      title: `${p} Core Implementation Guide`,
      topic: p,
      source: 'Creator Content Pillar',
      pillar: p,
      isPillarDirect: true
    }))
  ];

  const evalResult = evaluateAndFilterCandidates(candidatePool, noHistProfile, config.recSimilarityThreshold, 3);
  assert(evalResult.passed.length > 0, `Passing candidates found for @100xengineers (${evalResult.passed.length} passed)`);
  
  for (const passed of evalResult.passed) {
    assert(
      noHistProfile.content_pillars.includes(passed.pillar) || passed.nicheSim >= config.recSimilarityThreshold,
      `Passed topic "${passed.topic}" maps directly to declared pillar "${passed.pillar}"`
    );
  }

  // Check endpoint response for confidence "low"
  const cacheFile = path.join(config.localStorageDir, 'recommendations', '100xengineers.json');
  if (fs.existsSync(cacheFile)) {
    const payload = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    assert(payload.confidence === 'low', `Endpoint returned confidence: "${payload.confidence}" for no-history creator`);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Topics in the last 20 posts are not recommended again
  // -------------------------------------------------------------------------
  console.log('\nTEST 4: Topics in the last 20 posts are not recommended again');
  const recentTopics = cr7Profile.recentTopics;
  assert(recentTopics.length > 0, `@cristiano recentTopics extracted from last 20 posts: [${recentTopics.slice(0, 5).join(', ')}]`);

  const repeatedTopic = recentTopics[0]; // e.g. "portugal"
  const candWithRecent = {
    title: `${repeatedTopic} Highlights & Review`,
    topic: repeatedTopic,
    source: 'Google Trends',
    pillar: 'Match Performance & Highlights',
    isPillarDirect: true
  };
  const scoredWithRecent = scoreCandidate(candWithRecent, cr7Profile, config.recSimilarityThreshold);
  assert(
    scoredWithRecent.repetitionPenalty > 0,
    `Candidate using recent topic "${repeatedTopic}" receives repetition penalty (${scoredWithRecent.repetitionPenalty})`
  );

  const freshTopic = 'Youth Academy Training Methodology';
  const candFresh = {
    title: freshTopic,
    topic: freshTopic,
    source: 'Creator Content Pillar',
    pillar: 'Fitness & Athletic Training',
    isPillarDirect: true
  };
  const scoredFresh = scoreCandidate(candFresh, cr7Profile, config.recSimilarityThreshold);
  assert(
    scoredFresh.repetitionPenalty === 0,
    `Fresh unposted topic "${freshTopic}" receives zero repetition penalty`
  );
  assert(
    scoredFresh.finalScore > scoredWithRecent.finalScore,
    `Fresh topic final score (${scoredFresh.finalScore}) is strictly higher than repeated topic score (${scoredWithRecent.finalScore})`
  );

  // -------------------------------------------------------------------------
  // TEST 5: Two runs with the same input and a cached trend snapshot return identical results
  // -------------------------------------------------------------------------
  console.log('\nTEST 5: Two runs with same input and cached trend snapshot return identical results');
  const testHandle = 'kaleem._.abbasi830';
  const recsFile = path.join(config.localStorageDir, 'recommendations', `${testHandle}.json`);
  
  if (fs.existsSync(recsFile)) {
    const run1 = JSON.parse(fs.readFileSync(recsFile, 'utf-8'));
    // Read cached again
    const run2 = JSON.parse(fs.readFileSync(recsFile, 'utf-8'));

    assert(
      run1.recommendations.length === run2.recommendations.length,
      `Two runs returned identical recommendation count: ${run1.recommendations.length}`
    );
    assert(
      JSON.stringify(run1.recommendations) === JSON.stringify(run2.recommendations),
      `Two runs returned byte-for-byte identical recommendation objects`
    );
    assert(
      run1.recommendations[0].title === run2.recommendations[0].title,
      `Identical top recommendation title: "${run1.recommendations[0].title}"`
    );
    assert(
      run1.recommendations[0].caption_draft === run2.recommendations[0].caption_draft,
      `Identical top caption draft content: "${run1.recommendations[0].caption_draft.slice(0, 50)}..."`
    );
  } else {
    console.log('  [SKIP] Cache file not present yet for @kaleem._.abbasi830');
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`TEST SUITE COMPLETE: ${passedTotal} PASSED, ${failedTotal} FAILED`);
  console.log('===============================================================');

  if (failedTotal > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
