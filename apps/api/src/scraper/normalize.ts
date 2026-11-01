export interface NormalizedInput {
  type: 'profile' | 'post';
  rawInput: string;
  handle: string | null;
  shortcode: string | null;
  postUrl: string | null;
}

/**
 * Normalizes input string (handle, profile URL, or post URL)
 */
export function normalizeTarget(input: string): NormalizedInput {
  const trimmed = input.trim();

  // Check for post URL
  // e.g. https://www.instagram.com/p/C-xyz/ or https://instagram.com/reel/C-xyz/
  const postMatch = trimmed.match(
    /(?:https?:\/\/(?:www\.)?instagram\.com)?\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/
  );
  if (postMatch) {
    return {
      type: 'post',
      rawInput: trimmed,
      handle: null, // will be resolved dynamically
      shortcode: postMatch[1],
      postUrl: `https://www.instagram.com/p/${postMatch[1]}/`,
    };
  }

  // Check for profile URL
  // e.g. https://www.instagram.com/natgeo/?hl=en
  const profileUrlMatch = trimmed.match(
    /(?:https?:\/\/(?:www\.)?instagram\.com\/)?([a-zA-Z0-9._]+)/
  );

  if (profileUrlMatch) {
    let handle = profileUrlMatch[1].toLowerCase().replace(/^@/, '').replace(/\/$/, '');
    // Exclude reserved paths
    const reserved = ['explore', 'reels', 'stories', 'direct', 'accounts', 'developer', 'about'];
    if (!reserved.includes(handle) && /^[a-zA-Z0-9._]{1,30}$/.test(handle)) {
      return {
        type: 'profile',
        rawInput: trimmed,
        handle,
        shortcode: null,
        postUrl: null,
      };
    }
  }

  // Handle plain username with optional leading @
  const cleanHandle = trimmed.replace(/^@/, '').replace(/\/$/, '').toLowerCase();
  if (/^[a-zA-Z0-9._]{1,30}$/.test(cleanHandle)) {
    return {
      type: 'profile',
      rawInput: trimmed,
      handle: cleanHandle,
      shortcode: null,
      postUrl: null,
    };
  }

  return {
    type: 'profile',
    rawInput: trimmed,
    handle: null,
    shortcode: null,
    postUrl: null,
  };
}
