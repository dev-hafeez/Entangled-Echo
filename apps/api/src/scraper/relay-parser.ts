/**
 * Searches an arbitrary object recursively for keys matching target names
 */
export function findNestedObjects(obj: any, targetKeys: string[]): any[] {
  const results: any[] = [];
  const seen = new Set();

  function recurse(current: any) {
    if (!current || typeof current !== 'object') return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        recurse(item);
      }
      return;
    }

    for (const key of Object.keys(current)) {
      if (targetKeys.includes(key) && current[key] !== null && current[key] !== undefined) {
        results.push({ key, value: current[key] });
      }
      recurse(current[key]);
    }
  }

  recurse(obj);
  return results;
}

/**
 * Extracts Relay / GraphQL payloads from an inline script tag or network JSON
 */
export function extractRelayPayloads(rawTextOrJson: string | any): any[] {
  let parsed: any;
  if (typeof rawTextOrJson === 'string') {
    try {
      parsed = JSON.parse(rawTextOrJson);
    } catch {
      return [];
    }
  } else {
    parsed = rawTextOrJson;
  }

  const matches = findNestedObjects(parsed, [
    'xig_user_by_username',
    'xdt_shortcode_media',
    'shortcode_media',
    'polaris_ordered_timeline_connection',
    'xdt_api__v1__media__shortcode__web_info',
    'items',
  ]);

  return matches;
}
