import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { executeNicheAnalysis } from './onboarding.js';
import { sanitizeAndValidateHandle, createRateLimiter } from '../lib/security.js';
import { requireAuth, requireUserOrAdmin, isUserAccountOwnerOrAdmin, findUserByHandle, getUserLinkedHandleRecord } from '../lib/auth.js';

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
        signal: AbortSignal.timeout(2500), // 2.5s timeout per geo
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
recommendationsRouter.post('/feedback', requireUserOrAdmin, async (req: Request, res: Response) => {
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

  // Enforce social account ownership
  if (!isUserAccountOwnerOrAdmin(req, cleanHandle)) {
    return res.status(403).json({
      error: `Forbidden: You do not have permission to submit recommendation feedback for account @${cleanHandle}`,
      status: 403,
    });
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
recommendationsRouter.post('/generate', requireUserOrAdmin, async (req: Request, res: Response) => {
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
  // 2. Verified or registered account owners can generate recommendations for their account.
  // 3. Accounts claimed by another registered user are strictly forbidden (403).
  // 4. Unclaimed demo accounts (e.g. cristiano) are accessible to authenticated users.
  if (!req.auth?.isAdmin) {
    const existingBinding = findUserByHandle(cleanHandle);
    if (existingBinding && existingBinding.userId !== req.auth?.userId) {
      return res.status(403).json({
        error: `Forbidden: Social account @${cleanHandle} is registered to another user`,
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

  // 6. Generate AI Recommendations using ultra-fast gemini-3.1-flash-lite
  const llmProvider = process.env.LLM_PROVIDER || 'mock';
  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  const canUseGemini = llmProvider === 'gemini' && geminiApiKey.startsWith('AIzaSy');

  if (canUseGemini && liveTrends.length > 0) {
    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
    const trendsContext = liveTrends.slice(0, 10).map((t) => ({
      title: t.title,
      traffic: t.traffic,
      source: t.source,
      news_headline: t.news_title || 'Breaking search interest',
      news_publisher: t.news_source || 'Google Trends',
    }));

    const aiPrompt = `You are an elite AI Content Strategy & Trend Recommendation Engine.
Analyze these real, live Google Search Trends and correlate them against this creator's profile:

CREATOR PROFILE:
- Handle: @${cleanHandle}
- Full Name: ${profile.full_name || profile.fullName || cleanHandle}
- Verified Niche: ${userNiche} (${subNiche})
- Bio: "${profile.bio || profile.biography || ''}"
- Content Pillars: ${contentPillars.join(', ')}
- Follower Tier: ${bucket} (${followersCount.toLocaleString()} followers)
- Dominant Highest-Lift Format: ${bestFormat} (+${(bestLift * 100).toFixed(1)}% lift)
- Optimal Time Window: ${optimalTimeWindow}
- Best Day: ${recommendedDayName}
- Preferred Language: ${userLanguage}

LIVE GOOGLE SEARCH TRENDS DETECTED RIGHT NOW:
${JSON.stringify(trendsContext, null, 2)}

TASK:
Select the 3 most promising live Google Trends and adapt each into a high-authority social media post recommendation specifically crafted for this creator's niche.
Even if a trend seems broad, find the authoritative, relevant crossover angle (e.g. healthcare leader discussing health/policy implications; athlete discussing sports/discipline; tech creator discussing automation/tools).

For each of the 3 recommendations, return:
- "id": "rec_1", "rec_2", "rec_3"
- "title": Action-oriented title highlighting the trend and strategic hook
- "trend_topic": Exact search term from Google Trends
- "trend_source": The Google Trends source (e.g., "Google Trends (US)")
- "trend_traffic": Search volume (e.g., "1,000+ searches", "50K+ searches")
- "trend_news_context": The headline and publisher from the trend context
- "niche_match_score": Integer 88-99
- "pillar": The creator pillar it maps to
- "recommended_format": "reel" | "carousel" | "image"
- "format_lift": "+X% algorithmic discovery"
- "optimal_posting_time": The calibrated window
- "recommended_day": The recommended day(s)
- "rationale": 2-3 sentences detailing WHY this live Google search trend connects to their niche and audience right now.
- "caption_draft": Ready-to-publish localized caption in ${userLanguage} with strong opening hook, core value body, and engagement call-to-action.
- "suggested_hashtags": 5 relevant hashtags including niche and trend topic.
- "creation_blueprint":
  - "hook": What to do/show in the first 3 seconds (or slide 1)
  - "body": What to cover in the middle 15-25 seconds (or slides 2-5)
  - "call_to_action": Specific prompt for comments/saves
  - "production_tips": 3 actionable production/filming/framing tips

Output ONLY a valid JSON array of 3 objects. No markdown backticks.`;

    for (const model of candidateModels) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const aiResp = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(6000), // Fast 6s timeout
          body: JSON.stringify({
            contents: [{ parts: [{ text: aiPrompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 2000,
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

  // 7. Deterministic Instant Offline Fallback with Live Google Trends
  const filteredLiveTrends = liveTrends.filter(
    (t) => !userPrefs.dislikedTopics.some((dt) => t.title.toLowerCase().includes(dt.toLowerCase()))
  );
  const candidateTrends = filteredLiveTrends.length >= 3 ? filteredLiveTrends : liveTrends;
  const topTrends = candidateTrends.slice(0, 3);
  const fallbackTrends = topTrends.length >= 3 ? topTrends : [
    { title: 'Public Policy and Healthcare Access', traffic: '50K+ searches', source: 'Google Trends (US)', geo: 'US', news_title: 'National healthcare reform and infrastructure focus', news_source: 'National News' },
    { title: 'Community Organizing and Civic Action', traffic: '20K+ searches', source: 'Google Trends (US)', geo: 'US', news_title: 'Voter turnout and grassroots community development', news_source: 'Civic Report' },
    { title: 'Accountability in Leadership', traffic: '10K+ searches', source: 'Google Trends (US)', geo: 'US', news_title: 'Oversight and transparent governance standards', news_source: 'Policy Review' },
  ];

  const recommendations = fallbackTrends.slice(0, 3).map((trend, idx) => {
    const isReel = idx === 0 ? bestFormat : idx === 1 ? (bestFormat === 'reel' ? 'carousel' : 'reel') : 'image';
    const liftStr = isReel === 'reel' ? `+${(bestLift * 100).toFixed(1)}% reach lift` : isReel === 'carousel' ? '+24.5% saves & shares' : '+15.0% comment rate';
    const dayStr = idx === 0 ? `${recommendedDayName} (Peak Activity)` : idx === 1 ? 'Wednesday / Thursday' : 'Sunday Evening';

    return {
      id: `rec_${idx + 1}`,
      title: `Trending: ${trend.title}`,
      trend_topic: trend.title,
      trend_source: trend.source || 'Google Trends (Live)',
      trend_traffic: trend.traffic || 'Trending',
      trend_news_context: trend.news_title ? `${trend.news_title} (${trend.news_source || 'Google Trends'})` : undefined,
      niche_match_score: 95 - idx * 4,
      pillar: contentPillars[idx] || contentPillars[0],
      recommended_format: isReel,
      format_lift: liftStr,
      optimal_posting_time: optimalTimeWindow,
      recommended_day: dayStr,
      rationale: `${liftExplanation} Capitalizes on the active Google search trend for "${trend.title}" while directly grounding the discussion in your ${userNiche} authority.`,
      caption_draft: generateLocalizedCaption(userLanguage, trend.title, userNiche, idx + 1),
      suggested_hashtags: generateHashtags(userNiche, trend.title),
      creation_blueprint: {
        hook: `First 3 seconds / Slide 1: Bold provocative statement or question regarding "${trend.title}".`,
        body: `Next 15-25 seconds: 3 evidence-backed perspectives tying the trend to real community impact.`,
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
