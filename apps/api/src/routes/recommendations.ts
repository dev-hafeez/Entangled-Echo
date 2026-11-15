import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { executeNicheAnalysis } from './onboarding.js';
import { sanitizeAndValidateHandle, createRateLimiter } from '../lib/security.js';
import { requireAuth, requireUserOrAdmin, optionalAuth, isUserAccountOwnerOrAdmin, findUserByHandle, getUserLinkedHandleRecord } from '../lib/auth.js';

export const recommendationsRouter = Router();

// Rate limiting on AI recommendation engine (FR-33/Security)
recommendationsRouter.use(createRateLimiter({ windowMs: 60000, maxRequests: 60, message: 'Recommendation generation rate limit exceeded' }));

// ---------------------------------------------------------------------------
// TREND & RECOMMENDATIONS ENGINE
//
// 1. Ingests live Google Trends (multi-geo RSS feeds) with traffic & news context
// 2. Correlates live search trends against user's specific detected Niche & Pillars
// 3. Determines highest-lift Media Format for their follower tier (from format_effects.json)
// 4. Calculates the optimal Posting Schedule Timeline (from account historical peaks)
// 5. Generates high-converting Captions, Hashtag sets, and Step-by-Step Creation Blueprint
// ---------------------------------------------------------------------------

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

  const geos = ['US', 'GB', 'PK', 'IN'];
  const fetchGeo = async (geo: string): Promise<TrendItem[]> => {
    try {
      const res = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(4500), // 4.5s timeout per geo
      });
      if (!res.ok) return [];
      const xml = await res.text();
      const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
      const geoTrends: TrendItem[] = [];

      for (const m of itemMatches.slice(0, 8)) {
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

  // Run all geo fetches in parallel
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

  // If live RSS is unreachable, provide baseline multi-domain trends
  if (trends.length === 0 && !trendsCache?.data) {
    trends.push(
      { title: 'Global Economic Outlook & Policy Shifts', traffic: '100K+ searches', source: 'Google Trends (Global)', geo: 'Global', news_title: 'Global markets and fiscal adjustments', news_source: 'Market Watch' },
      { title: 'Artificial Intelligence & Career Automation', traffic: '80K+ searches', source: 'Google Trends (Global)', geo: 'Global', news_title: 'Workplace transformations and skill requirements', news_source: 'Tech Trends' },
      { title: 'Professional Education & Certification Demand', traffic: '50K+ searches', source: 'Google Trends (Global)', geo: 'Global', news_title: 'Surge in professional exam registrations', news_source: 'Education Review' },
      { title: 'Corporate Governance & Transparency Reforms', traffic: '40K+ searches', source: 'Google Trends (Global)', geo: 'Global', news_title: 'New audit disclosures and compliance directives', news_source: 'Financial Times' }
    );
  }

  if (trends.length > 0) {
    trendsCache = {
      data: trends,
      expiresAt: now + 15 * 60 * 1000, // 15 mins
    };
  } else if (trendsCache?.data) {
    return trendsCache.data; // Return stale cache on complete network failure
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
  return {};
}

// Per-account preference storage for FR-24 Feedback Loop
export interface RecommendationPreferences {
  handle: string;
  formatWeights: Record<string, number>;
  dislikedTopics: string[];
  likedTopics: string[];
  totalFeedbackCount: number;
  lastUpdated: string;
}

export function getRecPreferences(handle: string): RecommendationPreferences {
  const prefDir = path.join(config.localStorageDir, 'preferences');
  if (!fs.existsSync(prefDir)) fs.mkdirSync(prefDir, { recursive: true });
  const p = path.join(prefDir, `recs_${handle}.json`);
  if (fs.existsSync(p)) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (data && data.formatWeights) return data;
    } catch {}
  }
  return {
    handle,
    formatWeights: { reel: 1.0, video: 1.0, carousel: 1.0, image: 1.0 },
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
recommendationsRouter.post('/feedback', optionalAuth, async (req: Request, res: Response) => {
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

  // Enforce social account ownership if user is authenticated and account is claimed by another verified user
  if (req.auth?.userId && !isUserAccountOwnerOrAdmin(req, cleanHandle)) {
    const binding = findUserByHandle(cleanHandle);
    if (binding && binding.isVerified && binding.userId !== req.auth.userId) {
      return res.status(403).json({
        error: `Forbidden: You do not have permission to submit recommendation feedback for account @${cleanHandle}`,
        status: 403,
      });
    }
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

  // Invalidate recommendation cache so subsequent calls re-rank with updated weights
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

// GET /api/recommendations/preferences - View active preference weights (Requires account ownership or admin)
recommendationsRouter.get('/preferences', requireAuth, (req: Request, res: Response) => {
  const rawHandle = req.query.handle as string;
  if (!rawHandle) return res.status(400).json({ error: 'handle parameter is required' });
  let handle: string;
  try {
    handle = sanitizeAndValidateHandle(rawHandle);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  // Enforce account ownership: only account owner or administrator may view preferences
  if (!isUserAccountOwnerOrAdmin(req, handle)) {
    return res.status(403).json({
      error: `Forbidden: You do not have permission to view recommendation preferences for @${handle}`,
      status: 403,
    });
  }

  const prefs = getRecPreferences(handle);
  return res.json({ success: true, preferences: prefs });
});

// POST /api/recommendations/generate
recommendationsRouter.post('/generate', optionalAuth, async (req: Request, res: Response) => {
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

  // Enforce social account authorization for recommendation generation:
  // 1. Administrators can generate recommendations for any account.
  // 2. Verified account owners can generate recommendations for their account.
  // 3. Accounts claimed & verified by another registered user are strictly forbidden (403).
  // 4. Sample and demo accounts (e.g. cristiano, tahirabbas_ca) are accessible to demo visitors.
  if (!req.auth?.isAdmin) {
    const existingBinding = findUserByHandle(cleanHandle);
    if (existingBinding && existingBinding.isVerified && existingBinding.userId !== req.auth?.userId) {
      return res.status(403).json({
        error: `Forbidden: Social account @${cleanHandle} is registered and verified to another user`,
        status: 403,
      });
    }
  }

  // 1. Load user profile, posts, and niche
  const storageDir = config.localStorageDir;
  const profileFile = path.join(storageDir, 'profiles', `${cleanHandle}.json`);
  const postsFile = path.join(storageDir, 'posts', `${cleanHandle}.json`);
  const nicheFile = path.join(storageDir, 'niches', `${cleanHandle}.json`);

  let profile: any = {};
  let posts: any[] = [];
  let nicheData: any = {};

  if (fs.existsSync(profileFile)) {
    try { profile = JSON.parse(fs.readFileSync(profileFile, 'utf-8')); } catch {}
  }
  if (fs.existsSync(postsFile)) {
    try { posts = JSON.parse(fs.readFileSync(postsFile, 'utf-8')); } catch {}
  }
  if (fs.existsSync(nicheFile)) {
    try { nicheData = JSON.parse(fs.readFileSync(nicheFile, 'utf-8')); } catch {}
  }

  // If niche is missing or has 0 posts analyzed while posts exist on disk, execute analysis now
  if ((!nicheData?.niche || nicheData?.posts_analyzed === 0) && posts.length > 0) {
    try {
      const freshNiche = await executeNicheAnalysis(cleanHandle, platform);
      if (freshNiche?.nicheData) {
        nicheData = freshNiche.nicheData;
      }
    } catch {}
  }

  const followersCount = profile.followers_count || profile.followersCount || 10000;
  const userNiche = nicheData.niche || 'Digital Creator';
  const subNiche = nicheData.sub_niche || 'Audience Growth & Visual Media';
  const userLanguage = nicheData.language_preference || 'English';
  const contentPillars: string[] = nicheData.content_pillars || ['Core Expertise', 'Behind the Scenes', 'Community & Industry Insights'];

  // 2. Audience Tier & Format Effects Lift
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

  // 3. Compute Optimal Posting Window from historical posts
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
        hourScores[h] = {
          likes: (hourScores[h]?.likes || 0) + l,
          count: (hourScores[h]?.count || 0) + 1,
        };
        dayScores[day] = (dayScores[day] || 0) + l;
      }
    }
  }

  let peakHour = 17; // default 5:00 PM UTC
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

  // Best day
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const topDayIdx = Object.entries(dayScores).sort((a, b) => b[1] - a[1])[0]?.[0];
  const recommendedDayName = topDayIdx !== undefined ? dayNames[parseInt(topDayIdx, 10)] : 'Tuesday';

  // 4. Fetch Live Google Trends
  const liveTrends = await fetchGoogleTrends();

  // 5. Check persistent recommendation cache per handle (1 hour TTL) for instantaneous response
  const recsCacheFile = path.join(storageDir, 'recommendations', `${cleanHandle}.json`);
  const recsCacheDir = path.join(storageDir, 'recommendations');
  if (!fs.existsSync(recsCacheDir)) fs.mkdirSync(recsCacheDir, { recursive: true });

  const forceRefresh = req.body.refresh === true || req.query.refresh === 'true';

  if (!forceRefresh && fs.existsSync(recsCacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(recsCacheFile, 'utf-8'));
      const cacheAgeMs = Date.now() - new Date(cached.generated_at || 0).getTime();
      // If cache is under 1 hour old and has valid recommendations, return instantly!
      if (cacheAgeMs < 60 * 60 * 1000 && Array.isArray(cached.recommendations) && cached.recommendations.length > 0) {
        return res.json({
          ...cached,
          cached: true,
          cache_age_seconds: Math.round(cacheAgeMs / 1000),
        });
      }
    } catch {}
  }

  // 6. Generate AI Recommendations using Gemini
  const llmProvider = process.env.LLM_PROVIDER || 'mock';
  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  const canUseGemini = (llmProvider === 'gemini' || llmProvider === 'live') && Boolean(geminiApiKey && geminiApiKey.trim().length > 10);
  const userKeywords: string[] = Array.isArray(nicheData.keywords) ? nicheData.keywords : [];

  const sampleCaptions = posts
    .slice(0, 10)
    .map((p) => (p.caption || p.text || '').trim())
    .filter((c) => c.length > 10)
    .slice(0, 5)
    .map((c) => `"${c.slice(0, 150).replace(/\n/g, ' ')}"`);

  if (canUseGemini && liveTrends.length > 0) {
    const candidateModels = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
    const trendsContext = liveTrends.slice(0, 12).map((t) => ({
      title: t.title,
      traffic: t.traffic,
      source: t.source,
      news_headline: t.news_title || 'Breaking search interest',
      news_publisher: t.news_source || 'Google Trends',
    }));

    const aiPrompt = `You are an elite AI Content Strategy & Trend Recommendation Engine.
Analyze these real-time Google Search Trends, evaluate their relevance against this creator's verified niche and content pillars, and craft 3 highly actionable, viral-ready social media recommendations with next steps and full post drafts.

CREATOR PROFILE & NICHE GROUND TRUTH:
- Handle: @${cleanHandle}
- Full Name: ${profile.full_name || profile.fullName || cleanHandle}
- Verified Niche: ${userNiche}
- Sub-Niche: ${subNiche}
- Content Pillars: ${contentPillars.join(', ')}
- Core Keywords: ${userKeywords.length > 0 ? userKeywords.join(', ') : 'None specified'}
- Bio: "${profile.bio || profile.biography || ''}"
- Follower Tier: ${bucket} (${followersCount.toLocaleString()} followers)
- Dominant Highest-Lift Format: ${bestFormat} (+${(bestLift * 100).toFixed(1)}% lift)
- Optimal Time Window: ${optimalTimeWindow}
- Best Day: ${recommendedDayName}
- Preferred Language: ${userLanguage}
- Sample Post Captions from Creator:
${sampleCaptions.length > 0 ? sampleCaptions.map((sc, i) => `  ${i + 1}. ${sc}`).join('\n') : '  (No previous post captions available)'}

LIVE GOOGLE SEARCH TRENDS DETECTED RIGHT NOW:
${JSON.stringify(trendsContext, null, 2)}

INSTRUCTIONS & QUALITY CONTRACT:
1. Evaluate the live Google Trends against the creator's verified niche (${userNiche} - ${subNiche}).
2. If a live trend has a genuine direct or crossover connection to their niche (e.g. policy, economics, business, education, exam season, technology, leadership), adapt it with an authoritative perspective.
3. If the live search trends are completely unrelated to their niche (e.g. random football matches or celebrity gossip that cannot credibly connect to a professional in ${userNiche}), select the closest applicable trend OR synthesize the most urgent current trending topic in their specific domain (${userNiche}). Do NOT force absurd sports angles onto professional/accounting/tech creators.
4. For each recommendation, provide:
   - "next_steps": Array of exactly 3 sequential execution steps (Step 1: Hook & Concept, Step 2: Content Breakdown, Step 3: Call to Action & Distribution).
   - "creation_blueprint": Detailed object with hook, body (bullet points), call_to_action, and 3 production_tips.
   - "caption_draft": Complete, engaging ready-to-publish caption in natural ${userLanguage} with strong hook, emojis, clean line breaks, and a clear call to action.
   - "suggested_hashtags": Array of 5 targeted, high-converting hashtags matching their niche and topic.

Return ONLY a valid JSON array of exactly 3 objects conforming to this schema:
[
  {
    "id": "rec_1",
    "title": "Action-oriented title highlighting the trend and strategic hook",
    "trend_topic": "Exact search term or trending subject",
    "trend_source": "Google Trends (Live) or Domain Intelligence",
    "trend_traffic": "50K+ searches",
    "trend_news_context": "Context or headline driving the trend",
    "niche_match_score": 95,
    "pillar": "${contentPillars[0] || 'Core Expertise'}",
    "recommended_format": "${bestFormat}",
    "format_lift": "+${(bestLift * 100).toFixed(1)}% reach lift",
    "optimal_posting_time": "${optimalTimeWindow}",
    "recommended_day": "${recommendedDayName}",
    "rationale": "2-3 sentences explaining exactly why this trend aligns with their niche and why their specific audience will care right now.",
    "next_steps": [
      "Step 1: Hook & Angle - Record a 5-second vertical hook addressing...",
      "Step 2: Scripting & Visuals - Break down 3 concrete takeaways using...",
      "Step 3: Call to Action & Distribution - Prompt followers to comment... and pin your response."
    ],
    "creation_blueprint": {
      "hook": "Visual and auditory hook for the first 3 seconds",
      "body": "3 key points or slide-by-slide value delivery",
      "call_to_action": "Closing prompt for comments and saves",
      "production_tips": [
        "Tip 1...",
        "Tip 2...",
        "Tip 3..."
      ]
    },
    "caption_draft": "Ready-to-post caption text...",
    "suggested_hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]
  }
]`;

    for (const model of candidateModels) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const aiResp = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000), // 15s timeout for rich blueprints
          body: JSON.stringify({
            contents: [{ parts: [{ text: aiPrompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 6000,
              responseMimeType: 'application/json',
            },
          }),
        });

        if (!aiResp.ok) continue;

        const aiData = await aiResp.json();
        const rawText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        const cleanJsonText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

        const parsedRecs = JSON.parse(cleanJsonText);
        if (Array.isArray(parsedRecs) && parsedRecs.length === 3) {
          const payload = {
            success: true,
            handle: cleanHandle,
            user_niche: userNiche,
            sub_niche: subNiche,
            content_pillars: contentPillars,
            keywords: userKeywords,
            language_preference: userLanguage,
            follower_tier: bucket,
            optimal_time_window: optimalTimeWindow,
            dominant_format_recommendation: bestFormat,
            recommendations: parsedRecs,
            live_trend_signals: liveTrends.slice(0, 8),
            generated_at: new Date().toISOString(),
          };

          // Save to persistent cache
          try {
            fs.writeFileSync(recsCacheFile, JSON.stringify(payload, null, 2));
          } catch {}

          return res.json(payload);
        }
      } catch (err: any) {
        console.warn(`[recommendations] ${model} error: ${err.message}`);
      }
    }
  }

  // 7. Deterministic Niche-Grounded Fallback (Offline / Failover)
  const filteredLiveTrends = liveTrends.filter(
    (t) => !userPrefs.dislikedTopics.some((dt) => t.title.toLowerCase().includes(dt.toLowerCase()))
  );
  const candidateTrends = filteredLiveTrends.length >= 3 ? filteredLiveTrends : liveTrends;

  // Synthesize domain-relevant topics based on user's niche if trends are general
  const isFinanceOrAccounting = /account|finance|tax|ca|acca|audit/i.test(`${userNiche} ${subNiche}`);
  const isTechOrCode = /tech|code|software|developer|engineer|data|ai/i.test(`${userNiche} ${subNiche}`);
  const isFitness = /fitness|gym|workout|health|diet|nutrition/i.test(`${userNiche} ${subNiche}`);

  let fallbackTrends: any[];
  if (isFinanceOrAccounting) {
    fallbackTrends = [
      { title: 'Tax Filing Season Deadlines & Strategy', traffic: '50K+ searches', source: 'Domain Trend (Finance)', geo: 'PK', news_title: 'Key tax deduction changes and regulatory deadlines', news_source: 'Finance Bulletin' },
      { title: 'CA & ACCA Exam Preparation Frameworks', traffic: '25K+ searches', source: 'Domain Trend (Education)', geo: 'PK', news_title: 'Study strategies for passing high-stakes professional papers', news_source: 'Accounting Education' },
      { title: 'Corporate Cash Flow & Budget Planning for 2026', traffic: '15K+ searches', source: 'Domain Trend (Business)', geo: 'Global', news_title: 'SME financial management strategies in volatile markets', news_source: 'Business Review' },
    ];
  } else if (isTechOrCode) {
    fallbackTrends = [
      { title: 'Autonomous AI Agents in Production', traffic: '80K+ searches', source: 'Tech Intelligence', geo: 'Global', news_title: 'Engineering challenges deploying agentic workflows', news_source: 'Tech Insights' },
      { title: 'Modern Full-Stack Architecture Best Practices', traffic: '40K+ searches', source: 'Tech Intelligence', geo: 'Global', news_title: 'Microservices vs Modular Monoliths in 2026', news_source: 'Developer Digest' },
      { title: 'Mastering System Design & Technical Interviews', traffic: '30K+ searches', source: 'Tech Intelligence', geo: 'Global', news_title: 'High-scale caching and distributed consensus principles', news_source: 'Engineering Weekly' },
    ];
  } else if (isFitness) {
    fallbackTrends = [
      { title: 'High-Protein Nutrition Timing for Hypertrophy', traffic: '60K+ searches', source: 'Fitness Trends', geo: 'Global', news_title: 'New research on nutrient distribution and recovery', news_source: 'Sports Science' },
      { title: 'Progressive Overload Fundamentals for Beginners', traffic: '35K+ searches', source: 'Fitness Trends', geo: 'Global', news_title: 'Avoiding training plateaus with structured periodization', news_source: 'Fitness Journal' },
      { title: 'Mobility & Injury Prevention Routine', traffic: '20K+ searches', source: 'Fitness Trends', geo: 'Global', news_title: 'Daily mobility protocols for desk workers and athletes', news_source: 'Health Review' },
    ];
  } else if (candidateTrends.length >= 3) {
    fallbackTrends = candidateTrends.slice(0, 3);
  } else {
    fallbackTrends = [
      { title: `${contentPillars[0] || userNiche}: Core Practical Breakdown`, traffic: 'Trending', source: 'Domain Trend', geo: 'Global', news_title: `Essential strategies and best practices in ${userNiche}`, news_source: 'Industry Insights' },
      { title: `Emerging Shifts in ${subNiche}`, traffic: 'Trending', source: 'Domain Trend', geo: 'Global', news_title: `Key developments reshaping ${subNiche} today`, news_source: 'Creator Report' },
      { title: `Actionable Playbook for ${userNiche} Practitioners`, traffic: 'High Demand', source: 'Domain Trend', geo: 'Global', news_title: `Step-by-step framework to elevate execution in ${userNiche}`, news_source: 'Strategy Guide' },
    ];
  }

  const recommendations = fallbackTrends.slice(0, 3).map((trend, idx) => {
    const isReel = idx === 0 ? bestFormat : idx === 1 ? (bestFormat === 'reel' ? 'carousel' : 'reel') : 'image';
    const liftStr = isReel === 'reel' ? `+${(bestLift * 100).toFixed(1)}% reach lift` : isReel === 'carousel' ? '+24.5% saves & shares' : '+15.0% comment rate';
    const dayStr = idx === 0 ? `${recommendedDayName} (Peak Activity)` : idx === 1 ? 'Wednesday / Thursday' : 'Sunday Evening';

    return {
      id: `rec_${idx + 1}`,
      title: `${trend.title}`,
      trend_topic: trend.title,
      trend_source: trend.source || 'Domain Intelligence',
      trend_traffic: trend.traffic || 'Trending Now',
      trend_news_context: trend.news_title ? `${trend.news_title} (${trend.news_source || 'Industry Insights'})` : undefined,
      niche_match_score: 96 - idx * 3,
      pillar: contentPillars[idx] || contentPillars[0] || userNiche,
      recommended_format: isReel,
      format_lift: liftStr,
      optimal_posting_time: optimalTimeWindow,
      recommended_day: dayStr,
      rationale: `${liftExplanation} Connects the surge in search demand for "${trend.title}" directly to your established authority in ${userNiche}.`,
      next_steps: [
        `Step 1: Hook & Angle - Record a 5-second vertical clip introducing "${trend.title}" with a high-stakes question.`,
        `Step 2: Scripting & Visuals - Break down 3 essential takeaways with on-screen text overlays matching your ${userNiche} expertise.`,
        `Step 3: Call to Action & Distribution - Direct viewers to save this guide for reference and drop their questions in the comments.`,
      ],
      caption_draft: generateLocalizedCaption(userLanguage, trend.title, userNiche, idx + 1),
      suggested_hashtags: generateHashtags(userNiche, trend.title),
      creation_blueprint: {
        hook: `First 3 seconds / Slide 1: Bold provocative statement or question regarding "${trend.title}".`,
        body: `Next 15-25 seconds: 3 evidence-backed perspectives tying the topic to real practical application in ${userNiche}.`,
        call_to_action: `Final 5 seconds: Direct audience prompt asking for their thoughts in the comments.`,
        production_tips: [
          `Format: 9:16 vertical ratio with high-contrast text overlays in the top third of the frame.`,
          `Pacing: Cut or visual transition every 2.5 seconds to maximize completion rate.`,
          `Engagement: Pin your own comment posing a specific discussion question within 15 minutes of posting.`,
        ],
      },
    };
  });

  const payload = {
    success: true,
    handle: cleanHandle,
    user_niche: userNiche,
    sub_niche: subNiche,
    content_pillars: contentPillars,
    keywords: userKeywords,
    language_preference: userLanguage,
    follower_tier: bucket,
    optimal_time_window: optimalTimeWindow,
    dominant_format_recommendation: bestFormat,
    recommendations,
    live_trend_signals: liveTrends.slice(0, 8),
    generated_at: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(recsCacheFile, JSON.stringify(payload, null, 2));
  } catch {}

  return res.json(payload);
});

