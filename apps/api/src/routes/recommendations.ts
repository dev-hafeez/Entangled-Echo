import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { executeNicheAnalysis } from './onboarding.js';
import { sanitizeAndValidateHandle, createRateLimiter } from '../lib/security.js';
import {
  buildCreatorProfile,
  CreatorProfile,
  ROMAN_URDU_LEXICON,
  PORTUGUESE_LEXICON,
} from '../lib/creatorProfile.js';
import {
  evaluateAndFilterCandidates,
  scoreCandidate,
  CandidateTopic,
  ScoredCandidate,
} from '../lib/recScorer.js';

export const recommendationsRouter = Router();

// Rate limiting on AI recommendation engine (FR-33/Security)
recommendationsRouter.use(
  createRateLimiter({
    windowMs: 60000,
    maxRequests: 60,
    message: 'Recommendation generation rate limit exceeded',
  })
);

export interface TrendItem {
  title: string;
  traffic: string;
  source: string;
  geo: string;
  pubDate?: string;
  news_title?: string;
  news_source?: string;
  news_url?: string;
}

function cleanHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim();
}

// In-memory cache for Google Trends with 15-minute TTL
let trendsCache: { data: TrendItem[]; expiresAt: number } | null = null;

// Fetch real-time trends from Google Trends RSS in parallel with timeout
export async function fetchGoogleTrends(): Promise<TrendItem[]> {
  const now = Date.now();
  if (trendsCache && trendsCache.expiresAt > now && trendsCache.data.length > 0) {
    return trendsCache.data;
  }

  const geos = ['US', 'GB', 'PK', 'IN', 'BR', 'CA', 'AU', 'DE', 'FR', 'ES'];
  const fetchGeo = async (geo: string): Promise<TrendItem[]> => {
    try {
      const res = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const xml = await res.text();
      const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
      const geoTrends: TrendItem[] = [];

      for (const m of itemMatches.slice(0, 10)) {
        const titleMatch = m.match(/<title>([\s\S]*?)<\/title>/);
        const approxTrafficMatch = m.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/);
        const pubDateMatch = m.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const newsTitleMatch = m.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/);
        const newsSourceMatch = m.match(/<ht:news_item_source>([\s\S]*?)<\/ht:news_item_source>/);
        const newsUrlMatch = m.match(/<ht:news_item_url>([\s\S]*?)<\/ht:news_item_url>/);

        if (titleMatch) {
          const rawTitle = cleanHtml(titleMatch[1]);
          if (rawTitle) {
            geoTrends.push({
              title: rawTitle,
              traffic: approxTrafficMatch ? cleanHtml(approxTrafficMatch[1]) : 'Trending Now',
              source: `Google Trends (${geo})`,
              geo,
              pubDate: pubDateMatch ? cleanHtml(pubDateMatch[1]) : undefined,
              news_title: newsTitleMatch ? cleanHtml(newsTitleMatch[1]) : undefined,
              news_source: newsSourceMatch ? cleanHtml(newsSourceMatch[1]) : undefined,
              news_url: newsUrlMatch ? cleanHtml(newsUrlMatch[1]) : undefined,
            });
          }
        }
      }
      return geoTrends;
    } catch {
      return [];
    }
  };

  const results = await Promise.all(geos.map((g) => fetchGeo(g)));
  const trends: TrendItem[] = [];
  const seenTitles = new Set<string>();

  for (const list of results) {
    for (const t of list) {
      const lower = t.title.toLowerCase();
      if (!seenTitles.has(lower)) {
        seenTitles.add(lower);
        trends.push(t);
      }
    }
  }

  if (trends.length > 0) {
    trendsCache = {
      data: trends,
      expiresAt: now + 15 * 60 * 1000,
    };
  } else if (trendsCache?.data) {
    return trendsCache.data;
  }

  return trends;
}

