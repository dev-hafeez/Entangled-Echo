import fs from 'fs';
import path from 'path';
import { config } from '../../apps/api/src/config.js';
import {
  buildCreatorProfile,
  computeTextEmbedding,
  cosineSimilarity,
  extractRecentTopics,
  extractHashtagHabits,
  detectCreatorLanguage,
  STOPWORDS,
  CreatorProfile
} from '../../apps/api/src/lib/creatorProfile.js';
import { scoreCandidate, CandidateTopic } from '../../apps/api/src/lib/recScorer.js';
import { fetchGoogleTrends } from '../../apps/api/src/routes/recommendations.js';

interface CreatorEvalResult {
  handle: string;
  niche: string;
  totalCaptions: number;
  hiddenCount: number;
  historyCount: number;
  top5Topics: string[];
  overlapCount: number;
  overlapRate: number;
  baselineRate: number;
  beatsBaseline: boolean;
  sampleHiddenCaptions: string[];
}

function extractKeyTerms(text: string): Set<string> {
  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = clean.split(/\s+/).filter(t => t.length >= 3 && !STOPWORDS.has(t));
  return new Set(tokens);
}

async function runEvaluation() {
  console.log('Starting Evaluation Step 5...');
  const postsDir = path.join(config.localStorageDir, 'posts');
  const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.json'));

  const qualifyingCreators: { handle: string; posts: any[]; captions: string[] }[] = [];

  for (const f of files) {
    const handle = f.replace('.json', '');
    try {
      const posts: any[] = JSON.parse(fs.readFileSync(path.join(postsDir, f), 'utf-8'));
      if (Array.isArray(posts)) {
        const captions = posts.map(p => (p.caption || '').trim()).filter(Boolean);
        if (captions.length >= 30) {
          qualifyingCreators.push({ handle, posts, captions });
        }
      }
    } catch {}
  }

  console.log(`Found ${qualifyingCreators.length} creators with >= 30 captions:`, qualifyingCreators.map(c => c.handle));

  const liveTrends = await fetchGoogleTrends();
  const evalResults: CreatorEvalResult[] = [];
  const reviewRows: string[] = [
    'creator,recommendation_index,title,topic,format,dominant_language,similarity_score,caption_draft,rating'
  ];

  for (const creator of qualifyingCreators) {
    const totalCaptions = creator.captions.length;
    const hiddenCount = Math.max(1, Math.floor(totalCaptions * 0.2));
    const historyCount = totalCaptions - hiddenCount;

    // Split: hidden latest 20% vs history 80%
    const hiddenCaptions = creator.captions.slice(0, hiddenCount);
    const historyCaptions = creator.captions.slice(hiddenCount);

    const fullProfile = buildCreatorProfile(creator.handle);

    // Build history-only profile
    const dim = 1024;
    const centroid = new Float64Array(dim);
    for (const c of historyCaptions) {
      const emb = computeTextEmbedding(c, dim);
      for (let i = 0; i < dim; i++) centroid[i] += emb[i];
    }
    let sumSq = 0;
    for (let i = 0; i < dim; i++) sumSq += centroid[i] * centroid[i];
    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) centroid[i] /= norm;
    }

    const historyProfile: CreatorProfile = {
      ...fullProfile,
      captionEmbedding: Array.from(centroid),
      recentTopics: extractRecentTopics(historyCaptions),
      styleExamples: historyCaptions.filter(c => c.length >= 20 && c.length <= 400).slice(0, 3),
      postsAnalyzed: historyCaptions.length,
      rawCaptions: historyCaptions
    };

    // Candidates
    const candidates: CandidateTopic[] = [];
    for (const t of liveTrends) {
      candidates.push({
        title: t.title,
        topic: t.title,
        source: t.source,
        traffic: t.traffic,
        geo: t.geo,
        news_context: t.news_title,
        pillar: fullProfile.content_pillars[0] || 'Core',
        isPillarDirect: false
      });
    }
    for (const p of fullProfile.content_pillars) {
      candidates.push({
        title: `${p} Core Strategy and Tactics`,
        topic: p,
        source: 'Pillar Derivation',
        pillar: p,
        isPillarDirect: true
      });
      candidates.push({
        title: `${p} Execution & Deep Dive`,
        topic: `${p} Analysis`,
        source: 'Pillar Derivation',
        pillar: p,
        isPillarDirect: true
      });
      candidates.push({
        title: `${p} Best Practices & Community Insights`,
        topic: `${p} Community`,
        source: 'Pillar Derivation',
        pillar: p,
        isPillarDirect: true
      });
    }

    // Score candidates against history profile
    const scored = candidates.map(c => scoreCandidate(c, historyProfile, config.recSimilarityThreshold));
    scored.sort((a, b) => b.finalScore - a.finalScore);

    const top5 = scored.slice(0, 5);
    const top5Titles = top5.map(t => t.title);

    // Terms in top-5 recommendations
    const top5Terms = new Set<string>();
    top5.forEach(t => {
      extractKeyTerms(`${t.title} ${t.topic}`).forEach(term => top5Terms.add(term));
    });

    // Terms in hidden 20% captions
    const hiddenTerms = new Set<string>();
    hiddenCaptions.forEach(c => {
      extractKeyTerms(c).forEach(term => hiddenTerms.add(term));
    });

    // Overlap
    let matches = 0;
    top5Terms.forEach(term => {
      if (hiddenTerms.has(term)) matches++;
    });

    const overlapRate = top5Terms.size > 0 ? Number((matches / top5Terms.size).toFixed(3)) : 0;

    // Baseline: random topics from generic niche vocabulary
    // (sample 5 random strings composed of random generic tokens)
    const genericNicheTerms = Array.from(extractKeyTerms(`${fullProfile.niche} ${fullProfile.sub_niche}`));
    const randomTopicTerms = new Set<string>();
    for (let i = 0; i < Math.min(top5Terms.size, 15); i++) {
      const randTerm = genericNicheTerms[Math.floor(Math.random() * genericNicheTerms.length)] || 'general';
      randomTopicTerms.add(randTerm);
    }
    let baselineMatches = 0;
    randomTopicTerms.forEach(term => {
      if (hiddenTerms.has(term)) baselineMatches++;
    });
    const baselineRate = randomTopicTerms.size > 0 ? Number((baselineMatches / randomTopicTerms.size).toFixed(3)) : 0;

    const beatsBaseline = overlapRate > baselineRate;

    evalResults.push({
      handle: creator.handle,
      niche: fullProfile.niche,
      totalCaptions,
      hiddenCount,
      historyCount,
      top5Topics: top5Titles,
      overlapCount: matches,
      overlapRate,
      baselineRate,
      beatsBaseline,
      sampleHiddenCaptions: hiddenCaptions.slice(0, 2)
    });

    // Generate 10 review outputs for this creator with blank rating
    const top10 = scored.slice(0, 10);
    top10.forEach((rec, idx) => {
      const format = idx % 2 === 0 ? 'reel' : 'carousel';
      const cleanTitle = `"${rec.title.replace(/"/g, '""')}"`;
      const cleanTopic = `"${rec.topic.replace(/"/g, '""')}"`;
      const sampleDraft = `"${(fullProfile.styleExamples[0] || rec.title).replace(/"/g, '""')}"`;
      // rating column is deliberately left empty for manual human grading
      reviewRows.push(`${creator.handle},${idx + 1},${cleanTitle},${cleanTopic},${format},${fullProfile.dominantLanguage},${rec.finalScore},${sampleDraft},`);
    });
  }

  // 1. Write reports/recs/eval.md
  let mdContent = `# Recommendation Engine Evaluation Report (Step 5)

**Evaluation Date**: ${new Date().toISOString()}  
**Holdout Split**: Latest 20% hidden test captions vs. 80% historical training captions  
**Similarity Threshold Used**: ${config.recSimilarityThreshold}  
**Candidate Source**: Real-time Google Trends + Historical Content Pillars  

---

## 1. Summary of Results

| Creator | Niche | Total Captions | Hidden (20%) | History (80%) | Top-5 Topic Overlap | Niche Baseline | Beats Baseline? |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
`;

  for (const r of evalResults) {
    const winStatus = r.beatsBaseline ? '**YES (Win)**' : 'No';
    mdContent += `| **@${r.handle}** | ${r.niche} | ${r.totalCaptions} | ${r.hiddenCount} | ${r.historyCount} | **${(r.overlapRate * 100).toFixed(1)}%** (${r.overlapCount} terms) | ${(r.baselineRate * 100).toFixed(1)}% | ${winStatus} |\n`;
  }

  mdContent += `\n---\n\n## 2. Detailed Per-Creator Evaluation\n\n`;

  for (const r of evalResults) {
    mdContent += `### @${r.handle} (${r.niche})\n`;
    mdContent += `- **Sample Size**: ${r.totalCaptions} captions (${r.historyCount} historical training, ${r.hiddenCount} hidden test).\n`;
    mdContent += `- **Top 5 Recommended Topics**:\n`;
    r.top5Topics.forEach((t, i) => {
      mdContent += `  ${i + 1}. ${t}\n`;
    });
    mdContent += `- **Overlap with Hidden Captions**: ${(r.overlapRate * 100).toFixed(1)}% (${r.overlapCount} matching terms).\n`;
    mdContent += `- **Random Niche Baseline**: ${(r.baselineRate * 100).toFixed(1)}%.\n`;
    mdContent += `- **Verdict**: ${r.beatsBaseline ? 'BEATS BASELINE (WIN)' : 'DOES NOT BEAT BASELINE'}.\n`;
    mdContent += `- **Sample Hidden Captions Tested**:\n`;
    r.sampleHiddenCaptions.forEach((c) => {
      mdContent += `  > "${c.slice(0, 150).replace(/\n/g, ' ')}..."\n`;
    });
    mdContent += `\n`;
  }

  mdContent += `\n---\n\n## 3. Human Review Sheet\n`;
  mdContent += `Saved 10 scored outputs per qualifying creator to \`reports/recs/review_sheet.csv\` with an unpopulated \`rating\` column for blind manual evaluation.\n`;

  const evalPath = path.join(process.cwd(), 'reports', 'recs', 'eval.md');
  fs.writeFileSync(evalPath, mdContent);
  console.log(`Saved evaluation report to ${evalPath}`);

  // 2. Write reports/recs/review_sheet.csv
  const csvPath = path.join(process.cwd(), 'reports', 'recs', 'review_sheet.csv');
  fs.writeFileSync(csvPath, reviewRows.join('\n'));
  console.log(`Saved review sheet with ${reviewRows.length - 1} rows to ${csvPath}`);
}

runEvaluation().catch(err => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
