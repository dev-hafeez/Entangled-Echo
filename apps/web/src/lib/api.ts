const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function fetchFromApi(endpoint: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `API error: ${res.statusText}`);
  }
  return data;
}

export const api = {
  // Scraper & Jobs
  startScrape: (inputs: string[], maxPosts?: number | null, headless: boolean = true) =>
    fetchFromApi('/api/scrape', {
      method: 'POST',
      body: JSON.stringify({ inputs, maxPosts, headless }),
    }),

  getJobs: () => fetchFromApi('/api/jobs'),

  retryJob: (id: string) =>
    fetchFromApi(`/api/jobs/${id}/retry`, { method: 'POST' }),

  cancelJob: (id: string) =>
    fetchFromApi(`/api/jobs/${id}/cancel`, { method: 'POST' }),

  // Accounts
  getAccounts: () => fetchFromApi('/api/accounts'),

  getAccount: (handle: string) => fetchFromApi(`/api/accounts/${encodeURIComponent(handle)}`),

  getAccountPosts: (handle: string) =>
    fetchFromApi(`/api/accounts/${encodeURIComponent(handle)}/posts`),

  // Models
  getModels: () => fetchFromApi('/api/models'),

  trainGlobalModel: () =>
    fetchFromApi('/api/models/train-global', { method: 'POST' }),

  trainPersonalModel: (handle: string) =>
    fetchFromApi(`/api/models/train-personal/${encodeURIComponent(handle)}`, { method: 'POST' }),

  predict: (body: { handle: string; caption?: string; mediaType?: string; plannedTime?: string | null }) =>
    fetchFromApi('/api/models/predict', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getMediaSignedUrl: (path: string) =>
    fetchFromApi(`/api/media/signed-url?path=${encodeURIComponent(path)}`),
};
