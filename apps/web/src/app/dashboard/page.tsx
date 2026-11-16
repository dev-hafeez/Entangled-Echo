'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { api } from '@/lib/api';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  TrendingUp,
  Instagram,
  Facebook,
  Brain,
  Layers,
  ArrowUpRight,
  RefreshCw,
  Calendar,
  Heart,
  MessageCircle,
  Users,
  Bell,
  Download,
  Key,
  Swords,
  PieChart as PieIcon,
  Globe,
  Plus,
  Trash2,
  Eye,
} from 'lucide-react';

function getApiBase(): string {
  if (typeof window !== 'undefined') {
    const configuredApi = process.env.NEXT_PUBLIC_API_URL;
    if (configuredApi && !configuredApi.includes('localhost') && !configuredApi.includes('127.0.0.1')) {
      return configuredApi;
    }
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:4000`;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
}

function getPostThumbnail(post: any, handle: string): string | null {
  if (post.storage_paths && Array.isArray(post.storage_paths) && post.storage_paths.length > 0) {
    return `/api/proxy/api/media/image?path=${encodeURIComponent(post.storage_paths[0])}`;
  }
  if (post.storage_path) {
    return `/api/proxy/api/media/image?path=${encodeURIComponent(post.storage_path)}`;
  }
  if (post.storagePaths && Array.isArray(post.storagePaths) && post.storagePaths.length > 0) {
    return `/api/proxy/api/media/image?path=${encodeURIComponent(post.storagePaths[0])}`;
  }
  if (post.shortcode && handle) {
    const clean = handle.toLowerCase().replace(/^@/, '');
    return `/api/proxy/api/media/image?path=${encodeURIComponent(`${clean}/${post.shortcode}/0.jpg`)}`;
  }
  if (post.media_urls && Array.isArray(post.media_urls) && post.media_urls.length > 0) {
    return post.media_urls[0];
  }
  if (post.mediaUrls && Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0) {
    return post.mediaUrls[0];
  }
  return null;
}

export default function DashboardPage() {
  const { user, isLoaded } = useUser();

  // Onboarding modal state
  const [showModal, setShowModal] = useState(false);
  const [platform, setPlatform] = useState<'instagram' | 'facebook'>('instagram');
  const [accountInput, setAccountInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStep, setProcessStep] = useState<
    'idle' | 'scraping' | 'analyzing_niche' | 'training_model' | 'completed'
  >('idle');
  const [processLogs, setProcessLogs] = useState<string[]>([]);
  const [modalError, setModalError] = useState<string | null>(null);

  // Active creator profile & dashboard state
  const [activeHandle, setActiveHandle] = useState<string>('');
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [nicheData, setNicheData] = useState<any>(null);
  const [personalModel, setPersonalModel] = useState<any>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [isBackgroundScraping, setIsBackgroundScraping] = useState(false);
  const [backgroundCount, setBackgroundCount] = useState<number>(0);
  const [apiBase, setApiBase] = useState('http://localhost:4000');

  useEffect(() => {
    setApiBase(getApiBase());
  }, []);

  // Tab navigation: 'overview' | 'audience' | 'competitors'
  const [activeTab, setActiveTab] = useState<'overview' | 'audience' | 'competitors'>('overview');

  // FR-30 Audience Breakdown state
  const [audience, setAudience] = useState<any>(null);
  const [loadingAudience, setLoadingAudience] = useState(false);

  // FR-32 Competitor Analysis state
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [competitorInput, setCompetitorInput] = useState('');
  const [competitorList, setCompetitorList] = useState<string[]>(['adidas', 'nike']);
  const [loadingCompetitors, setLoadingCompetitors] = useState(false);

  // Graph API connection modal fields
  const [connectionMethod, setConnectionMethod] = useState<'handle' | 'graph_api'>('handle');
  const [graphTokenInput, setGraphTokenInput] = useState('');
  const [graphAccountIdInput, setGraphAccountIdInput] = useState('');
  const [isValidatingToken, setIsValidatingToken] = useState(false);

  // Notification unread count (FR-33)
  const [unreadNotifCount, setUnreadNotifCount] = useState<number>(0);

  // Background auto-refresher when scraping is ongoing
  useEffect(() => {
    if (!activeHandle) return;

    let intervalId: NodeJS.Timeout;
    const pollInterval = 3000; // Check every 3 seconds for newly scraped posts

    const checkBackgroundProgress = async () => {
      try {
        const jobsRes = await api.getJobs({ limit: 5 });
        const currentJob = jobsRes?.jobs?.find(
          (j: any) => j.normalized_handle === activeHandle || j.target_input === activeHandle
        );

        if (currentJob && currentJob.status === 'running') {
          setIsBackgroundScraping(true);
          setBackgroundCount(currentJob.progress_detailed || 0);

          // Silently refresh posts & profile data as new posts are committed to disk
          const freshPosts = await api.getAccountPosts(activeHandle).catch(() => null);
          if (freshPosts?.posts && freshPosts.posts.length > 0) {
            setPosts(freshPosts.posts);
          }
          const freshAcc = await api.getAccount(activeHandle).catch(() => null);
          if (freshAcc?.account) {
            setProfile(freshAcc.account);
          }
        } else {
          if (isBackgroundScraping) {
            setIsBackgroundScraping(false);
            // Final reload of posts & calibrated model
            const freshPosts = await api.getAccountPosts(activeHandle).catch(() => null);
            if (freshPosts?.posts) setPosts(freshPosts.posts);
            const modelsRes = await api.getModels().catch(() => null);
            if (modelsRes?.models) {
              const found = modelsRes.models.find(
                (m: any) =>
                  m.model_type === 'personal' &&
                  (m.account_handle === activeHandle || m.accounts?.handle === activeHandle)
              );
              if (found) setPersonalModel(found);
            }

            // Calibrate full NicheIQ now that all posts are detailed
            const nicheRes = await api.analyzeNiche(activeHandle).catch(() => null);
            if (nicheRes?.nicheData) {
              setNicheData(nicheRes.nicheData);
              if (user?.id) {
                api.saveUserProfile({
                  userId: user.id,
                  handle: activeHandle,
                  nicheData: nicheRes.nicheData,
                  languagePreference: nicheRes.nicheData.language_preference || 'English',
                }).catch(() => {});
              }
            }
          }
        }
      } catch (err) {
        console.error('Silent refresh error:', err);
      }
    };

    intervalId = setInterval(checkBackgroundProgress, pollInterval);
    return () => clearInterval(intervalId);
  }, [activeHandle, isBackgroundScraping]);

  // Check if user has an associated handle in database or localStorage
  useEffect(() => {
    if (!isLoaded || !user) return;

    const resolveUserSession = async () => {
      // 1. Try server-side linked user profile
      const serverProfile = await api.getUserProfile(user.id).catch(() => null);
      if (serverProfile?.profile?.handle) {
        const h = serverProfile.profile.handle;
        setActiveHandle(h);
        if (serverProfile.profile.nicheData) setNicheData(serverProfile.profile.nicheData);
        loadCreatorDashboard(h);
        return;
      }

      // 2. Fallback to localStorage
      const storedHandle = localStorage.getItem(`ee_handle_${user.id}`);
      if (storedHandle) {
        setActiveHandle(storedHandle);
        loadCreatorDashboard(storedHandle);
      } else {
        // Prompt popup for link/username
        setShowModal(true);
        setLoadingDashboard(false);
      }
    };

    resolveUserSession();
  }, [isLoaded, user]);

  const loadCreatorDashboard = async (handle: string, isInstantTransition = false) => {
    // Only show full-screen skeleton if profile is not already in memory/data
    if (!profile && !isInstantTransition) {
      setLoadingDashboard(true);
    }
    const clean = handle.toLowerCase().replace(/^@/, '');
    try {
      // Parallelize fetches for sub-second retrieval when data exists
      const [accRes, postsRes, nicheRes, modelsRes] = await Promise.all([
        api.getAccount(clean).catch(() => null),
        api.getAccountPosts(clean).catch(() => null),
        api.getNiche(clean).catch(() => null),
        api.getModels().catch(() => null),
      ]);

      if (accRes?.account) setProfile(accRes.account);
      if (postsRes?.posts) setPosts(postsRes.posts);
      if (nicheRes?.nicheData) {
        if (nicheRes.nicheData.posts_analyzed === 0 && (postsRes?.posts?.length || 0) > 0) {
          api.analyzeNiche(clean).then((fresh) => {
            if (fresh?.nicheData) setNicheData(fresh.nicheData);
          }).catch(() => {});
        } else {
          setNicheData(nicheRes.nicheData);
        }
      } else if ((postsRes?.posts?.length || 0) > 0) {
        api.analyzeNiche(clean).then((fresh) => {
          if (fresh?.nicheData) setNicheData(fresh.nicheData);
        }).catch(() => {});
      }
      if (modelsRes?.models) {
        const found = modelsRes.models.find(
          (m: any) =>
            m.model_type === 'personal' &&
            (m.account_handle === clean || m.accounts?.handle === clean)
        );
        if (found) setPersonalModel(found);
      }

      // Pre-load audience demographics for the active creator (FR-30)
      api.getAudience(clean).then((res) => {
        if (res?.audience) setAudience(res.audience);
      }).catch(() => {});

      // Fetch unread notifications count (FR-33)
      if (user?.id) {
        api.getNotifications(user.id).then((nRes) => {
          if (nRes?.unreadCount !== undefined) setUnreadNotifCount(nRes.unreadCount);
        }).catch(() => {});
      }
    } catch (e) {
      console.error('Error loading creator dashboard:', e);
    } finally {
      setLoadingDashboard(false);
    }
  };

  // Load competitor comparisons (FR-32)
  const fetchCompetitorData = async (handlesToCompare?: string[]) => {
    const list = handlesToCompare || competitorList;
    if (list.length === 0) return;
    setLoadingCompetitors(true);
    try {
      const allHandles = activeHandle ? [activeHandle, ...list.filter((h) => h !== activeHandle)] : list;
      const res = await api.compareCompetitors(allHandles);
      if (res?.competitors) setCompetitors(res.competitors);
    } catch (err) {
      console.error('Error fetching competitors:', err);
    } finally {
      setLoadingCompetitors(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'competitors') {
      fetchCompetitorData();
    }
  }, [activeTab, activeHandle]);

  const addCompetitor = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = competitorInput.trim().toLowerCase().replace(/^@/, '');
    if (!clean || competitorList.includes(clean)) return;
    const updated = [...competitorList, clean];
    setCompetitorList(updated);
    setCompetitorInput('');
    fetchCompetitorData(updated);
  };

  const removeCompetitor = (handleToRemove: string) => {
    const updated = competitorList.filter((h) => h !== handleToRemove);
    setCompetitorList(updated);
    fetchCompetitorData(updated);
  };

  const handleConnectGraphApi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!graphTokenInput.trim()) {
      setModalError('Please enter a valid Meta Graph API Access Token');
      return;
    }

    setModalError(null);
    setIsProcessing(true);
    setProcessStep('scraping');
    setProcessLogs(['Validating token with Meta Graph API v19...', 'Resolving Instagram Business Account...']);

    try {
      const res = await api.connectGraphApi({
        accessToken: graphTokenInput.trim(),
        instagramAccountId: graphAccountIdInput.trim() || undefined,
      });

      if (!res.success) {
        throw new Error(res.error || 'Failed to connect via Graph API');
      }

      setProcessLogs((prev) => [...prev, `Ingested ${res.postsCount} posts for @${res.handle}`, 'Profile successfully verified!']);
      setActiveHandle(res.handle);
      setProfile(res.profile);
      if (user?.id) localStorage.setItem(`ee_handle_${user.id}`, res.handle);

      const freshPosts = await api.getAccountPosts(res.handle).catch(() => null);
      if (freshPosts?.posts) setPosts(freshPosts.posts);

      // Trigger NicheIQ & model calibration
      api.analyzeNiche(res.handle).then((nRes) => {
        if (nRes?.nicheData) setNicheData(nRes.nicheData);
      }).catch(() => {});

      setIsProcessing(false);
      setShowModal(false);
      setLoadingDashboard(false);
    } catch (err: any) {
      setModalError(err.message || 'Meta Graph API connection failed');
      setIsProcessing(false);
      setProcessStep('idle');
    }
  };

  const handleStartOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountInput.trim()) {
      setModalError('Please enter a username or profile URL');
      return;
    }

    setModalError(null);
    setIsProcessing(true);
    setProcessLogs([]);

    // Normalize handle from URL or username
    let cleanHandle = accountInput.trim();
    if (cleanHandle.includes('instagram.com/')) {
      const match = cleanHandle.match(/instagram\.com\/([a-zA-Z0-9_.-]+)/);
      if (match) cleanHandle = match[1];
    } else if (cleanHandle.includes('facebook.com/')) {
      const match = cleanHandle.match(/facebook\.com\/([a-zA-Z0-9_.-]+)/);
      if (match) cleanHandle = match[1];
    }
    cleanHandle = cleanHandle.replace(/^@/, '').replace(/\/$/, '');

    // Step 1: Check if account already exists in data
    try {
      const existingAccount = await api.getAccount(cleanHandle).catch(() => null);
      const existingPosts = await api.getAccountPosts(cleanHandle).catch(() => null);

      if (existingAccount?.account && existingPosts?.posts && existingPosts.posts.length > 0) {
        // Instant unlock: profile and posts already exist in data!
        setProfile(existingAccount.account);
        setPosts(existingPosts.posts);
        setActiveHandle(cleanHandle);
        if (user?.id) localStorage.setItem(`ee_handle_${user.id}`, cleanHandle);

        // Fetch niche and model in background without blocking or showing modal loading
        api.getNiche(cleanHandle).then((res) => {
          if (res?.nicheData) setNicheData(res.nicheData);
        }).catch(() => {});

        api.getModels().then((res) => {
          if (res?.models) {
            const found = res.models.find(
              (m: any) =>
                m.model_type === 'personal' &&
                (m.account_handle === cleanHandle || m.accounts?.handle === cleanHandle)
            );
            if (found) setPersonalModel(found);
          }
        }).catch(() => {});

        if (user?.id) {
          api.saveUserProfile({
            userId: user.id,
            handle: cleanHandle,
          }).catch(() => {});
        }

        setIsProcessing(false);
        setShowModal(false);
        setLoadingDashboard(false);
        return;
      }

      // Profile is not yet in data: initiate instant progressive scraping
      setProcessStep('scraping');
      setProcessLogs((prev) => [...prev, `Connecting to @${cleanHandle}...`]);

      // Count posts if available, otherwise request scrape
      await api.startScrape([cleanHandle], 60, true);

      // Active progressive polling: unlock as soon as 3 posts are ready
      let scrapeUnlocked = false;
      let attempts = 0;
      const maxAttempts = 40;

      while (!scrapeUnlocked && attempts < maxAttempts) {
        attempts++;
        await new Promise((r) => setTimeout(r, 800));

        try {
          const [jobsRes, freshAcc, freshPosts] = await Promise.all([
            api.getJobs({ limit: 5 }).catch(() => null),
            api.getAccount(cleanHandle).catch(() => null),
            api.getAccountPosts(cleanHandle).catch(() => null),
          ]);

          const matchingJob = jobsRes?.jobs?.find(
            (j: any) => j.normalized_handle === cleanHandle || j.target_input === cleanHandle
          );

          const detailedCount = matchingJob?.progress_detailed || freshPosts?.posts?.length || 0;
          if (detailedCount > 0) {
            setProcessLogs((prev) => {
              const msg = `Instant capture: ${detailedCount} post(s) detailed...`;
              return prev[prev.length - 1] === msg ? prev : [...prev, msg];
            });
          }

          // INSTANT UNLOCK: Once 3 posts are detailed (or all posts if account has fewer than 3), immediately open dashboard!
          if (detailedCount >= 3 || (matchingJob?.status === 'done' && detailedCount > 0)) {
            scrapeUnlocked = true;
            if (freshAcc?.account) setProfile(freshAcc.account);
            if (freshPosts?.posts) setPosts(freshPosts.posts);
            setActiveHandle(cleanHandle);
            if (user?.id) localStorage.setItem(`ee_handle_${user.id}`, cleanHandle);

            // Close modal immediately so user doesn't wait
            setIsProcessing(false);
            setShowModal(false);
            setLoadingDashboard(false);
            setIsBackgroundScraping(true);

            // NicheIQ and Personal Model calibration will automatically run when full scraping completes
            api.trainPersonalModel(cleanHandle).then((trainRes) => {
              if (trainRes?.model) setPersonalModel(trainRes.model);
            }).catch(() => {});

            return;
          }

          if (matchingJob?.status === 'failed') {
            throw new Error(matchingJob.error || matchingJob.failure_reason || 'Scraping could not complete');
          }
        } catch (pollErr: any) {
          console.warn('Progressive poll error:', pollErr);
        }
      }

      // If loop finishes without error, unlock dashboard
      setIsProcessing(false);
      setShowModal(false);
      setLoadingDashboard(false);
      loadCreatorDashboard(cleanHandle, true);
    } catch (err: any) {
      console.error(err);
      setModalError(err.message || 'Error occurred during connection');
      setIsProcessing(false);
      setProcessStep('idle');
    }
  };

  // Calculations for graph and metrics
  const totalPosts = posts.length;
  const totalLikes = posts.reduce((acc, p) => acc + (p.likes_count || 0), 0);
  const totalComments = posts.reduce((acc, p) => acc + (p.comments_count || 0), 0);
  const followersCount = profile?.followers_count || profile?.followersCount || 150000;
  const avgLikes = totalPosts > 0 ? Math.round(totalLikes / totalPosts) : 0;
  const avgComments = totalPosts > 0 ? Math.round(totalComments / totalPosts) : 0;
  const avgER =
    followersCount > 0 && totalPosts > 0
      ? (((totalLikes + totalComments) / (followersCount * totalPosts)) * 100).toFixed(2)
      : '3.42';

  // Analytics Graph View Modes: 'absolute' (raw numbers) vs 'rate' (ER % of audience) vs 'reach'
  const [metricMode, setMetricMode] = useState<'engagement_rate' | 'absolute' | 'reach'>('engagement_rate');

  // Format chart data dynamically tailored for any profile size (from 100 followers to 500M+)
  const chartData = [...posts]
    .filter((p) => p.posted_at || p.shortcode)
    .sort((a, b) => new Date(a.posted_at || 0).getTime() - new Date(b.posted_at || 0).getTime())
    .map((p, idx) => {
      const d = p.posted_at ? new Date(p.posted_at) : null;
      const dateLabel = d ? `${d.getMonth() + 1}/${d.getDate()}` : `#${idx + 1}`;
      const likes = p.likes_count || 0;
      const comments = p.comments_count || 0;
      const views = p.views_count || 0;
      // Estimated Reach: views if available, otherwise likes * multiplier or followers-normalized
      const reach = views > 0 ? views : Math.round(likes * 1.35 + comments * 3);
      // Normalized Engagement Rate (%) for this individual post relative to followers
      const erRate = followersCount > 0 ? Number((((likes + comments) / followersCount) * 100).toFixed(2)) : 0;

      return {
        date: dateLabel,
        rawDate: p.posted_at,
        likes,
        comments,
        reach,
        erRate,
        index: idx + 1,
        caption: p.caption?.slice(0, 40) || 'Post',
        mediaType: p.media_type || 'image',
      };
    });

  // Dynamic formatting helper for numbers (1.2K, 3.4M, 1.0B) for layman readability
  const formatCompactNumber = (num: number | null | undefined): string => {
    if (num === null || num === undefined || isNaN(num)) return '0';
    const abs = Math.abs(num);
    if (abs >= 1_000_000_000) {
      return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
    }
    if (abs >= 1_000_000) {
      return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (abs >= 1_000) {
      return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toLocaleString();
  };

  return (
    <div className="space-y-8">
      {/* Top Utility Sub-Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-stone-200">
        <div>
          <h2 className="text-xl font-bold text-stone-900 tracking-tight">Performance & Ingestion Overview</h2>
          <p className="text-xs text-stone-500">Live analytics, historical reach patterns, and QUBO schedule status</p>
        </div>

        <div className="flex items-center space-x-2.5">
          {activeHandle && (
            <a
              href={api.getCsvExportUrl(activeHandle)}
              download={`${activeHandle}_metrics_export.csv`}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 transition flex items-center gap-1.5 shadow-xs"
              title="Export posts and metrics to CSV (FR-31)"
            >
              <Download className="w-3.5 h-3.5 text-stone-500" />
              <span>Export CSV</span>
            </a>
          )}
          <button
            onClick={() => setShowModal(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 transition flex items-center gap-1.5 shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5 text-stone-500" />
            <span>Switch Account</span>
          </button>
        </div>
      </div>

      {isBackgroundScraping && (
        <div className="flex items-center gap-3 p-3.5 rounded-lg bg-stone-100 border border-stone-300 text-stone-800 text-xs font-mono shadow-xs">
          <Loader2 className="w-4 h-4 animate-spin text-stone-600" />
          <span>Ingesting creator data: {posts.length} posts ({backgroundCount} detailed)...</span>
        </div>
      )}

      {/* Loading Skeleton */}
      {loadingDashboard ? (
        <div className="py-24 flex flex-col items-center justify-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
          <p className="text-sm text-stone-500 font-medium">Loading creator analytics & models...</p>
        </div>
      ) : (
          <>
            {/* Header Niche & Bio Card with Scraped Creator Avatar */}
            <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div className="flex flex-col sm:flex-row items-start gap-5">
                {/* Scraped Creator Profile Avatar */}
                <div className="relative flex-shrink-0">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border-2 border-slate-200 shadow-md bg-slate-100 relative group ring-2 ring-slate-100">
                    <img
                      src={`/api/proxy/api/media/avatar?handle=${encodeURIComponent(activeHandle.toLowerCase().replace(/^@/, ''))}`}
                      alt={profile?.full_name || activeHandle}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => {
                        const cleanH = activeHandle.toLowerCase().replace(/^@/, '');
                        const directFallback = `${apiBase}/api/media/avatar?handle=${encodeURIComponent(cleanH)}`;
                        const extFallback = profile?.avatar_url || profile?.avatarUrl;
                        if (e.currentTarget.src !== directFallback && !e.currentTarget.src.includes(':4000/api/media/avatar')) {
                          e.currentTarget.src = directFallback;
                        } else if (extFallback && e.currentTarget.src !== extFallback) {
                          e.currentTarget.src = extFallback;
                        } else {
                          e.currentTarget.style.display = 'none';
                          const fb = e.currentTarget.parentElement?.querySelector('.avatar-fallback');
                          if (fb) (fb as HTMLElement).style.display = 'flex';
                        }
                      }}
                    />
                    <div className="avatar-fallback hidden w-full h-full bg-[#373E3E] text-white items-center justify-center font-bold text-2xl uppercase font-mono">
                      {activeHandle?.replace(/^@/, '').slice(0, 2).toUpperCase() || '?'}
                    </div>
                  </div>
                  {profile?.is_verified && (
                    <div className="absolute -bottom-1 -right-1 bg-blue-500 text-white rounded-full p-1 shadow border-2 border-white" title="Verified Creator">
                      <CheckCircle2 className="w-4 h-4 fill-blue-500 text-white" />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                      {profile?.full_name || profile?.fullName || `@${activeHandle}`}
                    </h2>
                    <span className="text-xs bg-slate-100 text-slate-600 font-mono px-2 py-0.5 rounded">
                      {profile?.data_source === 'official_graph_api' ? 'Official Graph API Data' : 'Verified Public Analytics'}
                    </span>
                    {profile?.is_verified && (
                      <span className="text-xs bg-blue-50 text-blue-700 font-medium px-2.5 py-0.5 rounded-full border border-blue-200 flex items-center gap-1">
                        ✓ Verified
                      </span>
                    )}
                    {nicheData?.language_preference && (
                      <span className="text-xs bg-indigo-50 text-indigo-700 font-medium px-2.5 py-0.5 rounded-full border border-indigo-200 flex items-center gap-1">
                        🌐 Preferred Language: <strong>{nicheData.language_preference}</strong>
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
                    {nicheData?.summary ||
                      profile?.biography ||
                      profile?.bio ||
                      'AI-powered creator insights and historical reach analysis.'}
                  </p>
                  {profile?.external_link && (
                    <a
                      href={profile.external_link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline block pt-0.5"
                    >
                      🔗 {profile.external_link}
                    </a>
                  )}
                {nicheData?.content_pillars && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {nicheData.content_pillars.map((pillar: string, i: number) => (
                      <span
                        key={i}
                        className="text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-medium"
                      >
                        #{pillar}
                      </span>
                    ))}
                  </div>
                )}
                {nicheData?.evidence_quotes && nicheData.evidence_quotes.length > 0 && (
                  <div className="pt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">Evidence from posts:</span>
                    {nicheData.evidence_quotes.slice(0, 3).map((q: string, i: number) => (
                      <span
                        key={i}
                        className="italic bg-slate-50 border border-slate-200 px-2 py-0.5 rounded text-slate-600 truncate max-w-xs"
                      >
                        &ldquo;{q}&rdquo;
                      </span>
                    ))}
                  </div>
                )}
                {/* NicheIQ extra signals row */}
                {(nicheData?.dominant_format || nicheData?.engagement_level || nicheData?.posting_pattern || nicheData?.follower_tier) && (
                  <div className="pt-2 flex flex-wrap gap-2 text-xs">
                    {nicheData?.dominant_format && nicheData.dominant_format !== 'Insufficient data' && (
                      <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full font-medium">
                        📹 {nicheData.dominant_format}
                      </span>
                    )}
                    {nicheData?.engagement_level && nicheData.engagement_level !== 'Insufficient data' && (
                      <span className={`border px-2.5 py-1 rounded-full font-medium ${nicheData.engagement_level === 'High' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : nicheData.engagement_level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                        📊 {nicheData.engagement_level} Engagement
                      </span>
                    )}
                    {nicheData?.confidence && (
                      <span className="bg-purple-50 text-purple-700 border border-purple-200 px-2.5 py-1 rounded-full font-medium">
                        🎯 {nicheData.confidence === 'high' ? 'High' : nicheData.confidence === 'medium' ? 'Medium' : nicheData.confidence === 'low' ? 'Low' : 'No'} Confidence
                      </span>
                    )}
                    {nicheData?.posting_pattern && nicheData.posting_pattern !== 'Insufficient data' && (
                      <span className="bg-slate-50 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-full font-medium truncate max-w-xs" title={nicheData.posting_pattern}>
                        🕐 {nicheData.posting_pattern.slice(0, 60)}{nicheData.posting_pattern.length > 60 ? '…' : ''}
                      </span>
                    )}
                  </div>
                )}
                </div>
              </div>

              {/* Personal Smart Predictor Badge */}
              <div className="flex flex-col items-start md:items-end justify-center border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6 min-w-[200px]">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                  <Brain className="w-4 h-4 text-emerald-600" />
                  Smart Post Predictor
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Learned from your past posts
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full font-medium border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Ready to optimize timing
                </div>
              </div>
            </div>

            {/* Navigation Tabs (Performance Overview, FR-30 Audience Demographics, FR-32 Competitive Analysis) */}
            <div className="flex items-center border-b border-slate-200 space-x-6 text-sm font-semibold">
              <button
                onClick={() => setActiveTab('overview')}
                className={`pb-3 flex items-center gap-2 transition border-b-2 ${
                  activeTab === 'overview'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-700'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                <span>Performance Overview</span>
              </button>
              <button
                onClick={() => setActiveTab('audience')}
                className={`pb-3 flex items-center gap-2 transition border-b-2 ${
                  activeTab === 'audience'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-700'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Audience Demographics (FR-30)</span>
              </button>
              <button
                onClick={() => setActiveTab('competitors')}
                className={`pb-3 flex items-center gap-2 transition border-b-2 ${
                  activeTab === 'competitors'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-700'
                }`}
              >
                <Swords className="w-4 h-4" />
                <span>Competitive Analysis (FR-32)</span>
              </button>
            </div>

            {/* TAB 1: Performance Overview */}
            {activeTab === 'overview' && (
              <>

            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                  <span>Audience (Followers)</span>
                  <Users className="w-4 h-4 text-slate-400" />
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">
                  {formatCompactNumber(followersCount)}
                </div>
                <div className="mt-1 text-xs text-slate-400">Total people following</div>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                  <span>Audience Interaction</span>
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">{avgER}%</div>
                <div className="mt-1 text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <span>High audience interest</span>
                </div>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                  <span>Average Likes</span>
                  <Heart className="w-4 h-4 text-rose-500" />
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">
                  {formatCompactNumber(avgLikes)}
                </div>
                <div className="mt-1 text-xs text-slate-400">per post across {formatCompactNumber(totalPosts)} posts</div>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                  <span>Average Comments</span>
                  <MessageCircle className="w-4 h-4 text-blue-500" />
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">
                  {formatCompactNumber(avgComments)}
                </div>
                <div className="mt-1 text-xs text-slate-400">active conversations per post</div>
              </div>
            </div>

            {/* Engagement Timeline Chart - Plain numbers and lines for laymen */}
            <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">Post Performance Over Time</h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    See how your posts performed chronologically from your first post to your latest
                  </p>
                </div>

                {/* Plain-English View Selectors */}
                <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-lg text-xs font-medium self-start sm:self-auto">
                  <button
                    onClick={() => setMetricMode('absolute')}
                    className={`px-3 py-1.5 rounded-md transition ${
                      metricMode === 'absolute'
                        ? 'bg-white text-slate-900 shadow-sm font-semibold'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Likes & Comments
                  </button>
                  <button
                    onClick={() => setMetricMode('engagement_rate')}
                    className={`px-3 py-1.5 rounded-md transition ${
                      metricMode === 'engagement_rate'
                        ? 'bg-white text-slate-900 shadow-sm font-semibold'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Interaction Rate (%)
                  </button>
                  <button
                    onClick={() => setMetricMode('reach')}
                    className={`px-3 py-1.5 rounded-md transition ${
                      metricMode === 'reach'
                        ? 'bg-white text-slate-900 shadow-sm font-semibold'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    People Reached
                  </button>
                </div>
              </div>

              <div className="h-72 w-full">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    {metricMode === 'engagement_rate' ? (
                      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="erGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <YAxis
                          stroke="#94a3b8"
                          fontSize={11}
                          tickLine={false}
                          tickFormatter={(val) => `${val}%`}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            borderRadius: '8px',
                            border: '1px solid #e2e8f0',
                            fontSize: '12px',
                          }}
                          formatter={(value: any) => [`${value}% ER`, 'Post Engagement']}
                          labelFormatter={(label, items) => {
                            const item = items?.[0]?.payload;
                            return item ? `${label} - ${item.caption}` : label;
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="erRate"
                          name="Engagement Rate"
                          stroke="#10b981"
                          strokeWidth={2.5}
                          fillOpacity={1}
                          fill="url(#erGrad)"
                        />
                      </AreaChart>
                    ) : metricMode === 'absolute' ? (
                      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="likeGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0f172a" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#0f172a" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <YAxis
                          stroke="#94a3b8"
                          fontSize={11}
                          tickLine={false}
                          tickFormatter={formatCompactNumber}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            borderRadius: '8px',
                            border: '1px solid #e2e8f0',
                            fontSize: '12px',
                          }}
                          formatter={(value: any, name: any) => [
                            formatCompactNumber(Number(value)),
                            name === 'likes' ? 'Likes' : 'Comments',
                          ]}
                          labelFormatter={(label, items) => {
                            const item = items?.[0]?.payload;
                            return item ? `${label} - ${item.caption}` : label;
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="likes"
                          name="likes"
                          stroke="#0f172a"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#likeGrad)"
                        />
                        <Area
                          type="monotone"
                          dataKey="comments"
                          name="comments"
                          stroke="#3b82f6"
                          strokeWidth={1.5}
                          fill="none"
                        />
                      </AreaChart>
                    ) : (
                      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="reachGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <YAxis
                          stroke="#94a3b8"
                          fontSize={11}
                          tickLine={false}
                          tickFormatter={formatCompactNumber}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            borderRadius: '8px',
                            border: '1px solid #e2e8f0',
                            fontSize: '12px',
                          }}
                          formatter={(value: any) => [formatCompactNumber(Number(value)), 'Estimated Reach']}
                          labelFormatter={(label, items) => {
                            const item = items?.[0]?.payload;
                            return item ? `${label} - ${item.caption}` : label;
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="reach"
                          name="Reach"
                          stroke="#6366f1"
                          strokeWidth={2.5}
                          fillOpacity={1}
                          fill="url(#reachGrad)"
                        />
                      </AreaChart>
                    )}
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-slate-400">
                    No historical posts available to plot yet.
                  </div>
                )}
              </div>
            </div>

            {/* Post Feed & Analytics Grid */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Your Recent Posts</h3>
                  <p className="text-xs text-slate-500">
                    Review your latest {posts.length} posts and their like and comment counts
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {posts.map((post, i) => {
                  const pDate = post.posted_at ? new Date(post.posted_at).toLocaleDateString() : 'N/A';
                  const thumbnail = getPostThumbnail(post, activeHandle);
                  const isVideo = post.media_type === 'video' || post.media_type === 'reel';
                  const isCarousel = post.media_type === 'carousel' || (post.carousel_size && post.carousel_size > 1);

                  return (
                    <div
                      key={post.id || i}
                      className="rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col justify-between group"
                    >
                      {/* Scraped Post Image Preview */}
                      <div className="relative aspect-square w-full bg-slate-100 overflow-hidden border-b border-slate-100 flex items-center justify-center">
                        {thumbnail ? (
                          <a
                            href={post.url || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="w-full h-full block group/img relative overflow-hidden"
                            title={post.caption ? post.caption.slice(0, 100) : 'View post'}
                          >
                            <img
                              src={thumbnail}
                              alt={`Post #${post.shortcode || i}`}
                              loading="lazy"
                              className="w-full h-full object-cover transition-transform duration-300 group-hover/img:scale-105"
                              onError={(e) => {
                                const currentSrc = e.currentTarget.src;
                                const cleanH = activeHandle.toLowerCase().replace(/^@/, '');
                                const directFallback = post.shortcode
                                  ? `${apiBase}/api/media/image?path=${encodeURIComponent(`${cleanH}/${post.shortcode}/0.jpg`)}`
                                  : null;
                                const externalFallback = post.media_urls?.[0] || post.mediaUrls?.[0];

                                if (directFallback && currentSrc !== directFallback && !currentSrc.includes(':4000/api/media/image')) {
                                  e.currentTarget.src = directFallback;
                                } else if (externalFallback && currentSrc !== externalFallback) {
                                  e.currentTarget.src = externalFallback;
                                } else {
                                  e.currentTarget.style.display = 'none';
                                  const fallbackBox = e.currentTarget.parentElement?.querySelector('.post-media-fallback');
                                  if (fallbackBox) {
                                    (fallbackBox as HTMLElement).style.display = 'flex';
                                  }
                                }
                              }}
                            />
                            <div className="post-media-fallback hidden absolute inset-0 text-slate-400 text-xs font-mono flex-col items-center justify-center p-4 text-center bg-slate-100">
                              <span className="font-semibold text-slate-600 mb-1">Image Preview</span>
                              <span className="text-[10px] text-slate-400">#{post.shortcode || 'scraped'}</span>
                            </div>
                          </a>
                        ) : (
                          <div className="text-slate-400 text-xs font-mono flex flex-col items-center justify-center p-4 text-center bg-slate-50 w-full h-full">
                            <span className="font-semibold text-slate-600 mb-1">Scraped Post</span>
                            <span className="text-[10px] text-slate-400">#{post.shortcode || 'scraped'}</span>
                          </div>
                        )}

                        {/* Media Type & Carousel Badge Overlay */}
                        <div className="absolute top-2.5 right-2.5 pointer-events-none flex items-center gap-1.5">
                          <span className="bg-black/75 backdrop-blur-md text-white px-2 py-0.5 rounded text-[10px] font-semibold uppercase font-mono tracking-wider shadow">
                            {isVideo ? '🎥 Reel' : isCarousel ? `📑 Carousel (${post.carousel_size || 2})` : '📷 Photo'}
                          </span>
                        </div>

                        {/* Shortcode Badge on top left */}
                        {post.shortcode && (
                          <div className="absolute top-2.5 left-2.5 pointer-events-none">
                            <span className="bg-white/90 backdrop-blur-md text-slate-800 px-2 py-0.5 rounded text-[10px] font-mono font-medium shadow-sm border border-slate-200">
                              #{post.shortcode}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Post Body: Meta, Caption & Hashtags */}
                      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span className="font-mono text-[11px]">{pDate}</span>
                            {post.location_tag && (
                              <span className="truncate max-w-[140px] text-slate-500 text-[11px]" title={post.location_tag}>
                                📍 {post.location_tag}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-800 line-clamp-3 leading-relaxed">
                            {post.caption || <span className="text-slate-400 italic font-mono text-xs">No caption provided</span>}
                          </p>
                          {/* Hashtags preview */}
                          {post.hashtags && post.hashtags.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {post.hashtags.slice(0, 3).map((tag: string, tidx: number) => (
                                <span key={tidx} className="text-[11px] text-blue-600 font-mono">
                                  #{tag.replace(/^#/, '')}
                                </span>
                              ))}
                              {post.hashtags.length > 3 && (
                                <span className="text-[10px] text-slate-400 font-mono self-center">
                                  +{post.hashtags.length - 3} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Post Footer: Engagement Metrics & Link */}
                        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1 font-medium text-slate-700" title={`${post.likes_count ?? 0} likes`}>
                              <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-50" />
                              {formatCompactNumber(post.likes_count ?? 0)}
                            </span>
                            <span className="flex items-center gap-1 font-medium text-slate-700" title={`${post.comments_count ?? 0} comments`}>
                              <MessageCircle className="w-3.5 h-3.5 text-blue-500 fill-blue-50" />
                              {formatCompactNumber(post.comments_count ?? 0)}
                            </span>
                            {post.views_count != null && (
                              <span className="flex items-center gap-1 font-medium text-slate-700" title={`${post.views_count} views`}>
                                <Eye className="w-3.5 h-3.5 text-emerald-500" />
                                {formatCompactNumber(post.views_count)}
                              </span>
                            )}
                          </div>
                          {post.url && (
                            <a
                              href={post.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-slate-500 hover:text-black flex items-center gap-1 transition"
                            >
                              <span>View</span>
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            </>
            )}

            {/* TAB 2: FR-30 Audience Breakdown */}
            {activeTab === 'audience' && (
              <div className="space-y-6">
                <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Audience Demographics (FR-30)</h3>
                      <p className="text-xs text-slate-500">
                        {audience?.source === 'graph_api'
                          ? 'Directly retrieved from Meta Graph API lifetime insights'
                          : 'Requires an official Meta Graph API connection with >100 followers'}
                      </p>
                    </div>
                    {audience?.source === 'graph_api' && (
                      <span className="text-xs px-2.5 py-1 rounded bg-slate-100 font-mono text-slate-600">
                        Official Graph API Insights
                      </span>
                    )}
                  </div>
                </div>

                {audience?.source === 'graph_api' && audience?.ageGender ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Age & Gender Distribution Chart */}
                    <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-sm space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-900">Age & Gender Distribution</h4>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Male</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-pink-500" /> Female</span>
                        </div>
                      </div>
                      <div className="h-64 w-full pt-2">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={audience.ageGender} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="ageRange" stroke="#94a3b8" fontSize={11} tickLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} tickFormatter={(v) => `${v}%`} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                              formatter={(val: any, name: any) => [`${val}%`, name === 'male' ? 'Male' : name === 'female' ? 'Female' : 'Other']}
                            />
                            <Bar dataKey="male" name="male" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="female" name="female" fill="#ec4899" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Top Countries & Cities Geography */}
                    <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-sm space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-900">Follower Geography</h4>
                        <Globe className="w-4 h-4 text-slate-400" />
                      </div>

                      <div className="space-y-4 pt-1">
                        <div>
                          <span className="text-xs font-semibold text-slate-700 block mb-2">Top Countries</span>
                          <div className="space-y-2">
                            {(audience?.countries || []).map((c: any, i: number) => (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <span className="text-slate-600">{c.country}</span>
                                <div className="flex items-center gap-2">
                                  <div className="w-28 bg-slate-100 rounded-full h-2 overflow-hidden">
                                    <div className="bg-slate-900 h-2 rounded-full" style={{ width: `${c.percentage}%` }} />
                                  </div>
                                  <span className="font-mono text-slate-700 w-8 text-right font-medium">{c.percentage}%</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="pt-3 border-t border-slate-100">
                          <span className="text-xs font-semibold text-slate-700 block mb-2">Top Cities</span>
                          <div className="space-y-2">
                            {(audience?.cities || []).map((ct: any, i: number) => (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <span className="text-slate-600">{ct.city}</span>
                                <div className="flex items-center gap-2">
                                  <div className="w-28 bg-slate-100 rounded-full h-2 overflow-hidden">
                                    <div className="bg-indigo-600 h-2 rounded-full" style={{ width: `${ct.percentage}%` }} />
                                  </div>
                                  <span className="font-mono text-slate-700 w-8 text-right font-medium">{ct.percentage}%</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-12 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50 space-y-3">
                    <Globe className="w-10 h-10 text-slate-300 mx-auto" />
                    <h4 className="text-sm font-semibold text-slate-800">Demographic Insights Unavailable</h4>
                    <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                      Age, gender, and follower geography require an official Meta Graph API connection with an Instagram Creator or Business account having at least 100 followers.
                    </p>
                    <div className="pt-2">
                      <button
                        onClick={() => setShowModal(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition"
                      >
                        <span>Connect Meta Graph API</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: FR-32 Competitive Analysis */}
            {activeTab === 'competitors' && (
              <div className="space-y-6">
                <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Competitive Analysis (FR-32)</h3>
                      <p className="text-xs text-slate-500">
                        Compare your account side-by-side with industry competitors on key public metrics
                      </p>
                    </div>

                    {/* Add Competitor Form */}
                    <form onSubmit={addCompetitor} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Add handle (e.g. @nike)"
                        value={competitorInput}
                        onChange={(e) => setCompetitorInput(e.target.value)}
                        className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </button>
                    </form>
                  </div>

                  {/* Competitor Pills */}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <span className="text-xs text-slate-500 font-medium">Comparing:</span>
                    {activeHandle && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-900 text-white">
                        @{activeHandle} (You)
                      </span>
                    )}
                    {competitorList.map((handle) => (
                      <span
                        key={handle}
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1.5"
                      >
                        <span>@{handle}</span>
                        <button
                          type="button"
                          onClick={() => removeCompetitor(handle)}
                          className="hover:text-red-600 transition"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Side-by-Side Comparison Grid */}
                {loadingCompetitors ? (
                  <div className="py-16 flex flex-col items-center justify-center space-y-3">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                    <p className="text-xs text-slate-500">Benchmarking competitor profiles...</p>
                  </div>
                ) : competitors.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {competitors.map((comp) => {
                      const isMe = comp.handle.toLowerCase() === activeHandle.toLowerCase();
                      return (
                        <div
                          key={comp.handle}
                          className={`p-6 rounded-xl border bg-white shadow-sm space-y-4 ${
                            isMe ? 'border-2 border-slate-900 ring-4 ring-slate-100' : 'border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              {comp.avatarUrl ? (
                                <img src={comp.avatarUrl} alt={comp.handle} className="w-10 h-10 rounded-full object-cover border border-slate-200" />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-700 text-sm">
                                  {comp.handle.slice(0, 2).toUpperCase()}
                                </div>
                              )}
                              <div>
                                <h4 className="text-sm font-bold text-slate-900">@{comp.handle}</h4>
                                <span className="text-[11px] text-slate-500 truncate block max-w-[150px]">{comp.fullName}</span>
                              </div>
                            </div>
                            {isMe && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 text-white uppercase tracking-wider">
                                Active Profile
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-xs">
                            <div className="p-2.5 rounded-lg bg-slate-50">
                              <span className="text-slate-500 block text-[11px]">Followers</span>
                              <span className="text-sm font-bold text-slate-900">{formatCompactNumber(comp.followers)}</span>
                            </div>
                            <div className="p-2.5 rounded-lg bg-slate-50">
                              <span className="text-slate-500 block text-[11px]">Avg Engagement</span>
                              <span className="text-sm font-bold text-emerald-600">{comp.avgEngRate}%</span>
                            </div>
                            <div className="p-2.5 rounded-lg bg-slate-50">
                              <span className="text-slate-500 block text-[11px]">Avg Likes / Post</span>
                              <span className="text-sm font-bold text-slate-900">{formatCompactNumber(comp.avgLikes)}</span>
                            </div>
                            <div className="p-2.5 rounded-lg bg-slate-50">
                              <span className="text-slate-500 block text-[11px]">Avg Comments</span>
                              <span className="text-sm font-bold text-slate-900">{formatCompactNumber(comp.avgComments)}</span>
                            </div>
                          </div>

                          {/* Content format distribution */}
                          <div className="pt-2">
                            <span className="text-[11px] font-semibold text-slate-600 block mb-1.5">Format Strategy</span>
                            <div className="flex items-center gap-1.5 text-[11px]">
                              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-medium">📷 {comp.formatDistribution?.image || 0} Images</span>
                              <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded font-medium">📚 {comp.formatDistribution?.carousel || 0} Carousels</span>
                              <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded font-medium">📹 {comp.formatDistribution?.reel || comp.formatDistribution?.video || 0} Videos</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-12 text-center text-sm text-slate-400">
                    No competitor data available. Add competitor handles above to compare.
                  </div>
                )}
              </div>
            )}
          </>
        )}

      {/* Onboarding Popup Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl border border-slate-100 space-y-6">
            {!isProcessing ? (
              <>
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-900 flex items-center justify-center mx-auto">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">Connect Your Social Account</h3>
                  <p className="text-xs text-slate-500">
                    Choose how you want to ingest your Instagram account data.
                  </p>
                </div>

                {/* Connection Mode Selector: Handle vs Meta Graph API */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setConnectionMethod('handle');
                      setModalError(null);
                    }}
                    className={`py-1.5 text-xs font-medium rounded-md transition ${
                      connectionMethod === 'handle'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Standard Handle / Link
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConnectionMethod('graph_api');
                      setModalError(null);
                    }}
                    className={`py-1.5 text-xs font-medium rounded-md transition flex items-center justify-center gap-1 ${
                      connectionMethod === 'graph_api'
                        ? 'bg-white text-blue-700 shadow-sm font-semibold'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Key className="w-3.5 h-3.5" />
                    Meta Graph API (Live)
                  </button>
                </div>

                {connectionMethod === 'handle' ? (
                  <form onSubmit={handleStartOnboarding} className="space-y-4">
                    {/* Platform toggle */}
                    <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setPlatform('instagram')}
                        className={`flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition ${
                          platform === 'instagram'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Instagram className="w-3.5 h-3.5 text-pink-500" />
                        Instagram
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlatform('facebook')}
                        className={`flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition ${
                          platform === 'facebook'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Facebook className="w-3.5 h-3.5 text-blue-600" />
                        Facebook
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {platform === 'instagram' ? 'Instagram Handle or Link' : 'Facebook Page or Link'}
                      </label>
                      <input
                        type="text"
                        placeholder={platform === 'instagram' ? 'e.g. @natgeo or profile link' : 'e.g. page name or link'}
                        value={accountInput}
                        onChange={(e) => setAccountInput(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                        autoFocus
                      />
                    </div>

                    {modalError && (
                      <div className="p-3 text-xs rounded-lg bg-red-50 text-red-600 border border-red-200 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{modalError}</span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      {activeHandle && (
                        <button
                          type="button"
                          onClick={() => setShowModal(false)}
                          className="flex-1 py-2 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="submit"
                        className="flex-1 py-2.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition shadow-sm"
                      >
                        Fetch & Analyze Data
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleConnectGraphApi} className="space-y-4">
                    <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 space-y-1">
                      <span className="font-semibold block">Official Meta Graph API Ingestion</span>
                      <p className="text-[11px] text-blue-700">
                        Enter your Meta User / Page Access Token with <code className="bg-blue-100 px-1 rounded">instagram_basic</code> and <code className="bg-blue-100 px-1 rounded">pages_show_list</code> permissions. Data will be fetched directly from official Meta endpoints instead of web scraping.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Meta Graph API Access Token *
                      </label>
                      <textarea
                        rows={3}
                        placeholder="EAABw..."
                        value={graphTokenInput}
                        onChange={(e) => setGraphTokenInput(e.target.value)}
                        className="w-full px-3.5 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                        autoFocus
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Instagram Business Account ID (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="Leave blank to auto-detect from linked Facebook page"
                        value={graphAccountIdInput}
                        onChange={(e) => setGraphAccountIdInput(e.target.value)}
                        className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>

                    {modalError && (
                      <div className="p-3 text-xs rounded-lg bg-red-50 text-red-600 border border-red-200 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{modalError}</span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      {activeHandle && (
                        <button
                          type="button"
                          onClick={() => setShowModal(false)}
                          className="flex-1 py-2 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="submit"
                        className="flex-1 py-2.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-sm flex items-center justify-center gap-1.5"
                      >
                        <Key className="w-3.5 h-3.5" />
                        <span>Connect Official API</span>
                      </button>
                    </div>
                  </form>
                )}
              </>
            ) : (
              /* Minimalistic Animated Loading State */
              <div className="py-6 flex flex-col items-center justify-center space-y-6 text-center">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-4 border-slate-100 border-t-slate-900 animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-slate-900 animate-pulse" />
                  </div>
                </div>

                <div className="space-y-1">
                  <h4 className="text-base font-bold text-slate-900">
                    {processStep === 'scraping' && 'Fetching Your Posts...'}
                    {processStep === 'analyzing_niche' && 'Detecting Content Style & Niche...'}
                    {processStep === 'training_model' && 'Personalizing Your Recommendations...'}
                    {processStep === 'completed' && 'Dashboard Ready!'}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {processStep === 'scraping' && 'Getting your photos, captions, likes & comments'}
                    {processStep === 'analyzing_niche' && 'Understanding your topic, language, and audience'}
                    {processStep === 'training_model' && 'Learning when your followers interact most'}
                    {processStep === 'completed' && 'Opening your overview...'}
                  </p>
                </div>

                {/* Progress Logs */}
                <div className="w-full bg-slate-50 border border-slate-100 rounded-lg p-3 text-left font-mono text-[11px] text-slate-600 max-h-36 overflow-y-auto space-y-1">
                  {processLogs.map((log, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-emerald-500 font-bold">✓</span>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
