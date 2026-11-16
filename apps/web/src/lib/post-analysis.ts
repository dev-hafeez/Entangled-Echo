export interface PostAnalysisResult {
  score: number;
  ratingLabel: 'Top Performer' | 'Above Average' | 'Average' | 'Needs Improvement';
  rawScore: number;
  whyDescription: string;
  whatNeedsToBeChanged: string[];
}

export function computePostAnalysis(
  post: any,
  allPosts: any[] = [],
  nicheData?: any
): PostAnalysisResult {
  const getLikes = (p: any): number => {
    const val = p?.likes_count ?? p?.likesCount ?? (typeof p?.likes === 'number' ? p.likes : 0);
    return typeof val === 'number' && !isNaN(val) ? val : 0;
  };

  const getComments = (p: any): number => {
    const val = p?.comments_count ?? p?.commentsCount ?? (typeof p?.comments === 'number' ? p.comments : 0);
    return typeof val === 'number' && !isNaN(val) ? val : 0;
  };

  const getViews = (p: any): number => {
    const val = p?.views_count ?? p?.viewsCount ?? (p?.viewsRawStr ? parseInt(String(p.viewsRawStr).replace(/[^0-9]/g, ''), 10) : 0);
    return typeof val === 'number' && !isNaN(val) ? val : 0;
  };

  const likes = getLikes(post);
  const comments = getComments(post);
  const views = getViews(post);
  const mediaType = (post?.media_type || post?.mediaType || '').toLowerCase();
  const caption = (post?.caption || '').trim();

  // Weighted engagement formula
  const rawScore = likes * 1.0 + comments * 3.5 + (views > 0 ? views * 0.05 : 0);

  const total = allPosts && allPosts.length > 0 ? allPosts.length : 1;
  const avgLikes = total > 0 ? allPosts.reduce((acc, p) => acc + getLikes(p), 0) / total : 0;
  const avgComments = total > 0 ? allPosts.reduce((acc, p) => acc + getComments(p), 0) / total : 0;

  let score: number;
  if (allPosts.length > 1) {
    const allScores = allPosts.map((p) => {
      const l = getLikes(p);
      const c = getComments(p);
      const v = getViews(p);
      return l * 1.0 + c * 3.5 + (v > 0 ? v * 0.05 : 0);
    });

    let lessCount = 0;
    let equalCount = 0;
    for (const s of allScores) {
      if (s < rawScore) lessCount++;
      else if (s === rawScore) equalCount++;
    }
    const percentile = (lessCount + equalCount * 0.5) / total;
    score = Math.round(20 + percentile * 78);
  } else {
    // Single post fallback based on absolute engagement
    if (likes >= 500) {
      score = Math.min(96, 80 + Math.round((likes / 1000) * 15));
    } else if (likes >= 100) {
      score = Math.min(79, 65 + Math.round((likes / 200) * 10));
    } else if (likes >= 20) {
      score = Math.min(64, 45 + Math.round((likes / 50) * 10));
    } else {
      score = Math.max(22, 25 + likes * 2 + comments * 4);
    }
  }

  // Performance Rating Tier
  let ratingLabel: PostAnalysisResult['ratingLabel'] = 'Average';
  if (score >= 82) ratingLabel = 'Top Performer';
  else if (score >= 65) ratingLabel = 'Above Average';
  else if (score < 42) ratingLabel = 'Needs Improvement';

  // Why it scored like this
  const likeDiff = Math.round(((likes - avgLikes) / Math.max(avgLikes, 1)) * 100);
  const commentDiff = Math.round(((comments - avgComments) / Math.max(avgComments, 1)) * 100);
  const commentRatio = likes > 0 ? (comments / likes) * 100 : 0;
  const isShortCaption = caption.length < 50;

  const whyParts: string[] = [];
  if (likes >= avgLikes * 1.4 && total > 1) {
    whyParts.push(`Strong organic reach with ${likes.toLocaleString()} likes (+${likeDiff}% vs. your account average).`);
  } else if (likes <= avgLikes * 0.6 && total > 1) {
    whyParts.push(`Below-average reach with ${likes.toLocaleString()} likes (${likeDiff}% vs. your account average).`);
  } else {
    whyParts.push(`Steady baseline reach with ${likes.toLocaleString()} likes${total > 1 ? ' (near account average)' : ''}.`);
  }

  if (comments === 0) {
    whyParts.push('Zero comments recorded, signaling passive views without audience dialogue.');
  } else if (comments >= avgComments * 1.5 && comments > 1 && total > 1) {
    whyParts.push(`Exceptional discussion depth with ${comments} comments (+${commentDiff}% above your conversation benchmark).`);
  } else if (commentRatio < 0.6 && likes > 40) {
    whyParts.push(`Low comment-to-like ratio (${commentRatio.toFixed(1)}%) indicates scrollers enjoyed the post but were not compelled to leave a reply.`);
  } else if (comments > 0) {
    whyParts.push(`Solid audience response with ${comments} comments (${commentRatio.toFixed(1)}% response rate).`);
  }

  if (mediaType === 'video' || mediaType === 'reel') {
    whyParts.push('Video format supported retention.');
  } else if (mediaType === 'carousel' || (post?.carousel_size && post.carousel_size > 1)) {
    whyParts.push('Multi-slide carousel provided multiple swipe interaction points.');
  } else if (isShortCaption) {
    whyParts.push('Brief caption limited search indexing and topic context.');
  }

  const whyDescription = whyParts.join(' ');

  // What needs to be changed
  const changes: string[] = [];
  if (comments === 0 || commentRatio < 0.8) {
    changes.push('Place an explicit, open-ended question or discussion prompt in the first two lines of your caption to spur follower comments.');
  }

  if (isShortCaption) {
    changes.push('Expand the caption into 2–3 structured sentences outlining key lessons or behind-the-scenes context to increase time-on-post.');
  }

  const tags = post?.hashtags || [];
  if (!tags || tags.length < 3) {
    const suggestedTags = (nicheData?.keywords || ['growth', 'content', 'tips'])
      .slice(0, 3)
      .map((k: string) => '#' + k.replace(/\s+/g, ''))
      .join(' ');
    changes.push(`Incorporate 3–5 targeted niche hashtags (${suggestedTags}) to appear in explore feeds.`);
  }

  if (mediaType === 'photo' && score < 65) {
    changes.push('Test presenting this information as a multi-slide carousel or short-form reel to boost reach and dwell time.');
  }

  if (mediaType === 'video' || mediaType === 'reel') {
    if (comments === 0 || score < 60) {
      changes.push('Lead with a bold on-screen text hook in the first 3 seconds to prevent drop-off and pin a conversation starter comment.');
    }
  }

  if (changes.length === 0) {
    if (score >= 82) {
      changes.push('Repurpose this high-resonance topic into a multi-part deep dive or a follow-up Q&A post to compound momentum.');
    } else {
      changes.push('Experiment with pinned starter comments and stronger contrast in the opening visual hook.');
    }
  }

  return {
    score,
    ratingLabel,
    rawScore,
    whyDescription,
    whatNeedsToBeChanged: changes.slice(0, 2),
  };
}
