const getBaseUrl = (endpoint: string = '') => {
  // In the browser, determine destination based on endpoint and authentication model:
  // 1. Admin-only endpoints require the same-site Next.js proxy route so HttpOnly admin_session cookie is passed seamlessly.
  // 2. User endpoints with Clerk JWT authentication connect directly to the Express API to preserve Bearer token credentials.
  const isAdminEndpoint =
    endpoint.startsWith('/api/admin') ||
    endpoint.startsWith('/api/jobs') ||
    endpoint.startsWith('/api/session') ||
    endpoint.startsWith('/api/scrape') ||
    endpoint.startsWith('/api/models');

  if (typeof window !== 'undefined') {
    if (isAdminEndpoint) {
      return '/api/proxy';
    }
    const configuredApi = process.env.NEXT_PUBLIC_API_URL;
    if (configuredApi && !configuredApi.includes('localhost') && !configuredApi.includes('127.0.0.1')) {
      return configuredApi;
    }
    // Match current window protocol and hostname to prevent cross-origin/IPv4-IPv6 mismatch
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:4000`;
  }
  return process.env.NEXT_PUBLIC_API_URL || process.env.INTERNAL_API_URL || process.env.API_URL || 'http://localhost:4000';
};

let clerkTokenGetter: (() => Promise<string | null>) | null = null;

/**
 * Configure dynamic session token retrieval for client-side API calls.
 */
export function setClerkTokenGetter(getter: () => Promise<string | null>) {
  clerkTokenGetter = getter;
}

export async function fetchFromApi(endpoint: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  // If Authorization header is not already explicitly supplied, attempt to attach active Clerk JWT for user requests
  if (!headers['Authorization'] && !headers['authorization']) {
    let token: string | null = null;
    if (clerkTokenGetter) {
      try {
        token = await clerkTokenGetter();
      } catch {}
    } else if (typeof window !== 'undefined' && (window as any).Clerk?.session?.getToken) {
      try {
        token = await (window as any).Clerk.session.getToken();
      } catch {}
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const targetUrl = `${getBaseUrl(endpoint)}${endpoint}`;
  try {
    const res = await fetch(targetUrl, {
      ...options,
      credentials: 'include',
      headers,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `API error: ${res.statusText}`);
    }
    return data;
  } catch (err: any) {
    if (err?.name === 'TypeError' && (err?.message?.includes('fetch') || err?.message?.includes('NetworkError'))) {
      throw new Error(`NetworkError: Unable to connect to backend API server at ${targetUrl}. Please ensure the API server is running on port 4000.`);
    }
    throw err;
  }
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

  // Model Evaluation Harness
  getLatestEval: () => fetchFromApi('/api/models/eval/latest'),
  getEvalRuns: () => fetchFromApi('/api/models/eval/runs'),
  runEval: (snapshot: string = '2026-11-02', minPersonal: number = 30) =>
    fetchFromApi('/api/models/eval/run', {
      method: 'POST',
      body: JSON.stringify({ snapshot, min_personal: minPersonal }),
    }),

  pauseQueue: () =>
    fetchFromApi('/api/jobs/pause', { method: 'POST' }),

  resumeQueue: () =>
    fetchFromApi('/api/jobs/resume', { method: 'POST' }),

  // Onboarding, User Session & Niche AI
  analyzeNiche: (handle: string, platform: string = 'instagram') =>
    fetchFromApi('/api/onboarding/analyze-niche', {
      method: 'POST',
      body: JSON.stringify({ handle, platform }),
    }),

  getNiche: (handle: string) =>
    fetchFromApi(`/api/onboarding/niche/${encodeURIComponent(handle)}`),

  saveUserProfile: (body: { userId: string; handle: string; nicheData?: any; languagePreference?: string }) =>
    fetchFromApi('/api/onboarding/user-profile', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getUserProfile: (userId: string) =>
    fetchFromApi(`/api/onboarding/user-profile/${encodeURIComponent(userId)}`),

  // Session & Deep Scraping
  getSessionStatus: () =>
    fetchFromApi('/api/session/status'),

  runCanaryCheck: () =>
    fetchFromApi('/api/session/canary'),

  getCuratedList: () =>
    fetchFromApi('/api/session/curated-list'),

  getMediaSignedUrl: (path: string) =>
    fetchFromApi(`/api/media/signed-url?path=${encodeURIComponent(path)}`),

  // Trend-Driven Recommendations Engine
  generateRecommendations: (handle: string, platform: string = 'instagram') =>
    fetchFromApi('/api/recommendations/generate', {
      method: 'POST',
      body: JSON.stringify({ handle, platform }),
    }),

  // FR-30 Audience Breakdown
  getAudience: (handle: string) =>
    fetchFromApi(`/api/accounts/${encodeURIComponent(handle)}/audience`),

  // FR-31 Data Export (CSV)
  getCsvExportUrl: (handle: string) => {
    const ep = `/api/accounts/${encodeURIComponent(handle)}/export/csv`;
    return `${getBaseUrl(ep)}${ep}`;
  },

  // FR-32 Competitive Analysis
  compareCompetitors: (handles: string[]) =>
    fetchFromApi(`/api/accounts/competitors/compare?handles=${encodeURIComponent(handles.join(','))}`),

  // Graph API Official Connection
  connectGraphApi: (body: { accessToken: string; instagramAccountId?: string }) =>
    fetchFromApi('/api/graph/connect', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Notifications & Alerts (FR-33, FR-34, FR-35)
  getNotifications: (userId: string = 'default_user') =>
    fetchFromApi(`/api/notifications?userId=${encodeURIComponent(userId)}`),

  markNotificationRead: (id: string, userId: string = 'default_user') =>
    fetchFromApi(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
      body: JSON.stringify({ userId }),
    }),

  markAllNotificationsRead: (userId: string = 'default_user') =>
    fetchFromApi('/api/notifications/mark-all-read', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  getNotificationPreferences: (userId: string = 'default_user') =>
    fetchFromApi(`/api/notifications/preferences?userId=${encodeURIComponent(userId)}`),

  updateNotificationPreferences: (userId: string, prefs: any) =>
    fetchFromApi('/api/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify({ userId, ...prefs }),
    }),

  triggerWeeklyDigest: (userId: string, handle: string, email: string) =>
    fetchFromApi('/api/notifications/digest/trigger', {
      method: 'POST',
      body: JSON.stringify({ userId, handle, email }),
    }),

  // Content Calendar & Scheduling (FR-25, FR-26, FR-27, FR-28)
  getScheduledPosts: (userId: string = 'default_user', handle?: string) =>
    fetchFromApi(`/api/calendar/posts?userId=${encodeURIComponent(userId)}${handle ? `&handle=${encodeURIComponent(handle)}` : ''}`),

  getScheduledPost: (id: string, userId: string = 'default_user') =>
    fetchFromApi(`/api/calendar/posts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`),

  createScheduledPost: (post: any) =>
    fetchFromApi('/api/calendar/posts', {
      method: 'POST',
      body: JSON.stringify(post),
    }),

  updateScheduledPost: (id: string, updates: any) =>
    fetchFromApi(`/api/calendar/posts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),

  reschedulePost: (id: string, newScheduledTime: string, userId: string = 'default_user') =>
    fetchFromApi(`/api/calendar/posts/${encodeURIComponent(id)}/reschedule`, {
      method: 'PATCH',
      body: JSON.stringify({ newScheduledTime, userId }),
    }),

  publishPostNow: (id: string, userId: string = 'default_user', forceError: boolean = false) =>
    fetchFromApi(`/api/calendar/posts/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ userId, forceError }),
    }),

  deleteScheduledPost: (id: string, userId: string = 'default_user') =>
    fetchFromApi(`/api/calendar/posts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),

  getRecommendedSlots: (handle: string) =>
    fetchFromApi(`/api/calendar/slots/recommended?handle=${encodeURIComponent(handle)}`),

  triggerPublishTick: () =>
    fetchFromApi('/api/calendar/tick', {
      method: 'POST',
    }),
};