// GET /api/recommendations/live-trends - live feed of raw Google Trends
recommendationsRouter.get('/live-trends', async (req: Request, res: Response) => {
  try {
    const trends = await fetchGoogleTrends();
    return res.json({ success: true, count: trends.length, trends });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Format effects benchmark loader
function getFormatEffects(): any {
  const p = path.join(config.localStorageDir, 'format_effects.json');
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {}
  }
  return {
    'under 10K': { carousel: { mean_lift: 0.187 }, reel: { mean_lift: 0.15 }, image: { mean_lift: 0.05 } },
    '10K-100K': { reel: { mean_lift: 0.284 }, carousel: { mean_lift: 0.22 }, image: { mean_lift: 0.08 } },
    '100K-1M': { reel: { mean_lift: 0.399 }, carousel: { mean_lift: 0.25 }, image: { mean_lift: 0.12 } },
    'over 1M': { reel: { mean_lift: 0.282 }, carousel: { mean_lift: 0.245 }, image: { mean_lift: 0.15 } },
  };
}

export interface RecommendationPreferences {
  formatWeights: Record<string, number>;
  dislikedTopics: string[];
  likedTopics: string[];
  totalFeedbackCount: number;
  lastUpdated: string;
}

export function getRecPreferences(handle: string): RecommendationPreferences {
  const p = path.join(config.localStorageDir, 'preferences', `recs_${handle}.json`);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {}
  }
  return {
    formatWeights: { reel: 1.0, carousel: 1.0, image: 1.0 },
    dislikedTopics: [],
    likedTopics: [],
    totalFeedbackCount: 0,
    lastUpdated: new Date().toISOString(),
  };
}

export function saveRecPreferences(handle: string, prefs: RecommendationPreferences): void {
  const prefDir = path.join(config.localStorageDir, 'preferences');
  if (!fs.existsSync(prefDir)) fs.mkdirSync(prefDir, { recursive: true });
  const p = path.join(prefDir, `recs_${handle}.json`);
  fs.writeFileSync(p, JSON.stringify(prefs, null, 2));
}

// POST /api/recommendations/feedback - FR-24 Accept/Reject Learning Mechanism
recommendationsRouter.post('/feedback', async (req: Request, res: Response) => {
  const { handle, recommendationId, accepted, feedback, mediaType, topic } = req.body;
  if (!handle) {
    return res.status(400).json({ error: 'handle is required' });
  }

  let cleanHandle: string;
  try {
    cleanHandle = sanitizeAndValidateHandle(handle);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  const prefs = getRecPreferences(cleanHandle);
  prefs.totalFeedbackCount++;
  prefs.lastUpdated = new Date().toISOString();

  const mType = (mediaType || '').toLowerCase();
  const normalizedMType = mType === 'video' ? 'reel' : mType;
  if (normalizedMType && prefs.formatWeights[normalizedMType] !== undefined) {
    if (accepted) {
      prefs.formatWeights[normalizedMType] = Number((prefs.formatWeights[normalizedMType] + 0.35).toFixed(2));
    } else {
      prefs.formatWeights[normalizedMType] = Math.max(0.1, Number((prefs.formatWeights[normalizedMType] - 0.4).toFixed(2)));
    }
  }

  if (topic) {
    const cleanTopic = topic.trim();
    if (accepted) {
      if (!prefs.likedTopics.includes(cleanTopic)) prefs.likedTopics.push(cleanTopic);
      prefs.dislikedTopics = prefs.dislikedTopics.filter((t) => t.toLowerCase() !== cleanTopic.toLowerCase());
    } else {
      if (!prefs.dislikedTopics.includes(cleanTopic)) prefs.dislikedTopics.push(cleanTopic);
      prefs.likedTopics = prefs.likedTopics.filter((t) => t.toLowerCase() !== cleanTopic.toLowerCase());
    }
  }

  saveRecPreferences(cleanHandle, prefs);

  // Invalidate recommendation cache
  const recsCacheFile = path.join(config.localStorageDir, 'recommendations', `${cleanHandle}.json`);
  if (fs.existsSync(recsCacheFile)) {
    try { fs.unlinkSync(recsCacheFile); } catch {}
  }

  return res.json({
    success: true,
    message: accepted ? 'Feedback recorded: format preference increased' : 'Feedback recorded: format preference decreased and downranked',
    preferences: prefs,
  });
});

// GET /api/recommendations/preferences
recommendationsRouter.get('/preferences', (req: Request, res: Response) => {
  const rawHandle = req.query.handle as string;
  if (!rawHandle) return res.status(400).json({ error: 'handle parameter is required' });
  let handle: string;
  try {
    handle = sanitizeAndValidateHandle(rawHandle);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
  const prefs = getRecPreferences(handle);
  return res.json({ success: true, preferences: prefs });
});

// Verify matching output language
export function verifyMatchingLanguage(text: string, expectedLanguage: string): boolean {
  if (!text || text.trim().length === 0) return false;
  const lower = text.toLowerCase();
  const norm = (expectedLanguage || '').toLowerCase();

  if (norm.includes('portuguese')) {
    const ptAccentsRegex = /[çãõáéíóúâêôà]/gi;
    const hasAccents = ptAccentsRegex.test(text);
    const ptWordsRegex = /\b(obrigado|obrigada|olá|mais|uma|como|isso|pelo|pela|que|não|muito|ainda|sempre|novo|nova|amor|vamos|passo|dado|nacional|mim|palavras|capitão|todos|tudo|jogo|vitória|parabéns|treino|foco|grande|equipa|juntos|agora|família|história|estará|portugal|rumo|nossa|nosso|com|para|em|de|do|da|os|as|um)\b/i;
    return hasAccents || ptWordsRegex.test(lower);
  }

  if (norm.includes('urdu')) {
    const hasArabicScript = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
    if (hasArabicScript) return true;
    const romanUrduWordsRegex = /\b(kya|hai|hain|nahi|nahin|main|mein|kar|raha|rahe|rahi|bhai|shukriya|aap|hum|aur|acha|achha|bohot|bohat|dekho|ye|yeh|wo|woh|hota|hoti|hote|gaya|gayi|diya|paas|zindagi|dost|sab|karo|karna|bhi|ka|ki|ke|ko|se|yaar|abhi|matlab|waise|pyar|dil|kuch|waqt|baat|apna|apni|mujhe|tujhe|unka|inka|sirf|lekin|pehle|bhi|batao|karein)\b/i;
    return romanUrduWordsRegex.test(lower);
  }

  if (norm.includes('spanish')) {
    const esWordsRegex = /\b(gracias|hola|como|que|una|para|con|por|los|las|muy|todo|pero|cuando|donde|quien|tambien|porque|sobre|hacer|puede|tiene|vamos|equipo)\b/i;
    return esWordsRegex.test(lower);
  }

  // English default
  const enWordsRegex = /\b(the|and|to|of|in|for|is|on|that|by|this|with|not|are|from|your|all|have|new|more|work|guide|insights)\b/i;
  return enWordsRegex.test(lower);
}

// Generate recommendation content with LLM passing 2 to 3 style examples
async function generateRecommendationContent(
  cand: ScoredCandidate,
  profile: CreatorProfile,
  format: string,
  liftStr: string,
  optimalTimeWindow: string,
  recommendedDayName: string,
  apiKey: string
): Promise<any> {
  const model = 'gemini-3.5-flash-lite';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const styleContext =
    profile.styleExamples.length > 0
      ? `\nSTYLE REFERENCE EXAMPLES (Match this exact creator voice, style, and tone):\n${profile.styleExamples
          .map((ex, i) => `Example ${i + 1}: "${ex}"`)
          .join('\n')}`
      : `\nCREATOR BIO / CONTEXT: "${profile.rawCaptions[0] || profile.niche}"`;

  const prompt = `You are an elite AI Content Strategy & Trend Recommendation Engine.
Generate an authentic, high-performing social media post recommendation strictly written in ${profile.dominantLanguage}.

CREATOR CONTEXT:
- Handle: @${profile.handle}
- Niche: ${profile.niche} (${profile.sub_niche})
- Pillar: ${cand.pillar}
- Dominant Language: ${profile.dominantLanguage} (Confidence: ${(profile.languageConfidence * 100).toFixed(0)}%)
- Target Format: ${format} (${liftStr})
- Optimal Window: ${optimalTimeWindow} on ${recommendedDayName}
${styleContext}

TOPIC TO ADAPT:
- Title / Trend: ${cand.title}
- Source: ${cand.source} (${cand.traffic || 'High Niche Authority'})
${cand.news_context ? `- Context: ${cand.news_context}` : ''}

TASK:
Write the complete recommendation for this creator.
CRITICAL LANGUAGE REQUIREMENT:
The title, caption_draft, and caption_options MUST be written in ${profile.dominantLanguage}.
- If ${profile.dominantLanguage} is Portuguese, write in authentic natural Portuguese.
- If ${profile.dominantLanguage} is Urdu and style examples use Roman Urdu, write in natural Roman Urdu. If style examples or bio use Urdu script, write in Urdu script.
- Do NOT use generic canned formulas, fixed templates, or placeholder text.
- Do NOT output English if dominant language is Portuguese or Urdu.

Return ONLY a valid JSON object with:
{
  "title": "Engaging, authentic post title in ${profile.dominantLanguage}",
  "rationale": "2-3 sentences explaining why this topic fits their ${cand.pillar} pillar and niche authority",
  "caption_draft": "Full ready-to-publish caption in ${profile.dominantLanguage} with hook, value body, and call to action",
  "caption_options": [
    { "style": "Storytelling & Relatable", "hook": "Hook in ${profile.dominantLanguage}", "text": "Caption in ${profile.dominantLanguage}" },
    { "style": "Short & Punchy", "hook": "Hook in ${profile.dominantLanguage}", "text": "Caption in ${profile.dominantLanguage}" },
    { "style": "In-Depth Breakdown", "hook": "Hook in ${profile.dominantLanguage}", "text": "Caption in ${profile.dominantLanguage}" }
  ],
  "suggested_hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "creation_blueprint": {
    "hook": "Specific first 3-second hook for ${format}",
    "body": "Value delivery breakdown across middle 15-25 seconds",
    "call_to_action": "Targeted closing prompt for comments and saves",
    "production_tips": ["Tip 1", "Tip 2", "Tip 3"]
  }
}`;

  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(9000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.0, // Greedy deterministic for reproducible results
            maxOutputTokens: 1000,
          },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        lastErr = `LLM generation HTTP ${resp.status}: ${errText.slice(0, 200)}`;
        if (resp.status === 503 || resp.status === 429) {
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }
        throw new Error(lastErr);
      }

      const data = await resp.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const rawText = parts.map((p: any) => p.text || '').join('');
      if (!rawText || rawText.trim().length === 0) {
        throw new Error(`LLM generation failed: Model returned empty content.`);
      }

      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      // Strict verification of matching language
      const captionToCheck = parsed.caption_draft || parsed.caption_options?.[0]?.text || '';
      if (!verifyMatchingLanguage(captionToCheck, profile.dominantLanguage)) {
        throw new Error(
          `Generation failed: Model output did not match expected dominant language (${profile.dominantLanguage}). Generated text was rejected.`
        );
      }

      return parsed;
    } catch (err: any) {
      lastErr = err.message;
      if (attempt < 3 && (lastErr.includes('503') || lastErr.includes('429') || lastErr.includes('timeout'))) {
        await new Promise((r) => setTimeout(r, 1200 * attempt));
        continue;
      }
      throw err;
    }
  }

  throw new Error(lastErr || 'LLM generation failed after 3 attempts.');
}

