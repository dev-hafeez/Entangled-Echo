/**
 * Post Performance Diagnostics & Actionable Recommendations (FR-16)
 * Calculates percentile-calibrated performance scores, explains exact scoring factors,
 * and provides concrete improvement advice tailored to each individual post.
 */

export interface PostDiagnostic {
  score: number;
  tier: 'Top Performing' | 'Above Average' | 'Average' | 'Needs Improvement';
  why: string;
  improvements: string[];
}

interface RawPostMetrics {
  id?: string;
  shortcode?: string;
  likes_count?: number | null;
  likesCount?: number | null;
  comments_count?: number | null;
  commentsCount?: number | null;
  views_count?: number | null;
  viewsCount?: number | null;
  media_type?: string | null;
  mediaType?: string | null;
  caption?: string | null;
  hashtags?: string[] | null;
  posted_at?: string | null;
  postedAt?: string | null;
}

export function computePostDiagnostics(
  posts: RawPostMetrics[],
  followersCount: number = 1000
): Map<string, PostDiagnostic> {
  const diagnosticsMap = new Map<string, PostDiagnostic>();
  if (!posts || posts.length === 0) return diagnosticsMap;

  const validFollowers = Math.max(followersCount, 50);

  // 1. Calculate raw engagement & engagement rate for each post
  const evaluatedPosts = posts.map((p, originalIndex) => {
    const likes = p.likes_count ?? p.likesCount ?? 0;
    const comments = p.comments_count ?? p.commentsCount ?? 0;
    const views = p.views_count ?? p.viewsCount ?? 0;
    const effectiveReach = views > 0 ? views : validFollowers;

    // FR-16 weights: likes*1 + comments*3
    const rawEngagement = likes * 1.0 + comments * 3.0;
    const erRate = rawEngagement / effectiveReach;

    const key = p.id || p.shortcode || `post-${originalIndex}`;
    return {
      key,
      likes,
      comments,
      views,
      rawEngagement,
      erRate,
      mediaType: (p.media_type || p.mediaType || 'image').toLowerCase(),
      caption: p.caption || '',
      hashtags: p.hashtags || [],
      postedAt: p.posted_at || p.postedAt || null,
      originalIndex,
    };
  });

  const count = evaluatedPosts.length;
  const avgLikes = Math.round(evaluatedPosts.reduce((acc, p) => acc + p.likes, 0) / count);
  const avgComments = Math.round(evaluatedPosts.reduce((acc, p) => acc + p.comments, 0) / count);
  const avgER = evaluatedPosts.reduce((acc, p) => acc + p.erRate, 0) / count;

  // Sort by raw engagement ascending to assign percentile ranks
  const sorted = [...evaluatedPosts].sort((a, b) => a.rawEngagement - b.rawEngagement);
  const rankMap = new Map<string, number>();
  sorted.forEach((p, rank) => {
    rankMap.set(p.key, rank);
  });

  evaluatedPosts.forEach((post) => {
    const rank = rankMap.get(post.key) ?? 0;
    const percentile = count > 1 ? rank / (count - 1) : 0.5;

    // Ratio vs account average engagement
    const ratioVsAvg = avgER > 0 ? post.erRate / avgER : 1.0;

    // Score calibration (25 - 99 scale)
    let score = Math.round(30 + percentile * 45 + Math.min(ratioVsAvg, 2.5) * 10);
    score = Math.max(25, Math.min(98, score));

    // Determine performance tier
    let tier: PostDiagnostic['tier'] = 'Average';
    if (score >= 85) {
      tier = 'Top Performing';
    } else if (score >= 70) {
      tier = 'Above Average';
    } else if (score < 50) {
      tier = 'Needs Improvement';
    }

    // Generate specific "Why this score" explanation
    const likesDiffPercent =
      avgLikes > 0 ? Math.round(((post.likes - avgLikes) / avgLikes) * 100) : 0;
    const commentRatio = post.likes > 0 ? post.comments / post.likes : 0;

    let likesAnalysis = '';
    if (likesDiffPercent >= 15) {
      likesAnalysis = `Generated +${likesDiffPercent}% more likes than your account average (${avgLikes.toLocaleString()}).`;
    } else if (likesDiffPercent <= -15) {
      likesAnalysis = `Received ${Math.abs(likesDiffPercent)}% fewer likes than your account average (${avgLikes.toLocaleString()}).`;
    } else {
      likesAnalysis = `Achieved consistent like volume on par with your account benchmark (${avgLikes.toLocaleString()}).`;
    }

    let commentAnalysis = '';
    if (commentRatio >= 0.15) {
      commentAnalysis = ` High comment ratio (${(commentRatio * 100).toFixed(1)}%) shows deep audience discussion.`;
    } else if (commentRatio >= 0.05) {
      commentAnalysis = ` Balanced discussion response from followers.`;
    } else {
      commentAnalysis = ` Low comment conversation depth; audience engaged mostly passively.`;
    }

    let formatAnalysis = '';
    if (post.mediaType.includes('carousel')) {
      formatAnalysis = ` Carousel slides increased viewer dwell time.`;
    } else if (post.mediaType.includes('video') || post.mediaType.includes('reel')) {
      formatAnalysis = ` Video format helped drive dynamic viewing retention.`;
    } else {
      formatAnalysis = ` Static photo format had quicker viewing cycles.`;
    }

    const why = `${likesAnalysis}${commentAnalysis}${formatAnalysis}`;

    // Generate concrete "Improvements needed"
    const improvements: string[] = [];

    // 1. Hashtags
    if (!post.hashtags || post.hashtags.length === 0) {
      improvements.push('Discovery: Add 3–5 targeted niche hashtags to increase non-follower reach in search and explore feeds.');
    } else if (post.hashtags.length > 15) {
      improvements.push('Tag Hygiene: Reduce hashtags to 5–8 focused tags to avoid looking spammy to platform algorithms.');
    }

    // 2. Call-to-Action / Comments
    if (commentRatio < 0.08) {
      improvements.push('Conversation Hook: Conclude your caption with a direct, opinion-based question to prompt follower replies.');
    }

    // 3. Caption context & storytelling
    const captionTrimmed = post.caption.trim();
    if (!captionTrimmed || captionTrimmed.length < 25) {
      improvements.push('Storytelling: Add 2–3 sentences of narrative context; posts with descriptive captions see +25% higher bookmark rates.');
    } else if (captionTrimmed.length > 400 && !captionTrimmed.includes('\n')) {
      improvements.push('Readability: Break dense text into shorter 2-line paragraphs with spacing for easier mobile scanning.');
    }

    // 4. Format upgrade
    if (post.mediaType === 'image') {
      improvements.push('Format Upgrade: Convert single-photo posts into multi-slide carousels or short reels to boost save rate.');
    }

    // 5. Timing recommendation
    if (post.postedAt) {
      const d = new Date(post.postedAt);
      const hour = d.getUTCHours();
      if (hour >= 0 && hour <= 8) {
        improvements.push('Schedule: Posted during late off-peak hours. Schedule between 17:00–21:00 for highest first-hour velocity.');
      }
    }

    // 6. High-performer recommendation
    if (score >= 85) {
      improvements.push('Content Repurposing: High-resonance post! Pin this post to your profile or adapt key takeaways into a video reel.');
    }

    // Ensure at least 2 actionable tips
    if (improvements.length < 2) {
      improvements.push('Engagement: Respond to comments within the first 60 minutes to trigger algorithm boost and higher feed ranking.');
    }

    diagnosticsMap.set(post.key, {
      score,
      tier,
      why,
      improvements: improvements.slice(0, 3), // Top 2-3 most impactful
    });
  });

  return diagnosticsMap;
}
