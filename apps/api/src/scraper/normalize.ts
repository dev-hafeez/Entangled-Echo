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

  // Try parsing as URL first if it starts with http://, https://, or instagram.com
  let urlObj: URL | null = null;
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      urlObj = new URL(trimmed);
    } else if (trimmed.startsWith('instagram.com') || trimmed.startsWith('www.instagram.com')) {
      urlObj = new URL(`https://${trimmed}`);
    }
  } catch {}

  if (urlObj) {
    const pathname = urlObj.pathname.replace(/\/+$/, '');
    
    // Check for post: /p/:code or /reel/:code or /tv/:code
    const postMatch = pathname.match(/^\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/i);
    if (postMatch) {
      return {
        type: 'post',
        rawInput: trimmed,
        handle: null,
        shortcode: postMatch[1],
        postUrl: `https://www.instagram.com/p/${postMatch[1]}/`,
      };
    }

    // Profile URL: /:handle or /:handle/p/:code
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length >= 1) {
      const candidate = segments[0].toLowerCase().replace(/^@/, '');
      const reserved = [
        'explore',
        'reels',
        'stories',
        'direct',
        'accounts',
        'developer',
        'about',
        'legal',
        'privacy',
      ];
      if (!reserved.includes(candidate) && /^[a-zA-Z0-9._]{1,30}$/.test(candidate)) {
        // If it was /:handle/p/:code, check if second segment is p or reel
        if (segments.length >= 3 && (segments[1] === 'p' || segments[1] === 'reel')) {
          return {
            type: 'post',
            rawInput: trimmed,
            handle: candidate,
            shortcode: segments[2],
            postUrl: `https://www.instagram.com/p/${segments[2]}/`,
          };
        }
        return {
          type: 'profile',
          rawInput: trimmed,
          handle: candidate,
          shortcode: null,
          postUrl: null,
        };
      }
    }
  }

  // Check direct post match without URL scheme
  const postMatch = trimmed.match(
    /(?:https?:\/\/(?:www\.)?instagram\.com)?\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/i
  );
  if (postMatch) {
    return {
      type: 'post',
      rawInput: trimmed,
      handle: null,
      shortcode: postMatch[1],
      postUrl: `https://www.instagram.com/p/${postMatch[1]}/`,
    };
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