// Build dynamic hashtag bundles from creator habits and candidate keywords
function buildHashtags(profile: CreatorProfile, cand: ScoredCandidate): {
  suggested_hashtags: string[];
  hashtag_bundles: { niche: string[]; broad: string[]; trending: string[] };
} {
  const nicheClean = profile.niche.toLowerCase().replace(/[^a-z0-9]/g, '');
  const pillarClean = cand.pillar.toLowerCase().replace(/[^a-z0-9]/g, '');
  const topicClean = cand.topic.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 22);

  const habits = profile.hashtagHabits.map((h) => `#${h}`);
  const nicheTags = [
    `#${nicheClean}`,
    `#${pillarClean}`,
    ...habits.slice(0, 3),
  ].filter(Boolean);

  const broadTags = ['#creator', '#community', '#strategy', '#trendingnow', '#contentcreation'];
  const trendingTags = [
    `#${topicClean}`,
    `#${cand.geo ? cand.geo.toLowerCase() + 'trends' : 'trends'}`,
    '#explorepage',
    '#viral',
  ].filter(Boolean);

  const all = Array.from(new Set([...nicheTags, ...broadTags.slice(0, 2), ...trendingTags.slice(0, 2)])).slice(0, 6);

  return {
    suggested_hashtags: all,
    hashtag_bundles: {
      niche: Array.from(new Set(nicheTags)).slice(0, 5),
      broad: broadTags.slice(0, 5),
      trending: Array.from(new Set(trendingTags)).slice(0, 5),
    },
  };
}

