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
  Heart,
  MessageCircle,
  Users,
  Bell,
  Download,
  Key,
  Swords,
  Globe,
  Plus,
  Trash2,
  Camera,
  Video,
  Target,
  Clock,
} from 'lucide-react';

function ProfileAvatar({
  url,
  name,
  handle,
}: {
  url?: string | null;
  name?: string;
  handle?: string;
}) {
  const [imgError, setImgError] = useState(false);
  const initial = (name || handle || 'E')[0]?.toUpperCase() || 'E';

  if (url && !imgError) {
    return (
      <img
        src={url}
        alt={name || handle || 'Creator profile picture'}
        onError={() => setImgError(true)}
        className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border-2 border-[#d8e0d5] shadow-sm shrink-0"
      />
    );
  }

  return (
    <div
      aria-label={name || handle || 'Creator avatar'}
      className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#f0f4ee] border-2 border-[#d8e0d5] flex items-center justify-center font-bold text-xl sm:text-2xl text-[#1b3026] shrink-0"
    >
      {initial}
    </div>
  );
}

function PostThumbnail({ url, caption }: { url?: string | null; caption?: string }) {
  const [imgError, setImgError] = useState(false);

  if (url && !imgError) {
    return (
      <div className="w-full aspect-square bg-[#f0f4ee] border-b border-[#e3e8e1] overflow-hidden relative">
        <img
          src={url}
          alt={caption ? caption.slice(0, 30) : 'Post preview'}
          onError={() => setImgError(true)}
          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className="w-full aspect-square bg-[#f0f4ee] border-b border-[#e3e8e1] flex flex-col items-center justify-center text-[#748379] gap-1.5 p-4 text-center">
      <Instagram className="w-8 h-8 opacity-30 text-[#285a49]" />
      <span className="text-[11px] font-mono opacity-60">No image preview</span>
    </div>
  );
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
  const followersCount = profile?.followers_count ?? profile?.followersCount ?? 0;
  const avgLikes = totalPosts > 0 ? Math.round(totalLikes / totalPosts) : 0;
  const avgComments = totalPosts > 0 ? Math.round(totalComments / totalPosts) : 0;
  const avgER =
    followersCount > 0 && totalPosts > 0
      ? (((totalLikes + totalComments) / (followersCount * totalPosts)) * 100).toFixed(2)
      : '0.00';

  // Analytics Graph View Modes: 'absolute' (raw numbers) vs 'rate' (ER % of audience) vs 'reach'
  const [metricMode, setMetricMode] = useState<'engagement_rate' | 'absolute' | 'reach'>('engagement_rate');

  // Format chart data dynamically tailored for any profile size
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
    <div className="min-h-screen bg-[#fbfaf8] text-[#1b3026] pb-16">
      {/* Top Bar with Profile Info & Quick Actions */}
      <div className="border-b border-[#e3e8e1] bg-white sticky top-12 z-20 shadow-[0_1px_2px_rgba(27,48,38,0.03)]">
        <div className="max-w-[1150px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-3 flex-wrap min-h-[48px]">
          <div className="flex items-center space-x-3 flex-wrap gap-y-2">
            <span className="font-bold text-base tracking-tight text-[#1b3026]">EntangledEcho</span>
            {activeHandle && (
              <div className="flex items-center space-x-1.5 bg-[#f0f4ee] border border-[#d8e0d5] px-2.5 py-0.5 rounded-full text-xs font-medium text-[#20372d]">
                <Instagram className="w-3.5 h-3.5 text-[#285a49]" />
                <span>@{activeHandle}</span>
              </div>
            )}
            {nicheData?.niche && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#eef6eb] text-[#285a49] border border-[#cbe2c5]">
                <Sparkles className="w-3 h-3 text-[#285a49]" />
                {nicheData.niche}
              </span>
            )}
            {profile?.data_source === 'official_graph_api' && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#eef6eb] text-[#285a49] border border-[#cbe2c5]">
                <CheckCircle2 className="w-3 h-3 text-[#285a49]" />
                Meta Graph API Verified
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2.5 flex-wrap gap-y-2">
            {activeHandle && (
              <a
                href={api.getCsvExportUrl(activeHandle)}
                download={`${activeHandle}_metrics_export.csv`}
                className="text-xs font-semibold text-white bg-[#20372d] border border-[#20372d] hover:bg-white hover:text-[#20372d] hover:border-[#20372d] px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
                title="Export posts and metrics to CSV (FR-31)"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </a>
            )}
            <Link
              href="/recommendations"
              className="text-xs font-semibold text-white bg-[#20372d] border border-[#20372d] hover:bg-white hover:text-[#20372d] hover:border-[#20372d] px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Recommendations</span>
            </Link>
            {isBackgroundScraping && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#f0f4ee] text-[#20372d] text-xs font-mono border border-[#d8e0d5]">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#285a49]" />
                <span>Live Ingestion: {posts.length} posts ({backgroundCount} detailed)...</span>
              </div>
            )}
            <Link
              href="/notifications"
              className="relative p-2 rounded-lg text-[#55635a] hover:text-[#1b3026] hover:bg-[#f0f4ee] transition-colors border border-[#e3e8e1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
              title="Notifications & Alerts (FR-33)"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#20372d] text-[10px] font-bold text-white shadow">
                  {unreadNotifCount}
                </span>
              )}
            </Link>
            <button
              onClick={() => setShowModal(true)}
              className="text-xs font-semibold text-white bg-[#20372d] border border-[#20372d] hover:bg-white hover:text-[#20372d] hover:border-[#20372d] px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Switch Account
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1150px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Loading Skeleton */}
        {loadingDashboard ? (
          <div className="py-24 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-[#285a49]" />
            <p className="text-sm text-[#55635a]">Loading creator analytics & models...</p>
          </div>
        ) : (
          <>
            {/* Header Niche & Bio Card */}
            <div className="p-6 rounded-xl border border-[#e3e8e1] bg-white shadow-sm flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div className="flex items-start gap-4 sm:gap-5 flex-1">
                <ProfileAvatar
                  url={profile?.avatar_url || profile?.avatarUrl || profile?.profile_pic_url}
                  name={profile?.full_name || profile?.fullName}
                  handle={activeHandle}
                />
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#1b3026]">
                      {profile?.full_name || profile?.fullName || (activeHandle ? `@${activeHandle}` : 'Creator')}
                    </h2>
                    {activeHandle && (
                      <span className="text-xs text-[#55635a] font-mono">@{activeHandle}</span>
                    )}
                    <span className="text-[11px] bg-[#f0f4ee] text-[#285a49] border border-[#d8e0d5] font-mono px-2 py-0.5 rounded">
                      {profile?.data_source === 'official_graph_api' ? 'Official Graph API Data' : 'Verified Public Analytics'}
                    </span>
                    {nicheData?.language_preference && (
                      <span className="text-xs bg-[#eef6eb] text-[#285a49] font-medium px-2.5 py-0.5 rounded-full border border-[#cbe2c5] flex items-center gap-1">
                        <Globe className="w-3 h-3 text-[#285a49]" />
                        Preferred Language: <strong>{nicheData.language_preference}</strong>
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-[#55635a] max-w-2xl leading-relaxed">
                    {profile?.biography ||
                      profile?.bio ||
                      nicheData?.summary ||
                      'No bio yet'}
                  </p>

                  {/* Followers, Following, Posts Count row */}
                  <div className="flex items-center gap-6 pt-2 text-xs text-[#55635a] flex-wrap">
                    <span className="flex items-center gap-1.5">
                      <strong className="font-bold text-base text-[#1b3026]">
                        {formatCompactNumber(followersCount)}
                      </strong>{' '}
                      followers
                    </span>
                    <span className="flex items-center gap-1.5">
                      <strong className="font-bold text-base text-[#1b3026]">
                        {formatCompactNumber(profile?.following_count ?? profile?.followingCount ?? 0)}
                      </strong>{' '}
                      following
                    </span>
                    <span className="flex items-center gap-1.5">
                      <strong className="font-bold text-base text-[#1b3026]">
                        {formatCompactNumber(totalPosts)}
                      </strong>{' '}
                      posts
                    </span>
                  </div>

                  {nicheData?.content_pillars && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {nicheData.content_pillars.map((pillar: string, i: number) => (
                        <span
                          key={i}
                          className="text-xs px-2.5 py-0.5 rounded-md bg-[#f0f4ee] text-[#20372d] border border-[#d8e0d5] font-medium"
                        >
                          #{pillar}
                        </span>
                      ))}
                    </div>
                  )}

                  {nicheData?.evidence_quotes && nicheData.evidence_quotes.length > 0 && (
                    <div className="pt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[#748379]">
                      <span className="font-medium text-[#55635a]">Evidence from posts:</span>
                      {nicheData.evidence_quotes.slice(0, 3).map((q: string, i: number) => (
                        <span
                          key={i}
                          className="italic bg-[#f7f9f6] border border-[#e3e8e1] px-2 py-0.5 rounded text-[#55635a] truncate max-w-xs"
                        >
                          &ldquo;{q}&rdquo;
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Signals row without emoji */}
                  {(nicheData?.dominant_format || nicheData?.engagement_level || nicheData?.posting_pattern || nicheData?.follower_tier) && (
                    <div className="pt-2 flex flex-wrap gap-2 text-xs">
                      {nicheData?.dominant_format && nicheData.dominant_format !== 'Insufficient data' && (
                        <span className="bg-[#eef6eb] text-[#285a49] border border-[#cbe2c5] px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                          <Video className="w-3 h-3 text-[#285a49]" />
                          {nicheData.dominant_format}
                        </span>
                      )}
                      {nicheData?.engagement_level && nicheData.engagement_level !== 'Insufficient data' && (
                        <span className="bg-[#f0f4ee] text-[#20372d] border border-[#d8e0d5] px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                          <TrendingUp className="w-3 h-3 text-[#285a49]" />
                          {nicheData.engagement_level} Engagement
                        </span>
                      )}
                      {nicheData?.confidence && (
                        <span className="bg-[#eef6eb] text-[#285a49] border border-[#cbe2c5] px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                          <Target className="w-3 h-3 text-[#285a49]" />
                          {nicheData.confidence === 'high' ? 'High' : nicheData.confidence === 'medium' ? 'Medium' : nicheData.confidence === 'low' ? 'Low' : 'Calibrated'} Confidence
                        </span>
                      )}
                      {nicheData?.posting_pattern && nicheData.posting_pattern !== 'Insufficient data' && (
                        <span className="bg-[#f0f4ee] text-[#55635a] border border-[#e3e8e1] px-2.5 py-1 rounded-full font-medium flex items-center gap-1 truncate max-w-xs" title={nicheData.posting_pattern}>
                          <Clock className="w-3 h-3 text-[#748379]" />
                          {nicheData.posting_pattern.slice(0, 60)}{nicheData.posting_pattern.length > 60 ? '…' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Personal Smart Predictor Badge */}
              <div className="flex flex-col items-start md:items-end justify-center border-t md:border-t-0 md:border-l border-[#e3e8e1] pt-4 md:pt-0 md:pl-6 min-w-[200px]">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#1b3026]">
                  <Brain className="w-4 h-4 text-[#285a49]" />
                  <span>Smart Post Predictor</span>
                </div>
                <p className="text-xs text-[#748379] mt-1">
                  Learned from your past posts
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#285a49] bg-[#eef6eb] px-2.5 py-1 rounded-full font-medium border border-[#cbe2c5]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Ready to optimize timing</span>
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center border-b border-[#e3e8e1] space-x-6 text-sm font-semibold overflow-x-auto">
              <button
                onClick={() => setActiveTab('overview')}
                className={`pb-3 flex items-center gap-2 transition-colors border-b-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                  activeTab === 'overview'
                    ? 'border-[#20372d] text-[#1b3026]'
                    : 'border-transparent text-[#748379] hover:text-[#1b3026]'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                <span>Performance Overview</span>
              </button>
              <button
                onClick={() => setActiveTab('audience')}
                className={`pb-3 flex items-center gap-2 transition-colors border-b-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                  activeTab === 'audience'
                    ? 'border-[#20372d] text-[#1b3026]'
                    : 'border-transparent text-[#748379] hover:text-[#1b3026]'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Audience Demographics (FR-30)</span>
              </button>
              <button
                onClick={() => setActiveTab('competitors')}
                className={`pb-3 flex items-center gap-2 transition-colors border-b-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                  activeTab === 'competitors'
                    ? 'border-[#20372d] text-[#1b3026]'
                    : 'border-transparent text-[#748379] hover:text-[#1b3026]'
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
                  <div className="p-5 rounded-xl border border-[#e3e8e1] bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <div className="flex items-center justify-between text-[#748379] text-xs font-medium">
                      <span>Audience (Followers)</span>
                      <Users className="w-4 h-4 text-[#285a49]" />
                    </div>
                    <div className="mt-2 text-2xl font-bold text-[#1b3026]">
                      {formatCompactNumber(followersCount)}
                    </div>
                    <div className="mt-1 text-xs text-[#748379]">Total people following</div>
                  </div>

                  <div className="p-5 rounded-xl border border-[#e3e8e1] bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <div className="flex items-center justify-between text-[#748379] text-xs font-medium">
                      <span>Audience Interaction</span>
                      <TrendingUp className="w-4 h-4 text-[#285a49]" />
                    </div>
                    <div className="mt-2 text-2xl font-bold text-[#1b3026]">{avgER}%</div>
                    <div className="mt-1 text-xs text-[#285a49] font-medium flex items-center gap-1">
                      <span>High audience interest</span>
                    </div>
                  </div>

                  <div className="p-5 rounded-xl border border-[#e3e8e1] bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <div className="flex items-center justify-between text-[#748379] text-xs font-medium">
                      <span>Average Likes</span>
                      <Heart className="w-4 h-4 text-[#285a49]" />
                    </div>
                    <div className="mt-2 text-2xl font-bold text-[#1b3026]">
                      {formatCompactNumber(avgLikes)}
                    </div>
                    <div className="mt-1 text-xs text-[#748379]">per post across {formatCompactNumber(totalPosts)} posts</div>
                  </div>

                  <div className="p-5 rounded-xl border border-[#e3e8e1] bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <div className="flex items-center justify-between text-[#748379] text-xs font-medium">
                      <span>Average Comments</span>
                      <MessageCircle className="w-4 h-4 text-[#347761]" />
                    </div>
                    <div className="mt-2 text-2xl font-bold text-[#1b3026]">
                      {formatCompactNumber(avgComments)}
                    </div>
                    <div className="mt-1 text-xs text-[#748379]">active conversations per post</div>
                  </div>
                </div>

                {/* Engagement Timeline Chart */}
                <div className="p-6 rounded-xl border border-[#e3e8e1] bg-white shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-[#1b3026]">Post Performance Over Time</h3>
                      </div>
                      <p className="text-xs text-[#748379] mt-0.5">
                        Chronological performance from your first post to your latest
                      </p>
                    </div>

                    {/* Plain-English View Selectors */}
                    <div className="flex items-center gap-1.5 p-1 bg-[#f0f4ee] border border-[#e3e8e1] rounded-lg text-xs font-medium self-start sm:self-auto">
                      <button
                        onClick={() => setMetricMode('absolute')}
                        className={`px-3 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                          metricMode === 'absolute'
                            ? 'bg-white text-[#1b3026] shadow-sm font-semibold'
                            : 'text-[#55635a] hover:text-[#1b3026]'
                        }`}
                      >
                        Likes & Comments
                      </button>
                      <button
                        onClick={() => setMetricMode('engagement_rate')}
                        className={`px-3 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                          metricMode === 'engagement_rate'
                            ? 'bg-white text-[#1b3026] shadow-sm font-semibold'
                            : 'text-[#55635a] hover:text-[#1b3026]'
                        }`}
                      >
                        Interaction Rate (%)
                      </button>
                      <button
                        onClick={() => setMetricMode('reach')}
                        className={`px-3 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                          metricMode === 'reach'
                            ? 'bg-white text-[#1b3026] shadow-sm font-semibold'
                            : 'text-[#55635a] hover:text-[#1b3026]'
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
                                <stop offset="5%" stopColor="#285a49" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#285a49" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef3ec" />
                            <XAxis dataKey="date" stroke="#748379" fontSize={11} tickLine={false} />
                            <YAxis
                              stroke="#748379"
                              fontSize={11}
                              tickLine={false}
                              tickFormatter={(val) => `${val}%`}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#ffffff',
                                borderRadius: '8px',
                                border: '1px solid #e3e8e1',
                                fontSize: '12px',
                                color: '#1b3026',
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
                              stroke="#285a49"
                              strokeWidth={2.5}
                              fillOpacity={1}
                              fill="url(#erGrad)"
                            />
                          </AreaChart>
                        ) : metricMode === 'absolute' ? (
                          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="likeGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#20372d" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#20372d" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef3ec" />
                            <XAxis dataKey="date" stroke="#748379" fontSize={11} tickLine={false} />
                            <YAxis
                              stroke="#748379"
                              fontSize={11}
                              tickLine={false}
                              tickFormatter={formatCompactNumber}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#ffffff',
                                borderRadius: '8px',
                                border: '1px solid #e3e8e1',
                                fontSize: '12px',
                                color: '#1b3026',
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
                              stroke="#20372d"
                              strokeWidth={2}
                              fillOpacity={1}
                              fill="url(#likeGrad)"
                            />
                            <Area
                              type="monotone"
                              dataKey="comments"
                              name="comments"
                              stroke="#347761"
                              strokeWidth={1.5}
                              fill="none"
                            />
                          </AreaChart>
                        ) : (
                          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="reachGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#285a49" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="#285a49" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef3ec" />
                            <XAxis dataKey="date" stroke="#748379" fontSize={11} tickLine={false} />
                            <YAxis
                              stroke="#748379"
                              fontSize={11}
                              tickLine={false}
                              tickFormatter={formatCompactNumber}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#ffffff',
                                borderRadius: '8px',
                                border: '1px solid #e3e8e1',
                                fontSize: '12px',
                                color: '#1b3026',
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
                              stroke="#285a49"
                              strokeWidth={2.5}
                              fillOpacity={1}
                              fill="url(#reachGrad)"
                            />
                          </AreaChart>
                        )}
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-[#748379]">
                        No historical posts available to plot yet.
                      </div>
                    )}
                  </div>
                </div>

                {/* Post Feed & Analytics Grid */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-[#1b3026]">Your Recent Posts</h3>
                      <p className="text-xs text-[#748379]">
                        Review your latest {posts.length} posts and their engagement metrics
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {posts.map((post, i) => {
                      const pDate = post.posted_at ? new Date(post.posted_at).toLocaleDateString() : 'N/A';
                      const postImageUrl = post.media_urls?.[0] || post.mediaUrls?.[0] || null;
                      return (
                        <div
                          key={post.id || i}
                          className="rounded-xl border border-[#e3e8e1] bg-white hover:border-[#d8e0d5] transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 duration-200 flex flex-col justify-between overflow-hidden group"
                        >
                          <PostThumbnail url={postImageUrl} caption={post.caption} />

                          <div className="p-5 space-y-3 flex-1 flex flex-col justify-between">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs text-[#748379]">
                                <span className="font-mono">{pDate}</span>
                                <span className="capitalize px-2 py-0.5 bg-[#f0f4ee] border border-[#d8e0d5] rounded text-[#20372d] font-medium">
                                  {post.media_type || 'image'}
                                </span>
                              </div>
                              <p className="text-sm text-[#1b3026] line-clamp-3 leading-relaxed">
                                {post.caption || <span className="text-[#748379] italic">No caption</span>}
                              </p>
                            </div>

                            <div className="pt-3 border-t border-[#e3e8e1] flex items-center justify-between text-xs text-[#55635a]">
                              <div className="flex items-center gap-3">
                                <span className="flex items-center gap-1 font-medium">
                                  <Heart className="w-3.5 h-3.5 text-[#285a49]" />
                                  {formatCompactNumber(post.likes_count ?? 0)}
                                </span>
                                <span className="flex items-center gap-1 font-medium">
                                  <MessageCircle className="w-3.5 h-3.5 text-[#347761]" />
                                  {formatCompactNumber(post.comments_count ?? 0)}
                                </span>
                              </div>
                              {post.url && (
                                <a
                                  href={post.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[#285a49] hover:text-[#1b3026] flex items-center gap-0.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] rounded"
                                >
                                  <span>View</span>
                                  <ArrowUpRight className="w-3 h-3" />
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
                <div className="p-6 rounded-xl border border-[#e3e8e1] bg-white shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-[#1b3026]">Audience Demographics (FR-30)</h3>
                      <p className="text-xs text-[#748379]">
                        {audience?.source === 'graph_api'
                          ? 'Directly retrieved from Meta Graph API lifetime insights'
                          : 'Requires an official Meta Graph API connection with >100 followers'}
                      </p>
                    </div>
                    {audience?.source === 'graph_api' && (
                      <span className="text-xs px-2.5 py-1 rounded bg-[#f0f4ee] border border-[#d8e0d5] font-mono text-[#20372d]">
                        Official Graph API Insights
                      </span>
                    )}
                  </div>
                </div>

                {audience?.source === 'graph_api' && audience?.ageGender ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Age & Gender Distribution Chart */}
                    <div className="p-6 rounded-xl border border-[#e3e8e1] bg-white shadow-sm space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-[#1b3026]">Age & Gender Distribution</h4>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#285a49]" /> Male</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#66927d]" /> Female</span>
                        </div>
                      </div>
                      <div className="h-64 w-full pt-2">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={audience.ageGender} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef3ec" />
                            <XAxis dataKey="ageRange" stroke="#748379" fontSize={11} tickLine={false} />
                            <YAxis stroke="#748379" fontSize={11} tickLine={false} tickFormatter={(v) => `${v}%`} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e3e8e1', fontSize: '12px', color: '#1b3026' }}
                              formatter={(val: any, name: any) => [`${val}%`, name === 'male' ? 'Male' : name === 'female' ? 'Female' : 'Other']}
                            />
                            <Bar dataKey="male" name="male" fill="#285a49" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="female" name="female" fill="#66927d" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Top Countries & Cities Geography */}
                    <div className="p-6 rounded-xl border border-[#e3e8e1] bg-white shadow-sm space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-[#1b3026]">Follower Geography</h4>
                        <Globe className="w-4 h-4 text-[#285a49]" />
                      </div>

                      <div className="space-y-4 pt-1">
                        <div>
                          <span className="text-xs font-semibold text-[#1b3026] block mb-2">Top Countries</span>
                          <div className="space-y-2">
                            {(audience?.countries || []).map((c: any, i: number) => (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <span className="text-[#55635a]">{c.country}</span>
                                <div className="flex items-center gap-2">
                                  <div className="w-28 bg-[#f0f4ee] rounded-full h-2 overflow-hidden border border-[#e3e8e1]">
                                    <div className="bg-[#20372d] h-2 rounded-full" style={{ width: `${c.percentage}%` }} />
                                  </div>
                                  <span className="font-mono text-[#1b3026] w-8 text-right font-medium">{c.percentage}%</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="pt-3 border-t border-[#e3e8e1]">
                          <span className="text-xs font-semibold text-[#1b3026] block mb-2">Top Cities</span>
                          <div className="space-y-2">
                            {(audience?.cities || []).map((ct: any, i: number) => (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <span className="text-[#55635a]">{ct.city}</span>
                                <div className="flex items-center gap-2">
                                  <div className="w-28 bg-[#f0f4ee] rounded-full h-2 overflow-hidden border border-[#e3e8e1]">
                                    <div className="bg-[#285a49] h-2 rounded-full" style={{ width: `${ct.percentage}%` }} />
                                  </div>
                                  <span className="font-mono text-[#1b3026] w-8 text-right font-medium">{ct.percentage}%</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-12 text-center border border-dashed border-[#d8e0d5] rounded-xl bg-[#f0f4ee]/40 space-y-3">
                    <Globe className="w-10 h-10 text-[#748379] mx-auto opacity-50" />
                    <h4 className="text-sm font-semibold text-[#1b3026]">Demographic Insights Unavailable</h4>
                    <p className="text-xs text-[#55635a] max-w-md mx-auto leading-relaxed">
                      Age, gender, and follower geography require an official Meta Graph API connection with an Instagram Creator or Business account having at least 100 followers.
                    </p>
                    <div className="pt-2">
                      <button
                        onClick={() => setShowModal(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#20372d] border border-[#20372d] rounded-lg hover:bg-white hover:text-[#20372d] hover:border-[#20372d] transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
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
                <div className="p-6 rounded-xl border border-[#e3e8e1] bg-white shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-[#1b3026]">Competitive Analysis (FR-32)</h3>
                      <p className="text-xs text-[#748379]">
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
                        className="px-3 py-1.5 text-xs border border-[#d8e0d5] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#285a49] bg-white text-[#1b3026]"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs font-semibold bg-[#20372d] border border-[#20372d] text-white rounded-lg hover:bg-white hover:text-[#20372d] hover:border-[#20372d] transition-colors flex items-center gap-1 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </button>
                    </form>
                  </div>

                  {/* Competitor Pills */}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <span className="text-xs text-[#748379] font-medium">Comparing:</span>
                    {activeHandle && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#20372d] text-white border border-[#20372d]">
                        @{activeHandle} (You)
                      </span>
                    )}
                    {competitorList.map((handle) => (
                      <span
                        key={handle}
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#f0f4ee] text-[#20372d] border border-[#d8e0d5] flex items-center gap-1.5"
                      >
                        <span>@{handle}</span>
                        <button
                          type="button"
                          onClick={() => removeCompetitor(handle)}
                          className="hover:text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] rounded"
                          title={`Remove @${handle}`}
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
                    <Loader2 className="w-6 h-6 animate-spin text-[#285a49]" />
                    <p className="text-xs text-[#748379]">Benchmarking competitor profiles...</p>
                  </div>
                ) : competitors.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {competitors.map((comp) => {
                      const isMe = comp.handle?.toLowerCase() === activeHandle?.toLowerCase();
                      return (
                        <div
                          key={comp.handle}
                          className={`p-6 rounded-xl border bg-white shadow-sm hover:shadow-md transition-all duration-200 space-y-4 ${
                            isMe ? 'border-2 border-[#20372d] ring-4 ring-[#eef3ec]' : 'border-[#e3e8e1]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              {comp.avatarUrl ? (
                                <img src={comp.avatarUrl} alt={comp.handle} className="w-10 h-10 rounded-full object-cover border border-[#d8e0d5]" />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-[#f0f4ee] border border-[#d8e0d5] flex items-center justify-center font-bold text-[#1b3026] text-sm">
                                  {comp.handle.slice(0, 2).toUpperCase()}
                                </div>
                              )}
                              <div>
                                <h4 className="text-sm font-bold text-[#1b3026]">@{comp.handle}</h4>
                                <span className="text-[11px] text-[#748379] truncate block max-w-[150px]">{comp.fullName}</span>
                              </div>
                            </div>
                            {isMe && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#20372d] text-white uppercase tracking-wider">
                                Active Profile
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#e3e8e1] text-xs">
                            <div className="p-2.5 rounded-lg bg-[#f0f4ee] border border-[#e3e8e1]">
                              <span className="text-[#748379] block text-[11px]">Followers</span>
                              <span className="text-sm font-bold text-[#1b3026]">{formatCompactNumber(comp.followers)}</span>
                            </div>
                            <div className="p-2.5 rounded-lg bg-[#f0f4ee] border border-[#e3e8e1]">
                              <span className="text-[#748379] block text-[11px]">Avg Engagement</span>
                              <span className="text-sm font-bold text-[#285a49]">{comp.avgEngRate}%</span>
                            </div>
                            <div className="p-2.5 rounded-lg bg-[#f0f4ee] border border-[#e3e8e1]">
                              <span className="text-[#748379] block text-[11px]">Avg Likes / Post</span>
                              <span className="text-sm font-bold text-[#1b3026]">{formatCompactNumber(comp.avgLikes)}</span>
                            </div>
                            <div className="p-2.5 rounded-lg bg-[#f0f4ee] border border-[#e3e8e1]">
                              <span className="text-[#748379] block text-[11px]">Avg Comments</span>
                              <span className="text-sm font-bold text-[#1b3026]">{formatCompactNumber(comp.avgComments)}</span>
                            </div>
                          </div>

                          {/* Content format distribution */}
                          <div className="pt-2">
                            <span className="text-[11px] font-semibold text-[#55635a] block mb-1.5">Format Strategy</span>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="px-2 py-0.5 bg-[#f0f4ee] text-[#20372d] border border-[#d8e0d5] rounded font-medium flex items-center gap-1">
                                <Camera className="w-3 h-3 text-[#285a49]" /> {comp.formatDistribution?.image || 0} Images
                              </span>
                              <span className="px-2 py-0.5 bg-[#f0f4ee] text-[#20372d] border border-[#d8e0d5] rounded font-medium flex items-center gap-1">
                                <Layers className="w-3 h-3 text-[#285a49]" /> {comp.formatDistribution?.carousel || 0} Carousels
                              </span>
                              <span className="px-2 py-0.5 bg-[#f0f4ee] text-[#20372d] border border-[#d8e0d5] rounded font-medium flex items-center gap-1">
                                <Video className="w-3 h-3 text-[#285a49]" /> {comp.formatDistribution?.reel || comp.formatDistribution?.video || 0} Videos
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-12 text-center text-sm text-[#748379]">
                    No competitor data available. Add competitor handles above to compare.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Onboarding Popup Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1b3026]/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl border border-[#e3e8e1] space-y-6">
            {!isProcessing ? (
              <>
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-[#f0f4ee] border border-[#d8e0d5] text-[#1b3026] flex items-center justify-center mx-auto">
                    <Sparkles className="w-6 h-6 text-[#285a49]" />
                  </div>
                  <h3 className="text-xl font-bold text-[#1b3026]">Connect Your Social Account</h3>
                  <p className="text-xs text-[#748379]">
                    Choose how you want to ingest your Instagram account data.
                  </p>
                </div>

                {/* Connection Mode Selector: Handle vs Meta Graph API */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-[#f0f4ee] border border-[#e3e8e1] rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setConnectionMethod('handle');
                      setModalError(null);
                    }}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                      connectionMethod === 'handle'
                        ? 'bg-white text-[#1b3026] shadow-sm font-semibold'
                        : 'text-[#55635a] hover:text-[#1b3026]'
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
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                      connectionMethod === 'graph_api'
                        ? 'bg-white text-[#285a49] shadow-sm font-semibold'
                        : 'text-[#55635a] hover:text-[#1b3026]'
                    }`}
                  >
                    <Key className="w-3.5 h-3.5" />
                    Meta Graph API (Live)
                  </button>
                </div>

                {connectionMethod === 'handle' ? (
                  <form onSubmit={handleStartOnboarding} className="space-y-4">
                    {/* Platform toggle */}
                    <div className="grid grid-cols-2 gap-2 p-1 bg-[#f0f4ee] border border-[#e3e8e1] rounded-lg">
                      <button
                        type="button"
                        onClick={() => setPlatform('instagram')}
                        className={`flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                          platform === 'instagram'
                            ? 'bg-white text-[#1b3026] shadow-sm font-semibold'
                            : 'text-[#55635a] hover:text-[#1b3026]'
                        }`}
                      >
                        <Instagram className="w-3.5 h-3.5 text-[#285a49]" />
                        Instagram
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlatform('facebook')}
                        className={`flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                          platform === 'facebook'
                            ? 'bg-white text-[#1b3026] shadow-sm font-semibold'
                            : 'text-[#55635a] hover:text-[#1b3026]'
                        }`}
                      >
                        <Facebook className="w-3.5 h-3.5 text-[#347761]" />
                        Facebook
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#1b3026] mb-1">
                        {platform === 'instagram' ? 'Instagram Handle or Link' : 'Facebook Page or Link'}
                      </label>
                      <input
                        type="text"
                        placeholder={platform === 'instagram' ? 'e.g. @natgeo or profile link' : 'e.g. page name or link'}
                        value={accountInput}
                        onChange={(e) => setAccountInput(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-[#d8e0d5] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#285a49] bg-white text-[#1b3026]"
                        autoFocus
                      />
                    </div>

                    {modalError && (
                      <div className="p-3 text-xs rounded-lg bg-red-50 text-red-700 border border-red-200 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{modalError}</span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      {activeHandle && (
                        <button
                          type="button"
                          onClick={() => setShowModal(false)}
                          className="flex-1 py-2 text-xs font-medium border border-[#e3e8e1] rounded-lg hover:bg-[#f0f4ee] text-[#55635a] hover:text-[#1b3026] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="submit"
                        className="flex-1 py-2.5 text-xs font-semibold bg-[#20372d] border border-[#20372d] text-white rounded-lg hover:bg-white hover:text-[#20372d] hover:border-[#20372d] transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
                      >
                        Fetch & Analyze Data
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleConnectGraphApi} className="space-y-4">
                    <div className="p-3 rounded-lg bg-[#eef6eb] border border-[#cbe2c5] text-xs text-[#20372d] space-y-1">
                      <span className="font-semibold block text-[#1b3026]">Official Meta Graph API Ingestion</span>
                      <p className="text-[11px] text-[#55635a]">
                        Enter your Meta User / Page Access Token with <code className="bg-[#f0f4ee] px-1 rounded border border-[#d8e0d5]">instagram_basic</code> and <code className="bg-[#f0f4ee] px-1 rounded border border-[#d8e0d5]">pages_show_list</code> permissions. Data will be fetched directly from official Meta endpoints instead of web scraping.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#1b3026] mb-1">
                        Meta Graph API Access Token *
                      </label>
                      <textarea
                        rows={3}
                        placeholder="EAABw..."
                        value={graphTokenInput}
                        onChange={(e) => setGraphTokenInput(e.target.value)}
                        className="w-full px-3.5 py-2 text-xs font-mono border border-[#d8e0d5] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#285a49] bg-white text-[#1b3026]"
                        autoFocus
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#1b3026] mb-1">
                        Instagram Business Account ID (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="Leave blank to auto-detect from linked Facebook page"
                        value={graphAccountIdInput}
                        onChange={(e) => setGraphAccountIdInput(e.target.value)}
                        className="w-full px-3.5 py-2 text-xs border border-[#d8e0d5] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#285a49] bg-white text-[#1b3026]"
                      />
                    </div>

                    {modalError && (
                      <div className="p-3 text-xs rounded-lg bg-red-50 text-red-700 border border-red-200 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{modalError}</span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      {activeHandle && (
                        <button
                          type="button"
                          onClick={() => setShowModal(false)}
                          className="flex-1 py-2 text-xs font-medium border border-[#e3e8e1] rounded-lg hover:bg-[#f0f4ee] text-[#55635a] hover:text-[#1b3026] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="submit"
                        className="flex-1 py-2.5 text-xs font-semibold bg-[#20372d] border border-[#20372d] text-white rounded-lg hover:bg-white hover:text-[#20372d] hover:border-[#20372d] transition-colors shadow-sm flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
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
                  <div className="w-16 h-16 rounded-full border-4 border-[#e3e8e1] border-t-[#20372d] animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-[#285a49] animate-pulse" />
                  </div>
                </div>

                <div className="space-y-1">
                  <h4 className="text-base font-bold text-[#1b3026]">
                    {processStep === 'scraping' && 'Fetching Your Posts...'}
                    {processStep === 'analyzing_niche' && 'Detecting Content Style & Niche...'}
                    {processStep === 'training_model' && 'Personalizing Your Recommendations...'}
                    {processStep === 'completed' && 'Dashboard Ready!'}
                  </h4>
                  <p className="text-xs text-[#748379]">
                    {processStep === 'scraping' && 'Getting your photos, captions, likes & comments'}
                    {processStep === 'analyzing_niche' && 'Understanding your topic, language, and audience'}
                    {processStep === 'training_model' && 'Learning when your followers interact most'}
                    {processStep === 'completed' && 'Opening your overview...'}
                  </p>
                </div>

                {/* Progress Logs */}
                <div className="w-full bg-[#f0f4ee] border border-[#e3e8e1] rounded-lg p-3 text-left font-mono text-[11px] text-[#55635a] max-h-36 overflow-y-auto space-y-1">
                  {processLogs.map((log, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[#285a49] font-bold">✓</span>
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
