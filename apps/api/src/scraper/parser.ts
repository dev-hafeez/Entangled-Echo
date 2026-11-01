import { MetricPrecision, ParsedMetric, MetricSource } from './types.js';

/**
 * Parses numeric strings such as "1,234", "1.2M", "45.6K", "0"
 * Returns the parsed integer count and the precision indicator.
 * Strictly returns null if value cannot be parsed. Never defaults or clamps.
 */
export function parseCountString(
  rawStr: string | null | undefined,
  source: MetricSource = null
): ParsedMetric {
  if (rawStr === null || rawStr === undefined) {
    return { count: null, rawStr: null, precision: null, source: null };
  }

  const clean = rawStr.trim();
  if (clean === '') {
    return { count: null, rawStr: null, precision: null, source: null };
  }

  // Remove commas and spaces
  const normalized = clean.replace(/,/g, '').trim();

  // Check for "0" explicitly
  if (normalized === '0') {
    return { count: 0, rawStr: clean, precision: 'exact', source };
  }

  // Match K / M / B
  const kMatch = normalized.match(/^([\d.]+)\s*[kK]$/);
  if (kMatch) {
    const num = parseFloat(kMatch[1]);
    if (!isNaN(num)) {
      return {
        count: Math.round(num * 1000),
        rawStr: clean,
        precision: 'approximate_k',
        source,
      };
    }
  }

  const mMatch = normalized.match(/^([\d.]+)\s*[mM]$/);
  if (mMatch) {
    const num = parseFloat(mMatch[1]);
    if (!isNaN(num)) {
      return {
        count: Math.round(num * 1000000),
        rawStr: clean,
        precision: 'approximate_m',
        source,
      };
    }
  }

  const bMatch = normalized.match(/^([\d.]+)\s*[bB]$/);
  if (bMatch) {
    const num = parseFloat(bMatch[1]);
    if (!isNaN(num)) {
      return {
        count: Math.round(num * 1000000000),
        rawStr: clean,
        precision: 'approximate_m',
        source,
      };
    }
  }

  // Pure integer / float
  const directMatch = normalized.match(/^(\d+)$/);
  if (directMatch) {
    const num = parseInt(directMatch[1], 10);
    if (!isNaN(num)) {
      return { count: num, rawStr: clean, precision: 'exact', source };
    }
  }

  return { count: null, rawStr: clean, precision: null, source: null };
}

/**
 * Parses an exact number from JSON or API response
 */
export function parseExactNumber(
  value: number | null | undefined,
  source: MetricSource = 'network_json'
): ParsedMetric {
  if (value === null || value === undefined || isNaN(value)) {
    return { count: null, rawStr: null, precision: null, source: null };
  }
  return {
    count: Math.round(value),
    rawStr: String(value),
    precision: 'exact',
    source,
  };
}

/**
 * Extracts hashtags strictly from real caption text.
 * Never invents or predicts hashtags.
 */
export function extractHashtags(caption: string | null | undefined): string[] {
  if (!caption || typeof caption !== 'string') return [];
  // Match unicode hashtags
  const matches = caption.match(/#([\p{L}\p{N}_]+)/gu);
  if (!matches) return [];
  const uniqueTags = new Set(
    matches.map((tag) => tag.replace('#', '').trim().toLowerCase())
  );
  return Array.from(uniqueTags).filter((t) => t.length > 0);
}

/**
 * Extracts mentions strictly from real caption text.
 */
export function extractMentions(caption: string | null | undefined): string[] {
  if (!caption || typeof caption !== 'string') return [];
  const matches = caption.match(/@([\w.]+)/g);
  if (!matches) return [];
  const uniqueMentions = new Set(
    matches.map((m) => m.replace('@', '').trim().toLowerCase())
  );
  return Array.from(uniqueMentions).filter((m) => m.length > 0);
}

/**
 * Parses timestamp string or epoch number into valid ISO string.
 * Strictly returns NULL if unavailable. NEVER defaults to Date.now().
 */
export function parseDateTime(
  value: string | number | null | undefined
): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // If number, could be unix epoch in seconds or ms
  if (typeof value === 'number') {
    if (value <= 0) return null;
    const epochMs = value < 10000000000 ? value * 1000 : value;
    const d = new Date(epochMs);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // If string consists solely of digits
  if (/^\d+$/.test(value)) {
    const num = parseInt(value, 10);
    if (num <= 0) return null;
    const epochMs = num < 10000000000 ? num * 1000 : num;
    const d = new Date(epochMs);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Parse ISO or date string
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}