// Helper: Localized caption generator
function generateLocalizedCaption(lang: string, topic: string, niche: string, index: number): string {
  const l = (lang || 'English').toLowerCase();

  if (l.includes('urdu') || l.includes('hindi')) {
    if (l.includes('roman') || l.includes('bilingual')) {
      if (index === 1) {
        return `Aaj hum baat kar rahe hain ${topic} ke baare mein! 🔥 Yeh topic is waqt top trending par hai aur iska direct asar hamari community par parta hai. Aapka is par kya khayal hai? Comments mein zaroor batayein! 👇`;
      } else if (index === 2) {
        return `Bohat se log ${topic} ke baray mein ahem pehlu miss kar dete hain. Is post mein 4 ahem facts share kiye hain jo har kisi ko janne chahiyen. Save karlein baad ke liye! 📌`;
      } else {
        return `Weekly perspective: ${topic} se hum ne kya seekha? Apni raye share karein, aain mil kar discuss karte hain. 💬✨`;
      }
    } else {
      return `${topic} کے حوالے سے سب سے اہم نکات جو آپ کو معلوم ہونے چاہئیں۔ اس پوسٹ کو محفوظ کر لیں اور اپنی رائے کمنٹس میں بتائیں! 👇`;
    }
  } else if (l.includes('portuguese')) {
    return `Em foco hoje: ${topic}. Uma análise direta e necessária sobre como isso impacta nosso dia a dia. Deixe sua opinião nos comentários abaixo! 👇⚽️`;
  } else if (l.includes('spanish')) {
    return `¡Analizando a fondo ${topic}! Puntos clave sobre esta tendencia y su impacto directo. ¿Cuál es tu experiencia? ¡Comenta abajo! 👇`;
  }

  // English default
  if (index === 1) {
    return `Breaking down the real dynamics behind ${topic}. While search interest is surging, the underlying conversation that matters most is how this affects everyday people. Here are the 3 takeaways you need to know. What’s your take? Drop your thoughts below 👇`;
  } else if (index === 2) {
    return `The biggest overlooked reality about ${topic}—and why standard headlines are missing the point. Swipe through for the full evidence breakdown. Make sure to save this post for reference! 📌`;
  } else {
    return `Perspective on ${topic}: Systems don’t change until we pay attention and demand accountability. How are you approaching this in your own work? Let’s discuss in the comments 💬`;
  }
}

// Helper: Hashtag generator
function generateHashtags(niche: string, topic: string): string[] {
  const cleanNiche = niche.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanTopic = topic.toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = [`#${cleanNiche}`, `#${cleanTopic}`, '#trending', '#googleTrends', '#contentStrategy'];
  return [...new Set(base)].slice(0, 5);
}
