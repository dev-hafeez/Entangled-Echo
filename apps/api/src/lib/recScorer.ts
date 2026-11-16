import { config } from '../config.js';
import {
  CreatorProfile,
  computeTextEmbedding,
  cosineSimilarity,
  STOPWORDS,
} from './creatorProfile.js';

export interface CandidateTopic {
  id?: string;
  title: string;
  topic: string;
  source: string;
  traffic?: string;
  geo?: string;
  news_context?: string;
  pillar: string;
  isPillarDirect?: boolean;
}

export interface ScoredCandidate extends CandidateTopic {
  cosineSim: number;
  keywordOverlap: number;
  nicheSim: number;
  repetitionPenalty: number;
  finalScore: number;
  passedThreshold: boolean;
}

export interface CandidateScoringResult {
  passed: ScoredCandidate[];
  rejected: ScoredCandidate[];
  thresholdUsed: number;
  totalEvaluated: number;
  statusMessage?: string;
}

function extractKeywords(text: string): Set<string> {
  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = clean.split(/\s+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return new Set(tokens);
}

// Compute keyword overlap and morphological root overlap
function computeKeywordOverlap(candTokens: Set<string>, nicheTokens: Set<string>): number {
  if (candTokens.size === 0 || nicheTokens.size === 0) return 0;
  let matches = 0;
  for (const cToken of candTokens) {
    if (nicheTokens.has(cToken)) {
      matches += 1.0;
    } else {
      // Check prefix / root match of length >= 4 (e.g. "foot" in "football", "photo" in "photography")
      for (const nToken of nicheTokens) {
        if (
          (cToken.length >= 4 && nToken.length >= 4) &&
          (cToken.startsWith(nToken.slice(0, 4)) || nToken.startsWith(cToken.slice(0, 4)))
        ) {
          matches += 0.6;
          break;
        }
      }
    }
  }
  return Math.min(1, matches / Math.max(1, candTokens.size));
}

// Compute repetition penalty against recent 20 posts topics
function computeRepetitionPenalty(candTokens: Set<string>, recentTopics: string[]): number {
  if (candTokens.size === 0 || recentTopics.length === 0) return 0;
  const recentSet = new Set(recentTopics.map((t) => t.toLowerCase()));
  let overlap = 0;
  for (const cToken of candTokens) {
    if (recentSet.has(cToken)) {
      overlap += 1;
    }
  }
  const ratio = overlap / Math.max(1, candTokens.size);
  // Penalty scaled up to 0.40
  return Number((ratio * 0.4).toFixed(3));
}

export function scoreCandidate(
  candidate: CandidateTopic,
  profile: CreatorProfile,
  threshold: number = config.recSimilarityThreshold
): ScoredCandidate {
  // If candidate is a direct pillar candidate, include pillar in the text
  // If candidate is an external live trend, score ONLY its actual title, topic, and news context
  const fullText = candidate.isPillarDirect
    ? `${candidate.title} ${candidate.topic} ${candidate.pillar}`
    : `${candidate.title} ${candidate.topic} ${candidate.news_context || ''}`;

  const candEmbedding = computeTextEmbedding(fullText);

  // 1. Cosine similarity to creator's caption centroid (or declared niche centroid)
  const cosineSim = Number(cosineSimilarity(candEmbedding, profile.captionEmbedding).toFixed(4));

  // 2. Keyword overlap with declared niche
  const nicheFull = `${profile.niche} ${profile.sub_niche} ${profile.content_pillars.join(' ')} ${profile.keywords.join(' ')}`;
  const candTokens = extractKeywords(fullText);
  const nicheTokens = extractKeywords(nicheFull);
  const keywordOverlap = Number(computeKeywordOverlap(candTokens, nicheTokens).toFixed(4));

  // Niche similarity: 60% cosine embedding + 40% keyword overlap
  const nicheSim = Number((0.6 * cosineSim + 0.4 * keywordOverlap).toFixed(4));

  // 3. Repetition penalty for topics in last 20 posts
  const repetitionPenalty = computeRepetitionPenalty(candTokens, profile.recentTopics);

  // Final score = nicheSim - repetitionPenalty
  const finalScore = Number(Math.max(0, nicheSim - repetitionPenalty).toFixed(4));
  const passedThreshold = finalScore >= threshold;

  return {
    ...candidate,
    cosineSim,
    keywordOverlap,
    nicheSim,
    repetitionPenalty,
    finalScore,
    passedThreshold,
  };
}

export function evaluateAndFilterCandidates(
  candidates: CandidateTopic[],
  profile: CreatorProfile,
  threshold: number = config.recSimilarityThreshold,
  maxReturn: number = 3
): CandidateScoringResult {
  const scoredList = candidates.map((c) => scoreCandidate(c, profile, threshold));

  // Partition into passed and rejected
  const passed = scoredList.filter((s) => s.passedThreshold).sort((a, b) => b.finalScore - a.finalScore);
  const rejected = scoredList.filter((s) => !s.passedThreshold).sort((a, b) => b.finalScore - a.finalScore);

  // Hard gate: strictly take up to maxReturn from passed only.
  // DO NOT backfill with off-niche items!
  const finalCandidates = passed.slice(0, maxReturn);

  let statusMessage: string | undefined;
  if (finalCandidates.length < maxReturn) {
    statusMessage = `Filtered: Only ${finalCandidates.length} candidate(s) passed the strict niche-relevance threshold (${threshold}). No off-niche backfilling allowed.`;
  }

  return {
    passed: finalCandidates,
    rejected,
    thresholdUsed: threshold,
    totalEvaluated: candidates.length,
    statusMessage,
  };
}
