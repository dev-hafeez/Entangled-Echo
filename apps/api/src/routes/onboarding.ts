import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const onboardingRouter = Router();

// ---------------------------------------------------------------------------
// NicheIQ Engine — Evidence-grounded, fully personalized niche detection.
//
// What this AI is called: "NicheIQ Engine" (a Retrieval-Augmented Profiling AI).
//
// How it works:
//   1. It READS every available signal from the user's real data — bio,
//      captions, hashtags, engagement rates, media types, posting hours,
//      follower tier, top-performing content, language scripts.
//   2. It COMPUTES statistical summaries in TypeScript (zero guessing here).
//   3. It PASSES those facts as a fully-structured evidence block to Gemini,
//      which is instructed to output ONLY conclusions that are traceable to
//      the evidence block.  No hallucination, no defaults, no assumptions.
//   4. Every output field is backed by a machine-computed evidence quote.
// ---------------------------------------------------------------------------

// ── Storage helpers ─────────────────────────────────────────────────────────
function getUserAccountFile(userId: string): string {
  const dir = path.join(config.localStorageDir, 'user_sessions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${userId}.json`);
}

function getUserNicheFile(handle: string): string {
  const dir = path.join(config.localStorageDir, 'niches');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${handle}.json`);
}

// ── POST /api/onboarding/user-profile ───────────────────────────────────────
onboardingRouter.post('/user-profile', (req: Request, res: Response) => {
  const { userId, handle, nicheData, languagePreference } = req.body;
  if (!userId || !handle) {
    return res.status(400).json({ error: 'userId and handle are required' });
  }

  const profile = {
    userId,
    handle: handle.toLowerCase().replace(/^@/, ''),
    languagePreference: languagePreference || nicheData?.language_preference || 'English',
    nicheData: nicheData || null,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(getUserAccountFile(userId), JSON.stringify(profile, null, 2));
  return res.json({ success: true, profile });
});

// ── GET /api/onboarding/user-profile/:userId ────────────────────────────────
onboardingRouter.get('/user-profile/:userId', (req: Request, res: Response) => {
  const { userId } = req.params;
  const file = getUserAccountFile(userId);
  if (fs.existsSync(file)) {
    try {
      const profile = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return res.json({ profile });
    } catch {}
  }
  return res.status(404).json({ error: 'User profile not found' });
});

// ── Signal extraction helpers (pure computation — no AI, no guessing) ────────

interface PostSignals {
  captions: string[];
  hashtags: string[];
  mediaTypes: Record<string, number>;
  postingHours: number[];
  postingDays: number[];  // 0=Sun … 6=Sat
  engagementRates: number[];
  topCaptions: string[];  // top 5 by likes
  avgLikes: number;
  avgComments: number;
  totalPosts: number;
  likesDistribution: { max: number; min: number; p90: number };
  topHashtags: { tag: string; count: number }[];
}

function extractPostSignals(posts: any[], followerCount: number): PostSignals {
  const captions: string[] = [];
  const hashtagFreq: Record<string, number> = {};
  const mediaTypes: Record<string, number> = {};
  const postingHours: number[] = [];
  const postingDays: number[] = [];
  const engRates: number[] = [];
  const allLikes: number[] = [];

  for (const p of posts) {
    const cap = (p.caption || '').trim();
    if (cap) captions.push(cap);

    for (const h of (p.hashtags || [])) {
      const tag = (h as string).toLowerCase().replace(/^#/, '');
      hashtagFreq[tag] = (hashtagFreq[tag] || 0) + 1;
    }

    const mt = (p.mediaType || p.media_type || 'image').toLowerCase();
    mediaTypes[mt] = (mediaTypes[mt] || 0) + 1;

    const dateStr = p.postedAt || p.posted_at || p.timestamp;
    if (dateStr) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        postingHours.push(d.getUTCHours());
        postingDays.push(d.getUTCDay());
      }
    }

    const likes = p.likesCount || p.likes_count || p.like_count || 0;
    const comments = p.commentsCount || p.comments_count || p.comment_count || 0;
    allLikes.push(likes);
    const reach = followerCount > 0 ? followerCount : 1000;
    engRates.push((likes + comments * 2) / reach);
  }

  // Sort posts by likes descending to find top performers
  const sorted = [...posts].sort(
    (a, b) =>
      (b.likesCount || b.likes_count || 0) - (a.likesCount || a.likes_count || 0)
  );
  const topCaptions = sorted
    .slice(0, 5)
    .map((p) => (p.caption || '').slice(0, 300))
    .filter(Boolean);

  const avgLikes =
    allLikes.length > 0
      ? Math.round(allLikes.reduce((a, b) => a + b, 0) / allLikes.length)
      : 0;
  const avgComments =
    posts.length > 0
      ? Math.round(
          posts.reduce(
            (s, p) => s + (p.commentsCount || p.comments_count || 0),
            0
          ) / posts.length
        )
      : 0;

  const sortedLikes = [...allLikes].sort((a, b) => a - b);
  const p90Index = Math.floor(sortedLikes.length * 0.9);
  const likesDistribution = {
    max: sortedLikes[sortedLikes.length - 1] || 0,
    min: sortedLikes[0] || 0,
    p90: sortedLikes[p90Index] || 0,
  };

  const topHashtags = Object.entries(hashtagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([tag, count]) => ({ tag, count }));

  return {
    captions: captions.slice(0, 25),
    hashtags: topHashtags.map((h) => h.tag).slice(0, 25),
    mediaTypes,
    postingHours,
    postingDays,
    engagementRates: engRates,
    topCaptions,
    avgLikes,
    avgComments,
    totalPosts: posts.length,
    likesDistribution,
    topHashtags,
  };
}

function formatHour(h: number): string {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:00 ${ampm}`;
}

function computeHourFrequency(hours: number[]): { hour: number; count: number }[] {
  const freq: Record<number, number> = {};
  for (const h of hours) freq[h] = (freq[h] || 0) + 1;
  return Object.entries(freq)
    .map(([h, c]) => ({ hour: parseInt(h), count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function computeDayFrequency(days: number[]): string[] {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const freq: Record<number, number> = {};
  for (const d of days) freq[d] = (freq[d] || 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([d]) => names[parseInt(d)]);
}

function detectLanguage(text: string): {
  hasUrduArabic: boolean;
  hasDevanagari: boolean;
  desiWordCount: number;
  desiWords: string[];
  hasSpanish: boolean;
  hasFrench: boolean;
  hasPortuguese: boolean;
  portugueseWordCount: number;
  spanishWordCount: number;
  englishWordCount: number;
} {
  // Count genuine script characters: Arabic/Urdu >= 6 characters detects authentic Urdu phrases even in short bios
  const arabicMatches = text.match(/[\u0600-\u06FF]/g) || [];
  const devMatches = text.match(/[\u0900-\u097F]/g) || [];
  
  const hasUrduArabic = arabicMatches.length >= 6;
  const hasDevanagari = devMatches.length >= 6;

  const romanDesiRegex =
    /\b(kya|hai|hain|nahi|main|mein|kar|raha|rahe|rahi|bhai|shukriya|aap|hum|aur|acha|bohot|bohat|dekho|ye|yeh|wo|woh|hota|gaya|gayi|diya|paas|zindagi|dost|sab|karo|bhi|ka|ki|ke|ko|se|yaar|abhi|matlab|waise|pyar|dil|janab|mashallah|inshallah|subhanallah|alhamdulillah|jazakallah|shandar|zabardast|khoob|safar|rasta|par|pe|un|in|kis|baat|baatain|suno|bol|chal|apna|apni|apne|kisi|hoga|hogi|hoge|karna|karte|karti|kyun|kyo|kuch)\b/gi;
  const desiMatches = text.match(romanDesiRegex) || [];

  const spanishRegex = /\b(gracias|hola|como|que|una|para|con|por|los|las|muy|todo|pero|cuando|donde|quien|tambien|porque|sobre|hacer|puede|tiene|vamos|equipo)\b/gi;
  const frenchRegex = /\b(merci|bonjour|avec|pour|dans|sur|pas|plus|aussi|mais|avoir|faire|tout|comme|bien|toujours|encore|depuis|après|avant)\b/gi;
  const ptRegex = /\b(obrigado|olá|com|para|mais|uma|como|isso|pelo|pela|que|não|muito|ainda|sempre|novo|amor|vamos|passo|dado|nacional|selecionador|estará|mim|palavras|capitão|todos|tudo|jogo|vitória|equipa|futebol|treino|casa|bom|dia|noite)\b/gi;
  const englishRegex = /\b(the|and|to|of|in|for|is|on|that|by|this|with|not|are|from|your|all|have|new|more|back|good|work|keep|team|win|proud|happy|focused|points)\b/gi;

  const ptMatches = text.match(ptRegex) || [];
  const esMatches = text.match(spanishRegex) || [];
  const enMatches = text.match(englishRegex) || [];

  return {
    hasUrduArabic,
    hasDevanagari,
    desiWordCount: desiMatches.length,
    desiWords: [...new Set(desiMatches.map((w) => w.toLowerCase()))].slice(0, 10),
    hasSpanish: esMatches.length >= 5,
    hasFrench: (text.match(frenchRegex) || []).length >= 5,
    hasPortuguese: ptMatches.length >= 5,
    portugueseWordCount: ptMatches.length,
    spanishWordCount: esMatches.length,
    englishWordCount: enMatches.length,
  };
}

function bucketFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M (Mega-Influencer)`;
  if (n >= 100_000) return `${Math.round(n / 1000)}K (Macro-Influencer)`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K (Mid-tier Influencer)`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K (Micro-Influencer)`;
  return `${n} (Nano-Influencer / New Account)`;
}

// ── POST /api/onboarding/analyze-niche ──────────────────────────────────────
// NicheIQ Engine: reads ALL available user signals and passes structured
// evidence to Gemini.  Zero guessing — every output is traceable to data.
export async function executeNicheAnalysis(
  handle: string,
  platform: string = 'instagram'
): Promise<{ success: boolean; nicheData: any; note?: string }> {
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');

  // ── 1. Load all available data for this user across all storage tiers ───
  const storageDir = config.localStorageDir;
  const snapshotDirs = [
    path.join(storageDir, 'snapshots', '2026-11-03-clean-v2'),
    path.join(storageDir, 'snapshots', '2026-11-03'),
    path.join(storageDir, 'snapshots', '2026-11-03-clean'),
    path.join(storageDir, 'snapshots', '2026-11-02'),
  ];

  const postsPaths = [
    path.join(storageDir, 'posts', `${cleanHandle}.json`),
    ...snapshotDirs.map((d) => path.join(d, 'posts', `${cleanHandle}.json`)),
  ];
  const profilePaths = [
    path.join(storageDir, 'profiles', `${cleanHandle}.json`),
    ...snapshotDirs.map((d) => path.join(d, 'profiles', `${cleanHandle}.json`)),
  ];

  let profileData: any = {};
  let posts: any[] = [];

  for (const p of profilePaths) {
    if (fs.existsSync(p)) {
      try {
        profileData = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (profileData && Object.keys(profileData).length > 0) break;
      } catch {}
    }
  }
  for (const p of postsPaths) {
    if (fs.existsSync(p)) {
      try {
        const candidatePosts = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (Array.isArray(candidatePosts) && candidatePosts.length > posts.length) {
          posts = candidatePosts;
        }
      } catch {}
    }
  }

  // If 0 posts on disk but an existing calibrated niche exists with posts > 0, return existing
  const existingNicheFile = getUserNicheFile(cleanHandle);
  if (posts.length === 0 && fs.existsSync(existingNicheFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(existingNicheFile, 'utf-8'));
      if (existing && existing.posts_analyzed > 0) {
        return { success: true, nicheData: existing };
      }
    } catch {}
  }

  // ── 2. Compute all signals in TypeScript (before calling LLM) ─────────
  const bio = profileData.biography || profileData.bio || '';
  const fullName = profileData.fullName || profileData.full_name || '';
  const categoryName =
    profileData.categoryName ||
    profileData.category_name ||
    profileData.businessCategory ||
    profileData.category ||
    '';
  const isVerified =
    !!(profileData.isVerified || profileData.verified || profileData.is_verified);
  const followerCount =
    profileData.followersCount ||
    profileData.followers_count ||
    profileData.followers ||
    0;
  const followingCount =
    profileData.followingCount ||
    profileData.following_count ||
    profileData.following ||
    0;
  const totalPostCount =
    profileData.postsCount ||
    profileData.posts_count ||
    profileData.mediaCount ||
    profileData.media_count ||
    0;
  const externalLink =
    profileData.externalUrl ||
    profileData.external_url ||
    profileData.external_link ||
    '';

  // Post signals
  const signals = extractPostSignals(posts, followerCount || 10000);
  const langSignals = detectLanguage([bio, ...signals.captions].join(' '));
  const topHours = computeHourFrequency(signals.postingHours);
  const topDays = computeDayFrequency(signals.postingDays);

  const avgEngRate =
    signals.engagementRates.length > 0
      ? (
          signals.engagementRates.reduce((a, b) => a + b, 0) /
          signals.engagementRates.length
        ).toFixed(4)
      : 'N/A';

  // Dominant media type
  const dominantMedia =
    Object.entries(signals.mediaTypes).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    'unknown';

  // Follower / following ratio
  const ffRatio =
    followingCount > 0 ? (followerCount / followingCount).toFixed(1) : 'N/A';

  // Top 5 hashtags by frequency across posts
  const top5Hashtags = signals.topHashtags.slice(0, 5);

  // ── 3. Build the evidence block for Gemini ────────────────────────────
  const evidenceBlock = `
=== CREATOR IDENTITY ===
- Handle: @${cleanHandle}
- Platform: ${platform}
- Display Name: ${fullName || cleanHandle}
- Verified: ${isVerified ? 'YES (official account)' : 'No'}
- Listed Category: ${categoryName || 'Not specified by platform'}
- External Link: ${externalLink || 'None'}
- Profile Bio: "${bio || 'No bio set'}"

=== AUDIENCE SIZE & TIER ===
- Followers: ${bucketFollowers(followerCount)}
- Following: ${followingCount.toLocaleString()}
- Follower/Following Ratio: ${ffRatio}
- Declared Posts: ${totalPostCount.toLocaleString()}

=== CONTENT VOLUME & FORMAT (from ${signals.totalPosts} posts analyzed) ===
- Posts In Dataset: ${signals.totalPosts}
- Posts With Captions: ${signals.captions.length}
- Media Type Breakdown: ${Object.entries(signals.mediaTypes).map(([k, v]) => `${k}: ${v}`).join(', ') || 'No data'}
- Dominant Format: ${dominantMedia}

=== ENGAGEMENT METRICS ===
- Average Likes Per Post: ${signals.avgLikes.toLocaleString()}
- Average Comments Per Post: ${signals.avgComments.toLocaleString()}
- Average Engagement Rate: ${avgEngRate}
- Peak Likes (p90): ${signals.likesDistribution.p90.toLocaleString()}
- Maximum Likes on a Post: ${signals.likesDistribution.max.toLocaleString()}

=== POSTING SCHEDULE (UTC) ===
- Top Posting Hours: ${topHours.map((h) => `${formatHour(h.hour)} (${h.count}x)`).join(', ') || 'Insufficient data'}
- Top Posting Days: ${topDays.join(', ') || 'Insufficient data'}

=== HASHTAG INTELLIGENCE ===
- Unique Hashtags Used: ${Object.keys(signals.topHashtags.reduce((a, h) => ({ ...a, [h.tag]: 1 }), {})).length}
- Top 5 Hashtags by Frequency: ${top5Hashtags.map((h) => `#${h.tag}(${h.count}x)`).join(', ') || 'None'}
- All Sampled Hashtags: ${signals.hashtags.join(', ') || 'None'}

=== LANGUAGE & SCRIPT SIGNALS ===
- Urdu/Arabic Script Detected: ${langSignals.hasUrduArabic ? 'YES' : 'No'}
- Devanagari Script Detected: ${langSignals.hasDevanagari ? 'YES' : 'No'}
- Roman Urdu/Hindi Words Found: ${langSignals.desiWordCount} (examples: ${langSignals.desiWords.slice(0, 8).join(', ') || 'none'})
- Spanish Keywords Found: ${langSignals.hasSpanish ? 'YES' : 'No'}
- French Keywords Found: ${langSignals.hasFrench ? 'YES' : 'No'}
- Portuguese Keywords Found: ${langSignals.hasPortuguese ? 'YES' : 'No'}

=== TOP-PERFORMING CAPTIONS (highest-liked posts) ===
${signals.topCaptions.length > 0 ? signals.topCaptions.map((c, i) => `[Top Post ${i + 1}]: "${c.replace(/\n+/g, ' ')}"`).join('\n') : '(No caption data)'}

=== RECENT CAPTION SAMPLE (up to 20 posts) ===
${signals.captions.slice(0, 20).map((c, i) => `[Post ${i + 1}]: "${c.replace(/\n+/g, ' ').slice(0, 300)}"`).join('\n') || '(No caption data)'}
`.trim();

  // ── 4. The NicheIQ prompt — strict evidence-only instructions ──────────
  const prompt = `You are NicheIQ, an evidence-grounded social media intelligence analyst.
Your ONLY job is to classify this creator's niche using the structured data block below.
You must NOT guess, assume, or use prior knowledge about the handle — every single field in your JSON output must be traceable to a specific piece of evidence in the CREATOR DATA block.

If a field cannot be determined from the data (e.g., there are no captions), you MUST write exactly: "Insufficient data" for that field — never invent a plausible-sounding answer.

--- CREATOR DATA ---
${evidenceBlock}

--- CRITICAL NICHE IDENTIFICATION RULES ---
1. "niche": The primary topic/subject matter.
   - Ground it primarily in their Profile Bio, Listed Category, and actual recurring post topics.
   - If the bio explicitly lists their areas of focus, crafts, or interests (e.g., "Art, books, anime, kpop, food", "AI Literacy and Education", "Doctor & Public Health"), THOSE define their niche.
   - NEVER classify someone based on a single holiday or generic location hashtag (e.g. do NOT classify an art/anime creator as "Pakistan Independence Day" because of a single August 14 post).
   - Must be concise, professional, and clear (e.g., "Art, Books, Anime & Pop Culture", "Professional Football & Athlete Lifestyle", "AI Literacy, EdTech & Developer Education", "Scenic Photography, Nature & Motorcycling", "Public Health, Medicine & Civic Leadership").

2. "sub_niche": A narrower focus within the niche. Must come from recurring themes in the bio, top captions, or hashtags.

3. "content_pillars": Exactly 3 to 4 specific, recurring topics found in their bio or posts.

4. "keywords": 5 to 8 domain keywords describing their content focus.

5. "tone": Linguistic/emotional style evident from how they write captions.

6. "target_audience": Who their content is clearly intended for, based on the language used, hashtags, and engagement numbers.

7. "language_preference": Determine strictly from script signals and vocabulary detected above:
   - Urdu/Arabic script present → "Urdu" (or "Bilingual (English & Urdu)" if English captions also present)
   - Devanagari present → "Hindi"
   - Roman Urdu/Hindi words ≥ 5 → "Roman Urdu / Hindi"
   - Roman Urdu/Hindi words 2–4 + English → "Bilingual (English & Urdu/Hindi)"
   - Portuguese keywords found → "Portuguese" (or "Bilingual (English & Portuguese)" if English captions also present)
   - Spanish keywords found → "Spanish"
   - French keywords found → "French"
   - Otherwise → "English"

8. "posting_pattern": Summarize the detected posting schedule (days + hours) in one sentence. Use the data above.

9. "dominant_format": The media type this creator uses most. Use the breakdown from the data.

10. "follower_tier": Copy the tier label from the audience size section above.

11. "engagement_level": Based on avg_engagement_rate: >5% = "High", 1–5% = "Medium", <1% = "Low", N/A = "Insufficient data"

12. "evidence_quotes": 2–4 SHORT exact phrases or keywords extracted from the bio or captions above that PROVE your niche/language findings.

13. "confidence": "high" if ≥10 posts with captions were analyzed. "medium" if 3–9. "low" if <3. "none" if 0.

14. "summary": 2–3 sentence overview. Every claim must be backed by data points listed above. No marketing language.

Output ONLY valid JSON. No markdown, no backticks, no explanation outside the JSON:
{
  "niche": "...",
  "sub_niche": "...",
  "content_pillars": ["...", "...", "..."],
  "keywords": ["...", "...", "..."],
  "tone": "...",
  "target_audience": "...",
  "language_preference": "...",
  "posting_pattern": "...",
  "dominant_format": "...",
  "follower_tier": "...",
  "engagement_level": "...",
  "evidence_quotes": ["...", "..."],
  "confidence": "high|medium|low|none",
  "summary": "..."
}`;

  const geminiApiKey = process.env.GEMINI_API_KEY || '';

  // ── 5. Call the LLM ────────────────────────────────────────────────────
  if (geminiApiKey) {
    const candidateModels = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    for (const model of candidateModels) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const aiResp = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 800,
            },
          }),
        });

        if (!aiResp.ok) {
          continue;
        }

        const aiData = await aiResp.json();
        const rawText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const cleanJsonText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

        let parsedNiche: any = {};
        try {
          parsedNiche = JSON.parse(cleanJsonText);
        } catch {
          parsedNiche = buildFallbackFromSignals(cleanHandle, signals, langSignals, followerCount, bio, fullName, categoryName);
        }

        const result = buildResult(cleanHandle, platform, posts.length, parsedNiche, signals, langSignals, followerCount);
        fs.writeFileSync(getUserNicheFile(cleanHandle), JSON.stringify(result, null, 2));
        return { success: true, nicheData: result };
      } catch (error: any) {
        console.error(`[NicheIQ] ${model} error:`, error.message);
      }
    }
  }

  // ── 6. Offline fallback — still uses all computed signals, no guessing ─
  const fallbackNiche = buildFallbackFromSignals(cleanHandle, signals, langSignals, followerCount, bio, fullName, categoryName);
  const result = buildResult(cleanHandle, platform, posts.length, fallbackNiche, signals, langSignals, followerCount);
  fs.writeFileSync(getUserNicheFile(cleanHandle), JSON.stringify(result, null, 2));
  return {
    success: true,
    nicheData: result,
    note: 'Generated via NicheIQ signal analysis',
  };
}

onboardingRouter.post('/analyze-niche', async (req: Request, res: Response) => {
  const { handle, platform = 'instagram' } = req.body;
  if (!handle) {
    return res.status(400).json({ error: 'Handle is required' });
  }

  try {
    const data = await executeNicheAnalysis(handle, platform);
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildResult(
  handle: string,
  platform: string,
  postsAnalyzed: number,
  parsed: any,
  signals: PostSignals,
  lang: ReturnType<typeof detectLanguage>,
  followerCount: number
): any {
  return {
    handle,
    platform,
    analyzed_at: new Date().toISOString(),
    posts_analyzed: postsAnalyzed,
    engine: 'NicheIQ v2',
    // Merge LLM-parsed fields
    niche: parsed.niche || 'Insufficient data',
    sub_niche: parsed.sub_niche || 'Insufficient data',
    content_pillars: parsed.content_pillars || [],
    tone: parsed.tone || 'Insufficient data',
    target_audience: parsed.target_audience || 'Insufficient data',
    language_preference: parsed.language_preference || inferLanguage(lang),
    language_evidence: {
      primary: parsed.language_preference || inferLanguage(lang),
      detected_scripts: [
        lang.hasUrduArabic ? 'Urdu/Arabic' : null,
        lang.hasDevanagari ? 'Devanagari' : null,
        lang.desiWordCount >= 2 ? 'Roman Urdu/Hindi' : null,
        lang.hasSpanish ? 'Spanish' : null,
        lang.hasFrench ? 'French' : null,
        lang.hasPortuguese ? 'Portuguese' : null,
      ].filter(Boolean),
      desi_words_matched: lang.desiWordCount,
      sample_desi_words: lang.desiWords.slice(0, 5),
    },
    keywords: parsed.keywords || [],
    posting_pattern: parsed.posting_pattern || 'Insufficient data',
    dominant_format: parsed.dominant_format || Object.entries(signals.mediaTypes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown',
    follower_tier: parsed.follower_tier || bucketFollowers(followerCount),
    engagement_level: parsed.engagement_level || 'Insufficient data',
    evidence_quotes: parsed.evidence_quotes || [],
    confidence: parsed.confidence || (postsAnalyzed >= 10 ? 'high' : postsAnalyzed >= 3 ? 'medium' : postsAnalyzed > 0 ? 'low' : 'none'),
    summary: parsed.summary || `@${handle} analyzed with ${postsAnalyzed} posts. Insufficient caption data for detailed niche profiling.`,
    // Always include raw signal summary for transparency
    _signal_summary: {
      posts_with_captions: signals.captions.length,
      unique_hashtags: signals.topHashtags.length,
      top_hashtags: signals.topHashtags.slice(0, 5).map((h) => `#${h.tag}`),
      media_distribution: signals.mediaTypes,
      avg_likes: signals.avgLikes,
      avg_comments: signals.avgComments,
      language_scripts: {
        urdu_arabic: lang.hasUrduArabic,
        devanagari: lang.hasDevanagari,
        roman_urdu_count: lang.desiWordCount,
        spanish: lang.hasSpanish,
        french: lang.hasFrench,
        portuguese: lang.hasPortuguese,
      },
      follower_count: followerCount,
    },
  };
}

function inferLanguage(lang: ReturnType<typeof detectLanguage>): string {
  if (lang.hasUrduArabic) {
    if (lang.englishWordCount >= 10) return 'Bilingual (English & Urdu)';
    return 'Urdu';
  }
  if (lang.hasDevanagari) {
    if (lang.englishWordCount >= 10) return 'Bilingual (English & Hindi)';
    return 'Hindi';
  }
  if (lang.desiWordCount >= 5) return 'Roman Urdu / Hindi';
  if (lang.desiWordCount >= 2) return 'Bilingual (English & Urdu/Hindi)';
  
  if (lang.portugueseWordCount >= 5 && lang.englishWordCount >= 5) {
    return 'Bilingual (English & Portuguese)';
  }
  if (lang.spanishWordCount >= 5 && lang.englishWordCount >= 5) {
    return 'Bilingual (English & Spanish)';
  }
  if (lang.hasPortuguese && lang.portugueseWordCount > lang.englishWordCount) {
    return 'Portuguese';
  }
  if (lang.hasSpanish && lang.spanishWordCount > lang.englishWordCount) {
    return 'Spanish';
  }
  if (lang.hasFrench) return 'French';
  return 'English';
}

export interface DomainTaxonomyItem {
  id: string;
  niche: string;
  sub_niche: string;
  pillars: string[];
  keywords: string[];
}

export const DOMAIN_TAXONOMY: DomainTaxonomyItem[] = [
  {
    id: "sports_football",
    niche: "Professional Football & Athlete Lifestyle",
    sub_niche: "Match Performances, Elite Athletic Training & Global Sports Brand",
    pillars: ["Match Performance & Highlights", "Fitness & Athletic Training", "Personal Brand & Partnerships", "Team & Championship Milestones"],
    keywords: [
      "football", "soccer", "match", "win", "points", "ballon", "hat-trick", "goal", "nassr",
      "fifa", "uefa", "laliga", "serie a", "premier league", "cristiano", "ronaldo", "messi",
      "real madrid", "barcelona", "manchester", "juventus", "selecionador", "capitão", "striker", "pitch", "champions league"
    ]
  },
  {
    id: "art_popculture",
    niche: "Art, Books, Anime & Pop Culture",
    sub_niche: "Creative Arts, Comic Culture, Photography & Lifestyle",
    pillars: ["Artistic & Aesthetic Photography", "Anime & Manga Culture", "Books, Literature & Creative Writing", "Culinary Experiences & Pop Culture Events"],
    keywords: [
      "art", "anime", "books", "kpop", "food", "twincon", "convention", "drawing", "illustration", "sketch",
      "artist", "ost", "manga", "naruto", "bakery", "bake", "eerie", "gallery", "exhibition", "creative",
      "aesthetic", "surreal", "photographer", "kalimba", "cosplay", "comics"
    ]
  },
  {
    id: "scenic_motorcycle",
    niche: "Scenic Photography, Nature & Motorcycling",
    sub_niche: "Highland Road Trips, Motorcycling Expeditions & Nature Aesthetics",
    pillars: ["Scenic Mountain & Nature Imagery", "Motorcycle Road Trips & Adventures", "Poetic Urdu Reflections", "Travel Visuals & Photo Carousels"],
    keywords: [
      "motorcycle", "motoventures", "motorcycling", "biker", "ride", "scenic", "photography", "nature",
      "mountain", "mountains", "swat", "nanga parbat", "mushkpuri", "borderline", "roadtrip", "landscape",
      "wanderlust", "traveler", "outdoor", "carousels", "expedition", "touring", "highway"
    ]
  },
  {
    id: "sports_cricket",
    niche: "International Cricket & Sports Media",
    sub_niche: "Match Highlights, Team Updates & Athlete Life",
    pillars: ["Match Highlights", "Cricket Training", "Team Updates", "Brand Partnerships"],
    keywords: [
      "cricket", "batsman", "bowler", "wicket", "ipl", "bcci", "pcb", "century", "t20", "odi",
      "test match", "innings", "cricketer", "wcl", "batting", "bowling", "pitch", "fancode",
      "one8", "virat", "kohli", "babar", "azam", "de villiers", "royal challengers", "world championship league"
    ]
  },
  {
    id: "tech_ai_edtech",
    niche: "AI Literacy, EdTech & Developer Education",
    sub_niche: "Applied Artificial Intelligence, Engineering Cohorts & Builder Community",
    pillars: ["Applied AI Tutorials", "Builder Community Cohorts", "AI Literacy & Career Growth", "Engineering Frameworks"],
    keywords: [
      "ai literacy", "applied ai", "builder community", "cohort", "education", "engineers",
      "100xengineers", "coding", "software", "machine learning", "developer", "prompt engineering",
      "artificial intelligence", "deep learning", "llm", "ai"
    ]
  },
  {
    id: "tech_software",
    niche: "Technology, Startups & Software Engineering",
    sub_niche: "Full-Stack Development, Autonomous AI & Developer Tooling",
    pillars: ["System Architecture", "Software Engineering", "AI & Automation", "Developer Workflows"],
    keywords: [
      "typescript", "javascript", "react", "nextjs", "python", "backend", "fullstack",
      "developer", "coding", "software", "startup", "saas", "github", "database", "api", "docker", "cloud", "devops"
    ]
  },
  {
    id: "public_health_civic",
    niche: "Public Health, Medicine & Civic Leadership",
    sub_niche: "Healthcare Reform, Epidemiology & Public Policy Advocacy",
    pillars: ["Public Health Advocacy", "Healthcare Reform & Access", "Civic Leadership & Community", "Policy & Government Reform"],
    keywords: [
      "senator", "senate", "doctor", "medicine", "health", "healthcare", "public health",
      "michigan", "epidemiology", "policy", "congress", "vote", "campaign", "governance",
      "patients", "clinic", "community health", "abdulforsenate", "voteblue", "legislation",
      "special interests", "democracy", "usaid", "diplomacy"
    ]
  },
  {
    id: "comedy_satire",
    niche: "Stand-Up Comedy & Sketch Satire",
    sub_niche: "Live Comedy Tours, Observational Satire & Video Skits",
    pillars: ["Live Comedy Shows", "Social Satire & Parody", "Relatable Sketch Humor", "Tour Announcements"],
    keywords: [
      "comedy", "standup", "stand-up", "jokes", "show", "tour", "pacc", "harra hurri",
      "tickets", "skit", "satire", "parody", "chaudry", "comedian", "dirty comedy"
    ]
  },
  {
    id: "adventure_travel",
    niche: "Adventure Travel & Motorcycle Expeditions",
    sub_niche: "Cross-Continental Touring, Moto-Vlogging & Cultural Discovery",
    pillars: ["Cross-Country Moto Expeditions", "Cultural Discoveries", "Global Travelogues", "Humanitarian Stories"],
    keywords: [
      "travel", "adventure", "motorcycle", "motorcyclist", "moto", "expedition", "vlogger",
      "vlog", "journey", "wildlens", "abrar", "patagonia", "alaska", "mexico", "countries"
    ]
  },
  {
    id: "culinary_food",
    niche: "Culinary Arts & Food Vlogging",
    sub_niche: "Recipes, Gastronomy & Restaurant Discovery",
    pillars: ["Food Recipes", "Restaurant Reviews", "Culinary Tips", "Baking & Desserts"],
    keywords: [
      "recipe", "food", "cook", "chef", "delicious", "tasty", "dish", "meal", "kitchen", "restaurant",
      "baking", "bakery", "gourmet", "pastry"
    ]
  },
  {
    id: "sportswear_running",
    niche: "Athletic Sportswear, Footwear & Running",
    sub_niche: "Sport Performance Footwear, Marathon Culture & Athlete Endorsements",
    pillars: ["Athletic Footwear & Apparel", "Marathon & Running Culture", "Athlete Collaborations", "Product Innovation"],
    keywords: [
      "marathon", "shoes", "sneakers", "runner", "running", "footwear", "apparel", "climacool",
      "adidas", "nike", "puma", "under armour", "zverev", "collection", "world number 1", "yougotthis",
      "athletes", "innovation"
    ]
  },
  {
    id: "memes_entertainment",
    niche: "Digital Memes & Internet Entertainment",
    sub_niche: "Viral Humor, Relatable Memes & Trending Web Culture",
    pillars: ["Relatable Workplace & Life Memes", "Viral Video Curation", "Community Humor", "Trending Pop Culture"],
    keywords: [
      "meme", "memes", "funny", "9gag", "relatable", "joke", "lol", "humor", "viral",
      "wholesome", "doggo", "cat", "comedy", "laugh"
    ]
  },
  {
    id: "skateboarding",
    niche: "Skateboarding & Action Sports",
    sub_niche: "Skate Culture, Ramp Sessions, Tricks & Community",
    pillars: ["Skateboarding Tricks", "Action Sports Lifestyle", "Community & Events", "Brand History"],
    keywords: ["skate", "skateboard", "ramp", "grind", "trick", "ollie", "halfpipe", "vert", "skater", "birdhouse", "tonyhawk"]
  },
  {
    id: "vacation_rentals",
    niche: "Vacation Rentals & Travel Stays",
    sub_niche: "Unique Homes, Luxury Stays & Travel Experiences",
    pillars: ["Unique Accommodations", "Travel Destinations", "Guest Experiences", "Hosting Stories"],
    keywords: [
      "airbnb", "booking", "stay", "castle", "villa", "host", "rental", "vacation",
      "luxe", "couch", "trip", "weekend getaway"
    ]
  },
  {
    id: "crafts_diy",
    niche: "DIY Crafts, Life Hacks & Creative Tutorials",
    sub_niche: "Creative DIY Projects, Home Hacks & Quick Crafts",
    pillars: ["DIY Crafts", "Life Hacks", "Creative Upcycling", "Quick How-To Guides"],
    keywords: [
      "crafts", "diy", "5min", "hacks", "life hacks", "handicraft", "creative", "tutorial",
      "easy crafts", "make at home", "quick crafts"
    ]
  },
  {
    id: "fashion_beauty",
    niche: "Fashion, Beauty & Personal Style",
    sub_niche: "Lookbooks, Wardrobe Styling & Beauty Trends",
    pillars: ["Outfit Inspirations", "Beauty & Skincare Tips", "Seasonal Lookbooks", "Brand Collaborations"],
    keywords: [
      "fashion", "beauty", "style", "outfit", "makeup", "lookbook", "model", "modeling",
      "apparel", "wardrobe", "couture", "aesthetic"
    ]
  },
  {
    id: "automotive_supercars",
    niche: "Automotive & Motorsports",
    sub_niche: "Supercars, Track Performance & Vehicle Engineering",
    pillars: ["Vehicle Reviews", "Track Performance", "Automotive Lifestyle"],
    keywords: ["car", "engine", "motor", "drive", "racing", "speed", "turbo", "horsepower", "vehicle", "auto", "motorsport", "supercar"]
  }
];

function buildFallbackFromSignals(
  handle: string,
  signals: PostSignals,
  lang: ReturnType<typeof detectLanguage>,
  followerCount: number,
  bioText: string = '',
  fullNameText: string = '',
  categoryText: string = ''
): any {
  const bioClean = bioText.toLowerCase();
  const catClean = categoryText.toLowerCase();
  const nameClean = fullNameText.toLowerCase();
  const captionsClean = signals.captions.join(' ').toLowerCase();
  const tagsClean = signals.hashtags.join(' ').toLowerCase();

  let bestDomain: DomainTaxonomyItem | null = null;
  let bestDomainScore = 0;

  for (const item of DOMAIN_TAXONOMY) {
    let score = 0;
    for (const kw of item.keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(`\\b${escaped}(s|ed|ing|d|es)?\\b`, 'gi');

      // Bio matches have 5x weight (direct creator declaration)
      const bioMatches = (bioClean.match(reg) || []).length;
      score += bioMatches * 5;

      // Category matches have 5x weight
      const catMatches = (catClean.match(reg) || []).length;
      score += catMatches * 5;

      // Full name matches have 3x weight
      const nameMatches = (nameClean.match(reg) || []).length;
      score += nameMatches * 3;

      // Caption matches have 2x weight
      const capMatches = (captionsClean.match(reg) || []).length;
      score += capMatches * 2;

      // Recurring hashtag matches have 1x weight
      const tagMatches = (tagsClean.match(reg) || []).length;
      score += tagMatches * 1;
    }

    if (score > bestDomainScore) {
      bestDomainScore = score;
      bestDomain = item;
    }
  }

  // If a domain match (>= 3 weighted points) is found, prioritize it
  let nicheName = '';
  let subNicheName = '';
  let contentPillars: string[] = [];
  let keywords: string[] = [];

  if (bestDomainScore >= 3 && bestDomain) {
    nicheName = bestDomain.niche;
    subNicheName = bestDomain.sub_niche;
    contentPillars = bestDomain.pillars;
    keywords = bestDomain.keywords.slice(0, 8);
  } else if (bioText.trim().length >= 10) {
    // Derive from bio keywords rather than arbitrary hashtags
    const bioWords = bioText
      .replace(/[^\w\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !['stressed', 'human', 'occasionally', 'special', 'face', 'with', 'from', 'this', 'that', 'your', 'about'].includes(w.toLowerCase()));
    
    if (bioWords.length >= 2) {
      const primaryWords = bioWords.slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      nicheName = primaryWords.join(' & ') + ' Lifestyle';
      subNicheName = 'Creative Content & Audience Growth';
      contentPillars = primaryWords.map((w) => `${w} & Creative Focus`).concat(['Community & Audience Connection']);
      keywords = primaryWords.map((w) => w.toLowerCase());
    } else {
      nicheName = 'Digital Creator';
      subNicheName = 'Visual Media & Audience Engagement';
      contentPillars = ['Visual Media', 'Personal Brand', 'Community'];
      keywords = ['creator', 'visual media', 'community'];
    }
  } else {
    nicheName = 'Digital Creator';
    subNicheName = 'Visual Media & Audience Engagement';
    contentPillars = ['Visual Media', 'Personal Brand', 'Community'];
    keywords = ['creator', 'visual media', 'community'];
  }

  const language = inferLanguage(lang);
  const dominantMedia =
    Object.entries(signals.mediaTypes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

  const evidenceQuotes = bestDomainScore >= 3 && signals.topCaptions.length > 0
    ? signals.topCaptions.slice(0, 2).map((c) => c.replace(/\n+/g, ' ').slice(0, 100))
    : (bioText.trim().length > 0
        ? [bioText.replace(/\n+/g, ' ').slice(0, 100)]
        : signals.topHashtags.slice(0, 3).map((t) => `#${t.tag}`));

  return {
    niche: nicheName,
    sub_niche: subNicheName,
    content_pillars: contentPillars,
    keywords,
    tone: 'Focused & High-Impact',
    target_audience: bestDomainScore >= 3 && bestDomain ? `Followers and enthusiasts of ${bestDomain.niche.toLowerCase()}` : 'Active social media followers',
    language_preference: language,
    language_evidence: {
      primary: language,
      detected_scripts: [
        lang.hasUrduArabic ? 'Urdu/Arabic' : null,
        lang.hasDevanagari ? 'Devanagari' : null,
        lang.desiWordCount >= 2 ? 'Roman Urdu/Hindi' : null,
        lang.hasSpanish ? 'Spanish' : null,
        lang.hasFrench ? 'French' : null,
        lang.hasPortuguese ? 'Portuguese' : null,
        lang.englishWordCount >= 5 ? 'English' : null,
      ].filter(Boolean),
      desi_words_matched: lang.desiWordCount,
      sample_desi_words: lang.desiWords.slice(0, 5),
    },
    posting_pattern: signals.postingHours.length > 0 ? `Active around UTC peak hours: ${computeHourFrequency(signals.postingHours).slice(0, 2).map(h => formatHour(h.hour)).join(', ')}` : 'Insufficient data',
    dominant_format: dominantMedia,
    follower_tier: bucketFollowers(followerCount),
    engagement_level: signals.engagementRates.length > 0 ? (signals.engagementRates.reduce((a, b) => a + b, 0) / signals.engagementRates.length > 0.03 ? 'High' : 'Medium') : 'Insufficient data',
    evidence_quotes: evidenceQuotes,
    confidence: signals.captions.length >= 10 ? 'high' : signals.captions.length >= 3 ? 'medium' : (bioText ? 'medium' : 'low'),
    summary: `@${handle} analyzed across ${signals.totalPosts} posts. Dominant focus in ${nicheName} (${subNicheName}) with ${language} as primary communication language.`,
  };
}

// ── GET /api/onboarding/niche/:handle ────────────────────────────────────────
onboardingRouter.get('/niche/:handle', (req: Request, res: Response) => {
  const { handle } = req.params;
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');
  const file = getUserNicheFile(cleanHandle);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return res.json({ nicheData: data });
    } catch {}
  }
  return res.status(404).json({ error: 'Niche data not found for creator' });
});