// POST /api/recommendations/generate
recommendationsRouter.post('/generate', async (req: Request, res: Response) => {
  const { handle, platform = 'instagram' } = req.body;
  if (!handle) {
    return res.status(400).json({ error: 'handle is required' });
  }

  let cleanHandle: string;
  try {
    cleanHandle = sanitizeAndValidateHandle(handle);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  // 1. Build Creator Profile from stored data only (Step 1)
  const profile = buildCreatorProfile(cleanHandle);

  // If niche is missing or 0 posts analyzed while posts exist on disk, execute analysis
  const storageDir = config.localStorageDir;
  const nicheFile = path.join(storageDir, 'niches', `${cleanHandle}.json`);
  let nicheData: any = {};
  if (fs.existsSync(nicheFile)) {
    try { nicheData = JSON.parse(fs.readFileSync(nicheFile, 'utf-8')); } catch {}
  }
  if ((!nicheData?.niche || nicheData?.posts_analyzed === 0) && profile.postsAnalyzed > 0) {
    try {
      const freshNiche = await executeNicheAnalysis(cleanHandle, platform);
      if (freshNiche?.nicheData) {
        nicheData = freshNiche.nicheData;
      }
    } catch {}
  }

  // 2. Audience Tier & Format Effects Lift
  const profileFile = path.join(storageDir, 'profiles', `${cleanHandle}.json`);
  let rawProfileData: any = {};
  if (fs.existsSync(profileFile)) {
    try { rawProfileData = JSON.parse(fs.readFileSync(profileFile, 'utf-8')); } catch {}
  }
  const followersCount = rawProfileData.followers_count || rawProfileData.followersCount || 10000;

  let bucket = 'under 10K';
  if (followersCount > 1000000) bucket = 'over 1M';
  else if (followersCount > 100000) bucket = '100K-1M';
  else if (followersCount > 10000) bucket = '10K-100K';

  const formatEffects = getFormatEffects();
  const bucketEffects = formatEffects[bucket] || {};
  const userPrefs = getRecPreferences(cleanHandle);

  let bestFormat = 'reel';
  let bestLift = 0.28;
  let liftExplanation = 'Reels and short-form video deliver maximum algorithmic discovery for growing creators.';

  if (bucketEffects) {
    const sortedFormats = Object.entries(bucketEffects).sort(
      (a: any, b: any) => {
        const fmtA = a[0] === 'video' ? 'reel' : a[0];
        const fmtB = b[0] === 'video' ? 'reel' : b[0];
        const weightA = userPrefs.formatWeights[fmtA] !== undefined ? userPrefs.formatWeights[fmtA] : 1.0;
        const weightB = userPrefs.formatWeights[fmtB] !== undefined ? userPrefs.formatWeights[fmtB] : 1.0;
        const liftA = ((a[1] as any).mean_lift || 0.2) * weightA;
        const liftB = ((b[1] as any).mean_lift || 0.2) * weightB;
        return liftB - liftA;
      }
    );
    if (sortedFormats.length > 0 && sortedFormats[0][1]) {
      const topFmt = sortedFormats[0][0];
      bestFormat = topFmt === 'video' ? 'reel' : topFmt;
      bestLift = (sortedFormats[0][1] as any).mean_lift || 0.28;
      const fmtWeight = userPrefs.formatWeights[bestFormat] || 1.0;
      liftExplanation = `Statistically calibrated for creators in the ${bucket} follower tier (weighted by feedback score ${fmtWeight.toFixed(2)}x): +${(bestLift * 100).toFixed(1)}% expected engagement lift vs static formats.`;
    }
  }

  // 3. Optimal Time Window
  const postsFile = path.join(storageDir, 'posts', `${cleanHandle}.json`);
  let posts: any[] = [];
  if (fs.existsSync(postsFile)) {
    try { posts = JSON.parse(fs.readFileSync(postsFile, 'utf-8')); } catch {}
  }
  const hourScores: Record<number, { likes: number; count: number }> = {};
  const dayScores: Record<number, number> = {};

  for (const p of posts) {
    const dateStr = p.postedAt || p.posted_at || p.timestamp;
    if (dateStr) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const h = d.getUTCHours();
        const day = d.getUTCDay();
        const l = p.likesCount || p.likes_count || 0;
        hourScores[h] = { likes: (hourScores[h]?.likes || 0) + l, count: (hourScores[h]?.count || 0) + 1 };
        dayScores[day] = (dayScores[day] || 0) + l;
      }
    }
  }

  let peakHour = 17;
  let maxScore = 0;
  for (const [h, data] of Object.entries(hourScores)) {
    const avg = data.likes / data.count;
    if (avg > maxScore) {
      maxScore = avg;
      peakHour = parseInt(h, 10);
    }
  }

  const ampm = peakHour < 12 ? 'AM' : 'PM';
  const displayHour = peakHour % 12 || 12;
  const optimalTimeWindow = `${displayHour}:00 ${ampm} - ${displayHour + 2 > 12 ? (displayHour + 2) % 12 : displayHour + 2}:00 ${ampm} (UTC)`;

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const topDayIdx = Object.entries(dayScores).sort((a, b) => b[1] - a[1])[0]?.[0];
  const recommendedDayName = topDayIdx !== undefined ? dayNames[parseInt(topDayIdx, 10)] : 'Tuesday';

  // 4. Check persistent recommendation cache per handle (1 hour TTL)
  const recsCacheFile = path.join(storageDir, 'recommendations', `${cleanHandle}.json`);
  const recsCacheDir = path.join(storageDir, 'recommendations');
  if (!fs.existsSync(recsCacheDir)) fs.mkdirSync(recsCacheDir, { recursive: true });

  const forceRefresh = req.body.refresh === true || req.query.refresh === 'true';

  if (!forceRefresh && fs.existsSync(recsCacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(recsCacheFile, 'utf-8'));
      const cacheAgeMs = Date.now() - new Date(cached.generated_at || 0).getTime();
      if (cacheAgeMs < 60 * 60 * 1000 && Array.isArray(cached.recommendations) && cached.recommendations.length > 0) {
        return res.json({
          ...cached,
          cached: true,
          cache_age_seconds: Math.round(cacheAgeMs / 1000),
        });
      }
    } catch {}
  }

  // 5. Ingest Live Google Trends
  const liveTrends = await fetchGoogleTrends();

  // 6. Assemble candidate pool (Step 2)
  const candidatePool: CandidateTopic[] = [];

  // A. Candidates from live trends
  for (const t of liveTrends) {
    if (userPrefs.dislikedTopics.some((dt) => t.title.toLowerCase().includes(dt.toLowerCase()))) {
      continue;
    }
    candidatePool.push({
      title: t.title,
      topic: t.title,
      source: t.source,
      traffic: t.traffic,
      geo: t.geo,
      news_context: t.news_title ? `${t.news_title} (${t.news_source || 'Google Trends'})` : undefined,
      pillar: profile.content_pillars[0] || 'Core Expertise',
    });
  }

  // B. Candidates from creator's own pillars
  for (let idx = 0; idx < profile.content_pillars.length; idx++) {
    const pillar = profile.content_pillars[idx];
    candidatePool.push({
      title: `${pillar} Strategic Breakdown`,
      topic: pillar,
      source: 'Creator Content Pillar',
      traffic: 'High Niche Authority',
      pillar: pillar,
      isPillarDirect: true,
    });
    candidatePool.push({
      title: `Practical Blueprint & Execution for ${pillar}`,
      topic: `${pillar} Execution`,
      source: 'Creator Content Pillar',
      traffic: 'High Niche Authority',
      pillar: pillar,
      isPillarDirect: true,
    });
  }

  // 7. Candidate Scoring & Hard Gate (Step 2)
  const scoringResult = evaluateAndFilterCandidates(
    candidatePool,
    profile,
    config.recSimilarityThreshold,
    3
  );

  const passedCandidates = scoringResult.passed;

  // 8. Generate titles and captions in dominantLanguage (Step 3)
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    return res.status(502).json({
      error: 'Generation failed: GEMINI_API_KEY is not configured on the server.',
    });
  }

  const generatedRecommendations: any[] = [];

  for (let idx = 0; idx < passedCandidates.length; idx++) {
    const cand = passedCandidates[idx];
    const isReel = idx === 0 ? bestFormat : idx === 1 ? (bestFormat === 'reel' ? 'carousel' : 'reel') : 'image';
    const liftStr =
      isReel === 'reel'
        ? `+${(bestLift * 100).toFixed(1)}% reach lift`
        : isReel === 'carousel'
        ? '+24.5% saves & shares'
        : '+15.0% comment rate';
    const dayStr = idx === 0 ? `${recommendedDayName} (Peak Activity)` : idx === 1 ? 'Wednesday / Thursday' : 'Sunday Evening';

    if (idx > 0) {
      await new Promise((r) => setTimeout(r, 400));
    }

    try {
      const generated = await generateRecommendationContent(
        cand,
        profile,
        isReel,
        liftStr,
        optimalTimeWindow,
        recommendedDayName,
        apiKey
      );

      const hashtags = buildHashtags(profile, cand);

      generatedRecommendations.push({
        id: `rec_${idx + 1}`,
        title: generated.title || cand.title,
        trend_topic: cand.topic,
        trend_source: cand.source,
        trend_traffic: cand.traffic || 'High Niche Authority',
        trend_news_context: cand.news_context,
        niche_match_score: Math.min(99, Math.round(cand.finalScore * 100 + 40)),
        similarity_score: cand.finalScore,
        cosine_similarity: cand.cosineSim,
        keyword_overlap: cand.keywordOverlap,
        repetition_penalty: cand.repetitionPenalty,
        pillar: cand.pillar,
        recommended_format: isReel,
        format_lift: liftStr,
        optimal_posting_time: optimalTimeWindow,
        recommended_day: dayStr,
        rationale: generated.rationale || `${liftExplanation} Connects to your ${profile.niche} authority under the ${cand.pillar} pillar.`,
        caption_draft: generated.caption_draft,
        caption_options: generated.caption_options || [
          { style: 'Primary Draft', hook: '', text: generated.caption_draft },
        ],
        suggested_hashtags: generated.suggested_hashtags || hashtags.suggested_hashtags,
        hashtag_bundles: hashtags.hashtag_bundles,
        creation_blueprint: generated.creation_blueprint || {
          hook: `First 3 seconds / Slide 1: High-stakes introduction for ${cand.topic}`,
          body: `Next 15-25 seconds: 3 actionable takeaways connecting to ${cand.pillar}`,
          call_to_action: `Final 5 seconds: Direct audience prompt asking for comments`,
          production_tips: ['Use high-contrast text overlays', 'Pace transitions every 2.5s', 'Pin engaging comment'],
        },
      });
    } catch (err: any) {
      console.error(`[recommendations] Generation failed for candidate ${cand.topic}:`, err.message);
      // Fail the request if model returns an empty or non-matching language result (Step 3)
      return res.status(422).json({
        error: `Recommendation generation failed: ${err.message}`,
        candidate_topic: cand.topic,
        dominant_language: profile.dominantLanguage,
      });
    }
  }

  const payload = {
    success: true,
    handle: cleanHandle,
    user_niche: profile.niche,
    sub_niche: profile.sub_niche,
    language_preference: profile.dominantLanguage,
    language_confidence: profile.languageConfidence,
    has_history: profile.hasHistory,
    confidence: profile.hasHistory ? 'high' : 'low',
    follower_tier: bucket,
    optimal_time_window: optimalTimeWindow,
    dominant_format_recommendation: bestFormat,
    threshold_used: scoringResult.thresholdUsed,
    candidates_passed: passedCandidates.length,
    status_message: scoringResult.statusMessage,
    recommendations: generatedRecommendations,
    live_trend_signals: liveTrends.slice(0, 8),
    generated_at: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(recsCacheFile, JSON.stringify(payload, null, 2));
  } catch {}

  return res.json(payload);
});
