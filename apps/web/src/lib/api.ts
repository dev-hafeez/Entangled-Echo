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

  getJobs: (params?: { status?: string; search?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status && params.status !== 'all') q.set('status', params.status);
    if (params?.search) q.set('search', params.search);
    if (params?.page) q.set('page', params.page.toString());
    if (params?.limit) q.set('limit', params.limit.toString());
    const queryStr = q.toString();
    return fetchFromApi(`/api/jobs${queryStr ? `?${queryStr}` : ''}`);
  },

  retryJob: (id: string) =>
    fetchFromApi(`/api/jobs/${id}/retry`, { method: 'POST' }),

  cancelJob: (id: string) =>
    fetchFromApi(`/api/jobs/${id}/cancel`, { method: 'POST' }),

  deleteJob: (id: string) =>
    fetchFromApi(`/api/jobs/${id}`, { method: 'DELETE' }),

  clearJobs: (type: 'completed' | 'queued' | 'all' = 'completed') =>
    fetchFromApi(`/api/jobs?type=${type}`, { method: 'DELETE' }),

  clearCompletedJobs: () =>
    fetchFromApi('/api/jobs?type=completed', { method: 'DELETE' }),

  clearQueuedJobs: () =>
    fetchFromApi('/api/jobs?type=queued', { method: 'DELETE' }),

  clearAllJobs: () =>
    fetchFromApi('/api/jobs?type=all', { method: 'DELETE' }),

  // Accounts
  getAccounts: () => fetchFromApi('/api/accounts'),

  getAccount: (handle: string) => fetchFromApi(`/api/accounts/${encodeURIComponent(handle)}`),

  deleteAccount: (idOrHandle: string) =>
    fetchFromApi(`/api/accounts/${encodeURIComponent(idOrHandle)}`, { method: 'DELETE' }),

  getAccountPosts: (handle: string) =>
    fetchFromApi(`/api/accounts/${encodeURIComponent(handle)}/posts`),

  // Models
  getModels: () => fetchFromApi('/api/models'),

  deleteModel: (id: string) =>
    fetchFromApi(`/api/models/${id}`, { method: 'DELETE' }),

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
