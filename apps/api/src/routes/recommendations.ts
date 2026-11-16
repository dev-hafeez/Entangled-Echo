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

export interface CaptionOption {
  style: string;
  hook: string;
  text: string;
}

export interface HashtagBundles {
  niche: string[];
  broad: string[];
  trending: string[];
}

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

  const followersCount = profile.followers_count ?? profile.followersCount ?? 0;
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
4. For each recommendation, provide VARIETY in captions and hashtags:
   - "next_steps": Array of exactly 3 sequential execution steps (Step 1: Hook & Concept, Step 2: Content Breakdown, Step 3: Call to Action & Distribution).
   - "creation_blueprint": Detailed object with hook, body (bullet points), call_to_action, and 3 production_tips.
   - "caption_options": Array of 3 distinctly styled, ready-to-post captions in natural ${userLanguage}:
     1. Style "Storytelling & Relatable": narrative hook, personal/relatable insight or dilemma, conversational question CTA inviting comments.
     2. Style "Short & Punchy (Viral)": bold 1-line curiosity gap opening, rapid bullet points, quick save/share CTA.
     3. Style "In-Depth Breakdown (Save-Worthy)": authoritative educational guide, structured step-by-step takeaways, bookmark/save CTA.
   - "caption_draft": Set to the top primary caption text (for 1-click posting).
   - "hashtag_bundles": Categorized hashtag strategy containing 3 distinct bundles:
     - "niche": 5 hyper-targeted tags directly matching ${userNiche} and its community.
     - "broad": 5 high-reach industry discovery tags.
     - "trending": 5 viral and search-trend discovery tags.
   - "suggested_hashtags": Combined list of 8-12 unique hashtags selected from the bundles.

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
    "caption_draft": "Primary ready-to-post caption text...",
    "caption_options": [
      {
        "style": "Storytelling & Relatable",
        "hook": "Relatable narrative hook...",
        "text": "Full storytelling caption with emojis and spacing..."
      },
      {
        "style": "Short & Punchy (Viral)",
        "hook": "Bold 1-sentence curiosity hook...",
        "text": "Full punchy minimalist caption with emojis..."
      },
      {
        "style": "In-Depth Breakdown (Save-Worthy)",
        "hook": "Authoritative guide hook...",
        "text": "Full value-dense breakdown with numbered points..."
      }
    ],
    "hashtag_bundles": {
      "niche": ["#niche1", "#niche2", "#niche3", "#niche4", "#niche5"],
      "broad": ["#broad1", "#broad2", "#broad3", "#broad4", "#broad5"],
      "trending": ["#trend1", "#trend2", "#trend3", "#trend4", "#trend5"]
    },
    "suggested_hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5", "#tag6", "#tag7", "#tag8"]
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
          const normalizedRecs = parsedRecs.map((rec: any, rIdx: number) => {
            const variations = Array.isArray(rec.caption_options) && rec.caption_options.length >= 3
              ? rec.caption_options
              : generateCaptionVariations(userLanguage, rec.trend_topic || rec.title, userNiche, rIdx + 1);

            const bundles = rec.hashtag_bundles && typeof rec.hashtag_bundles === 'object' && Array.isArray(rec.hashtag_bundles.niche)
              ? rec.hashtag_bundles
              : generateHashtagBundles(userNiche, subNiche, rec.trend_topic || rec.title, userKeywords);

            const allTags = Array.isArray(rec.suggested_hashtags) && rec.suggested_hashtags.length >= 5
              ? rec.suggested_hashtags
              : [...(bundles.niche || []), ...(bundles.broad || []), ...(bundles.trending || [])];

            return {
              ...rec,
              caption_draft: rec.caption_draft || variations[0].text,
              caption_options: variations,
              hashtag_bundles: bundles,
              suggested_hashtags: [...new Set(allTags)].slice(0, 12),
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
            recommendations: normalizedRecs,
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

  // Correlate live trends against creator niche, sub-niche, and content pillars
  const nicheKeywords = [
    ...userNiche.toLowerCase().split(/\s+/),
    ...subNiche.toLowerCase().split(/\s+/),
    ...contentPillars.flatMap((p) => p.toLowerCase().split(/\s+/)),
    ...userKeywords.map((k) => k.toLowerCase()),
  ].filter((w) => w.length > 3);

  const matchedLiveTrends = candidateTrends.filter((t) => {
    const text = `${t.title} ${t.news_title || ''}`.toLowerCase();
    return nicheKeywords.some((kw) => text.includes(kw));
  });

  const fallbackTrends: any[] = [...matchedLiveTrends];

  // If live trends didn't yield 3 direct niche matches, synthesize authoritative topics directly from creator's verified pillars
  const defaultPillars = contentPillars.length >= 3 ? contentPillars : [
    `${userNiche} Fundamentals & Execution`,
    `Emerging Shifts in ${subNiche}`,
    `Actionable Frameworks for ${userNiche} Community`,
  ];

  for (let i = fallbackTrends.length; i < 3; i++) {
    const pillarName = defaultPillars[i] || defaultPillars[0] || userNiche;
    fallbackTrends.push({
      title: `${pillarName}: Practical Breakdown & Strategy`,
      traffic: 'High Demand',
      source: 'Domain Intelligence',
      geo: 'Global',
      news_title: `Essential principles and modern execution in ${userNiche}`,
      news_source: `${userNiche} Insights`,
    });
  }

  const recommendations = fallbackTrends.slice(0, 3).map((trend, idx) => {
    const isReel = idx === 0 ? bestFormat : idx === 1 ? (bestFormat === 'reel' ? 'carousel' : 'reel') : 'image';
    const liftStr = isReel === 'reel' ? `+${(bestLift * 100).toFixed(1)}% reach lift` : isReel === 'carousel' ? '+24.5% saves & shares' : '+15.0% comment rate';
    const dayStr = idx === 0 ? `${recommendedDayName} (Peak Activity)` : idx === 1 ? 'Wednesday / Thursday' : 'Sunday Evening';

    const captionOptions = generateCaptionVariations(userLanguage, trend.title, userNiche, idx + 1);
    const hashtagBundles = generateHashtagBundles(userNiche, subNiche, trend.title, userKeywords);
    const allTags = [...new Set([...hashtagBundles.niche, ...hashtagBundles.broad, ...hashtagBundles.trending])].slice(0, 12);

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
      caption_draft: captionOptions[0].text,
      caption_options: captionOptions,
      hashtag_bundles: hashtagBundles,
      suggested_hashtags: allTags,
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

// Helper: Multi-Style Caption Generator (Variety Engine)
export function generateCaptionVariations(
  lang: string,
  topic: string,
  niche: string,
  index: number
): CaptionOption[] {
  const l = (lang || 'English').toLowerCase();
  const isUrdu = l.includes('urdu') || l.includes('hindi');
  const isRomanUrdu = isUrdu && (l.includes('roman') || l.includes('bilingual') || !l.includes('script'));

  if (isRomanUrdu) {
    return [
      {
        style: 'Storytelling & Relatable',
        hook: `Jab maine pehli dafa ${topic} ke baray mein suna, mujhe laga yeh normal hai—lekin haqeeqat kuch aur nikli... 💭`,
        text: `Jab maine pehli dafa ${topic} ke baray mein suna, mujhe laga yeh bas ek passing headline hai—lekin haqeeqat mein iska direct asar hamare career aur industry standard par parta hai. 🔥\n\nAgar aap bhi is field mein grow karna chahte hain, toh yeh 3 ahem batein zaroor samajh lein:\n1️⃣ Trend ko pehle analyze karein, blind follow na karein\n2️⃣ Apni core skills aur practical execution par focus rakhein\n3️⃣ Long-term consistency hi asal game-changer hai\n\nAapka is baray mein kya personal experience raha hai? Comments mein zaroor share karein! 👇`,
      },
      {
        style: 'Short & Punchy (Viral)',
        hook: `Stop scrolling agar aap ${topic} ko ignore kar rahe hain! 🛑⚡`,
        text: `Stop scrolling agar aap ${topic} ko ignore kar rahe hain! 🛑⚡\n\nYeh choti si ghalti aapke weeks ka waqt zaya kar sakti hai. 3 golden rules jo har professional ko pata honi chahiyen:\n• Rule 1: Fundamentals always first\n• Rule 2: Execution beats overthinking\n• Rule 3: Speed with precision\n\n📌 Save karlein baad ke liye aur apne dost ke sath share karein!`,
      },
      {
        style: 'In-Depth Breakdown (Save-Worthy)',
        hook: `The Complete Action Blueprint: ${topic} se maximum results kaise hasil karein? 📚🎯`,
        text: `The Complete Action Blueprint: ${topic} se maximum results kaise hasil karein? 📚🎯\n\nBohat se log surface-level tips dekh kar confuse ho jate hain. Yeh hai practical step-by-step breakdown:\n\nStep 1: Foundational Clarity — Pehle problem aur core concepts ko deeply understand karein.\nStep 2: Structured Execution — Rozana 30-45 minutes dedicated practice aur testing dein.\nStep 3: Review & Refine — Har weekend par apni progress evaluate karein.\n\nBookmark this guide! 💾 Drop your questions below and I will reply to each one. 💬`,
      },
    ];
  }

  // English default variations
  return [
    {
      style: 'Storytelling & Relatable',
      hook: `I used to think ${topic} was just another headline—until I looked at the actual numbers. 💭`,
      text: `I used to think ${topic} was just another headline—until I looked at the actual numbers and what it means for creators and professionals in ${niche}. 📈\n\nHere is the real truth most people are missing:\n• It's not about jumping on every wave; it's about connecting it to your unique expertise.\n• The creators winning right now are translating complex updates into immediate, actionable insights.\n• Consistency during market shifts is where real authority is built.\n\nWhat’s your biggest takeaway from this trend? Let’s talk in the comments below! 👇`,
    },
    {
      style: 'Short & Punchy (Viral)',
      hook: `Stop making this mistake when dealing with ${topic}! 🛑⚡`,
      text: `Stop making this mistake when dealing with ${topic}! 🛑⚡\n\n3 quick rules you need to know today:\n1️⃣ Focus on execution over endless debate.\n2️⃣ Double down on what your specific audience actually cares about.\n3️⃣ Simplicity always beats unnecessary complexity.\n\nDouble tap if this resonates & save for your next planning session! 📌`,
    },
    {
      style: 'In-Depth Breakdown (Save-Worthy)',
      hook: `The Ultimate Playbook: How to Master ${topic} Step-by-Step 📚🎯`,
      text: `The Ultimate Playbook: How to Master ${topic} Step-by-Step 📚🎯\n\nWhile search interest is peaking, here is the structured framework you need to implement right now:\n\n1. Strategic Context: Understand the driving forces behind this shift rather than just reacting.\n2. Tactical Framework: Focus on high-leverage workflows that protect your time and amplify output.\n3. Measurable Impact: Benchmark your progress weekly with tangible metrics.\n\nSave this post to your study/work collection! 💾 Drop any questions below and I'll jump into the thread. 💬`,
    },
  ];
}

// Backward compatible helper
export function generateLocalizedCaption(lang: string, topic: string, niche: string, index: number): string {
  const variations = generateCaptionVariations(lang, topic, niche, index);
  return variations[0]?.text || '';
}

// Helper: Multi-Tier Strategic Hashtag Generator (Variety Bundles)
export function generateHashtagBundles(
  niche: string,
  subNiche: string,
  topic: string,
  keywords: string[] = []
): HashtagBundles {
  const cleanTag = (str: string) => {
    const cleaned = str.toLowerCase().replace(/[^a-z0-9]/g, '');
    return cleaned ? '#' + cleaned : '';
  };

  const nicheBase = [
    cleanTag(niche),
    cleanTag(subNiche),
    ...keywords.slice(0, 4).map(cleanTag),
    '#expertinsights',
    '#communityfirst',
  ].filter((t) => t.length > 2);

  const broadBase = [
    cleanTag(niche.split(' ')[0] || 'business'),
    '#education',
    '#careeradvice',
    '#growthmindset',
    '#professionaldevelopment',
    '#learningeveryday',
    '#leadership',
  ].filter((t) => t.length > 2);

  const cleanTopic = cleanTag(topic);
  const trendingBase = [
    cleanTopic,
    '#trendingnow',
    '#googletrends',
    '#viralreels',
    '#explorepage',
    '#dailyinsights',
    '#algorithmhacks',
  ].filter((t) => t.length > 2);

  return {
    niche: [...new Set(nicheBase)].slice(0, 5),
    broad: [...new Set(broadBase)].slice(0, 5),
    trending: [...new Set(trendingBase)].slice(0, 5),
  };
}

// Backward compatible helper
export function generateHashtags(niche: string, topic: string): string[] {
  const bundles = generateHashtagBundles(niche, '', topic);
  return [...new Set([...bundles.niche, ...bundles.trending])].slice(0, 5);
}
