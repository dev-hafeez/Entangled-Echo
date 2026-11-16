'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import {
  TrendingUp,
  Sparkles,
  Clock,
  Video,
  Layers,
  Image as ImageIcon,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Flame,
  Globe,
  RefreshCw,
  Lightbulb,
  Calendar,
  AlertCircle,
  User,
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  Zap,
  Target,
  Tag,
  Hash,
  CheckSquare,
  BookOpen,
} from 'lucide-react';
import { api } from '@/lib/api';

export default function RecommendationsPage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [handle, setHandle] = useState<string>('');
  const [customHandleInput, setCustomHandleInput] = useState<string>('');
  const [isEditingHandle, setIsEditingHandle] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [reanalyzingNiche, setReanalyzingNiche] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recsData, setRecsData] = useState<any>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [expandedBlueprints, setExpandedBlueprints] = useState<Record<string, boolean>>({
    rec_1: true,
    rec_2: false,
    rec_3: false,
  });
  const [activeTab, setActiveTab] = useState<'all' | 'reels' | 'carousels' | 'posts'>('all');
  const [selectedCaptionStyles, setSelectedCaptionStyles] = useState<Record<string, number>>({});
  const [selectedHashtagBundles, setSelectedHashtagBundles] = useState<Record<string, 'all' | 'niche' | 'broad' | 'trending'>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  // Initialize handle dynamically based on authenticated user session or active handle
  useEffect(() => {
    let resolved = '';
    if (typeof window !== 'undefined') {
      resolved = localStorage.getItem('ee_active_handle') || '';
    }

    if (isLoaded && user) {
      api.getUserProfile(user.id).then((userProfile) => {
        if (userProfile?.profile?.handle) {
          const userHandle = userProfile.profile.handle;
          setHandle(userHandle);
          setCustomHandleInput(userHandle);
          fetchRecommendations(userHandle);
        } else {
          const stored = localStorage.getItem(`ee_handle_${user.id}`) || resolved;
          if (stored) {
            setHandle(stored);
            setCustomHandleInput(stored);
            fetchRecommendations(stored);
          } else {
            setLoading(false);
          }
        }
      }).catch(() => {
        if (resolved) {
          setHandle(resolved);
          setCustomHandleInput(resolved);
          fetchRecommendations(resolved);
        } else {
          setLoading(false);
        }
      });
    } else if (resolved) {
      setHandle(resolved);
      setCustomHandleInput(resolved);
      fetchRecommendations(resolved);
    }
  }, [isLoaded, user]);

  const fetchRecommendations = async (targetHandle: string, forceRefresh: boolean = false) => {
    const clean = targetHandle.trim().toLowerCase().replace(/^@/, '');
    if (!clean) return;

    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await api.generateRecommendations(clean, 'instagram', forceRefresh);
      if (data?.recommendations && data.recommendations.length > 0) {
        setRecsData(data);
      } else {
        setRecsData(null);
        setErrorMessage('No recommendation data returned for this creator.');
      }
    } catch (err: any) {
      console.error('Failed to load recommendations:', err);
      setErrorMessage(err.message || 'Failed to load recommendations.');
      setRecsData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectHandle = (newHandle: string) => {
    setHandle(newHandle);
    setCustomHandleInput(newHandle);
    setIsEditingHandle(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem('ee_active_handle', newHandle);
      if (user?.id) {
        localStorage.setItem(`ee_handle_${user.id}`, newHandle);
      }
    }
    fetchRecommendations(newHandle);
  };

  const handleCustomHandleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customHandleInput.trim().toLowerCase().replace(/^@/, '');
    if (clean) {
      handleSelectHandle(clean);
    }
  };

  const handleReanalyzeNiche = async () => {
    if (!handle) return;
    setReanalyzingNiche(true);
    setErrorMessage(null);
    try {
      await api.analyzeNiche(handle);
      await fetchRecommendations(handle, true);
      setFeedbackToast('Niche & caption intelligence updated.');
      setTimeout(() => setFeedbackToast(null), 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to re-analyze niche.');
    } finally {
      setReanalyzingNiche(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyTag = (tag: string) => {
    navigator.clipboard.writeText(tag);
    setCopiedTag(tag);
    setFeedbackToast(`Copied ${tag}`);
    setTimeout(() => {
      setCopiedTag(null);
      setFeedbackToast(null);
    }, 1500);
  };

  const toggleBlueprint = (id: string) => {
    setExpandedBlueprints((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const getActiveCaption = (rec: any): { style: string; hook: string; text: string } => {
    const idx = selectedCaptionStyles[rec.id] ?? 0;
    if (Array.isArray(rec.caption_options) && rec.caption_options.length > idx) {
      return rec.caption_options[idx];
    }
    return {
      style: 'Primary Draft',
      hook: '',
      text: rec.caption_draft || '',
    };
  };

  const getActiveHashtags = (rec: any, bundleKey?: string): string[] => {
    const key = bundleKey || (selectedHashtagBundles[rec.id] ?? 'all');
    const bundles = rec.hashtag_bundles || {};

    if (key === 'niche' && Array.isArray(bundles.niche) && bundles.niche.length > 0) {
      return bundles.niche;
    }
    if (key === 'broad' && Array.isArray(bundles.broad) && bundles.broad.length > 0) {
      return bundles.broad;
    }
    if (key === 'trending' && Array.isArray(bundles.trending) && bundles.trending.length > 0) {
      return bundles.trending;
    }
    if (Array.isArray(rec.suggested_hashtags) && rec.suggested_hashtags.length > 0) {
      return rec.suggested_hashtags;
    }
    const combined = [...(bundles.niche || []), ...(bundles.broad || []), ...(bundles.trending || [])];
    return Array.from(new Set(combined));
  };

  const handleSchedulePost = (rec: any) => {
    const activeCaption = getActiveCaption(rec);
    const activeTags = getActiveHashtags(rec);

    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'ee_pending_schedule',
        JSON.stringify({
          handle,
          caption: activeCaption.text,
          hashtags: activeTags,
          mediaType: rec.recommended_format === 'reel' ? 'video' : rec.recommended_format,
        })
      );
    }
    router.push('/calendar');
  };

  const handleFeedback = async (rec: any, accepted: boolean) => {
    try {
      setFeedbackMap((prev) => ({ ...prev, [rec.id]: accepted ? 'accepted' : 'rejected' }));
      await api.submitRecommendationFeedback({
        handle,
        recommendationId: rec.id,
        accepted,
        mediaType: rec.recommended_format,
        topic: rec.trend_topic || rec.title,
      });
      setFeedbackToast(
        accepted
          ? `Feedback saved: Increased preference for ${rec.recommended_format.toUpperCase()}.`
          : `Feedback saved: Topics related to "${rec.trend_topic || rec.title}" will be downranked.`
      );
      setTimeout(() => setFeedbackToast(null), 3000);
    } catch (err) {
      console.warn('Feedback submission failed:', err);
    }
  };

  const formatIcon = (fmt: string) => {
    switch (fmt?.toLowerCase()) {
      case 'reel':
      case 'video':
        return <Video className="w-3.5 h-3.5 text-neutral-800" />;
      case 'carousel':
        return <Layers className="w-3.5 h-3.5 text-neutral-800" />;
      default:
        return <ImageIcon className="w-3.5 h-3.5 text-neutral-800" />;
    }
  };

  const filteredRecs =
    recsData?.recommendations?.filter((r: any) => {
      if (activeTab === 'reels') return r.recommended_format === 'reel' || r.recommended_format === 'video';
      if (activeTab === 'carousels') return r.recommended_format === 'carousel';
      if (activeTab === 'posts') return r.recommended_format === 'image';
      return true;
    }) || [];

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      {/* Toast Notification */}
      {feedbackToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-black text-white px-4 py-2.5 rounded-md shadow-lg flex items-center gap-2.5 border border-neutral-800">
          <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
          <span className="text-xs font-medium">{feedbackToast}</span>
        </div>
      )}

      {/* Top Header & Account Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-neutral-700 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200">
              Content Strategy
            </span>
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 mt-1.5 tracking-tight">
            Recommendations
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-2xl">
            Real-time search trends correlated with your verified niche, with multi-style captions, hashtag bundles, and production blueprints.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Creator Account Selector */}
          {isEditingHandle ? (
            <form onSubmit={handleCustomHandleSubmit} className="flex items-center gap-1.5">
              <input
                type="text"
                value={customHandleInput}
                onChange={(e) => setCustomHandleInput(e.target.value)}
                placeholder="handle"
                className="px-2.5 py-1 text-xs rounded border border-neutral-300 focus:outline-none focus:border-black text-neutral-900 w-32"
                autoFocus
              />
              <button
                type="submit"
                className="px-2.5 py-1 text-xs font-semibold bg-black text-white rounded hover:bg-neutral-800 transition"
              >
                Go
              </button>
              <button
                type="button"
                onClick={() => setIsEditingHandle(false)}
                className="px-2 py-1 text-xs text-neutral-500 hover:text-neutral-800"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 px-3 py-1.5 rounded-md text-xs text-neutral-800">
              <User className="w-3.5 h-3.5 text-neutral-400" />
              <span className="font-mono font-medium">@{handle || 'creator'}</span>
              <button
                onClick={() => setIsEditingHandle(true)}
                className="text-[11px] text-neutral-600 hover:text-black underline font-medium ml-1"
                title="Change Creator Account"
              >
                Switch
              </button>
            </div>
          )}

          <button
            onClick={() => handle && fetchRecommendations(handle, true)}
            disabled={loading || reanalyzingNiche}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-black bg-white text-black hover:bg-black hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Trends
          </button>

          <button
            onClick={handleReanalyzeNiche}
            disabled={loading || reanalyzingNiche}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-black text-white hover:bg-neutral-800 transition disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${reanalyzingNiche ? 'animate-spin' : ''}`} />
            {reanalyzingNiche ? 'Analyzing Niche...' : 'Re-Analyze Niche'}
          </button>

          <Link
            href="/calendar"
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-neutral-300 text-neutral-700 hover:border-black hover:text-black transition"
          >
            Calendar
          </Link>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-3.5 rounded-md border border-neutral-300 bg-neutral-50 text-neutral-900 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs">
            <AlertCircle className="w-4 h-4 text-neutral-700 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => handle && fetchRecommendations(handle, true)}
            className="px-3 py-1 bg-black text-white rounded text-xs font-medium hover:bg-neutral-800 transition shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center space-y-3">
          <div className="w-8 h-8 border-2 border-neutral-300 border-t-black rounded-full animate-spin" />
          <div className="text-center space-y-1">
            <p className="text-xs font-semibold text-neutral-900">
              Correlating real-time search trends with verified niche...
            </p>
            <p className="text-[11px] text-neutral-500 font-mono">
              Generating variations and blueprints for @{handle}
            </p>
          </div>
        </div>
      ) : recsData ? (
        <>
          {/* Creator Niche Ground Truth Intelligence Bar */}
          <div className="p-5 rounded-lg border border-neutral-200 bg-white space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-neutral-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-neutral-900 text-white flex items-center justify-center font-bold text-sm">
                  {handle.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-neutral-900 text-sm font-mono">@{handle}</span>
                    <span className="text-[11px] font-medium text-neutral-800 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200">
                      {recsData?.user_niche || 'Digital Creator'}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Sub-Niche: <span className="font-medium text-neutral-800">{recsData?.sub_niche || 'General'}</span> • Follower Tier: <span className="font-medium text-neutral-800">{recsData?.follower_tier || 'Creator'}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-neutral-800 bg-neutral-50 border border-neutral-200 px-2.5 py-1 rounded">
                  <TrendingUp className="w-3.5 h-3.5 text-neutral-700" />
                  <span>Format: <strong className="capitalize">{recsData?.dominant_format_recommendation || 'Reels'}</strong></span>
                </div>
                <div className="flex items-center gap-1.5 text-neutral-800 bg-neutral-50 border border-neutral-200 px-2.5 py-1 rounded">
                  <Clock className="w-3.5 h-3.5 text-neutral-700" />
                  <span>Window: <strong>{recsData?.optimal_time_window || '5:00 PM - 7:00 PM'}</strong></span>
                </div>
                <div className="flex items-center gap-1.5 text-neutral-800 bg-neutral-50 border border-neutral-200 px-2.5 py-1 rounded">
                  <Globe className="w-3.5 h-3.5 text-neutral-700" />
                  <span>Language: <strong>{recsData?.language_preference || 'English'}</strong></span>
                </div>
              </div>
            </div>

            {/* Content Pillars & Keywords */}
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
              <span className="font-semibold text-neutral-500 flex items-center gap-1">
                <Target className="w-3.5 h-3.5 text-neutral-400" />
                Pillars:
              </span>
              {(recsData?.content_pillars || ['Core Expertise', 'Behind The Scenes', 'Industry Guidance']).map(
                (p: string, i: number) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 bg-neutral-100 text-neutral-800 font-medium rounded border border-neutral-200"
                  >
                    {p}
                  </span>
                )
              )}

              {recsData?.keywords && recsData.keywords.length > 0 && (
                <>
                  <span className="text-neutral-300 mx-1">|</span>
                  <span className="font-semibold text-neutral-500 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5 text-neutral-400" />
                    Keywords:
                  </span>
                  {recsData.keywords.slice(0, 5).map((kw: string, i: number) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-neutral-50 text-neutral-700 rounded border border-neutral-200 text-[11px] font-mono"
                    >
                      {kw}
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Live Search Trends Bar */}
          {recsData?.live_trend_signals && recsData.live_trend_signals.length > 0 && (
            <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg flex flex-col md:flex-row md:items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-neutral-900 shrink-0">
                <Flame className="w-3.5 h-3.5 text-neutral-700" />
                <span>Live Search Trends:</span>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto py-0.5 no-scrollbar">
                {recsData.live_trend_signals.map((trend: any, idx: number) => {
                  const title = typeof trend === 'string' ? trend : trend.title;
                  const traffic = typeof trend === 'object' ? trend.traffic : null;
                  return (
                    <span
                      key={idx}
                      className="bg-white border border-neutral-200 text-neutral-800 font-medium px-2.5 py-1 rounded shrink-0 flex items-center gap-1.5 text-[11px]"
                    >
                      <span className="font-mono font-bold text-neutral-900">#{idx + 1}</span>
                      <span>{title}</span>
                      {traffic && (
                        <span className="text-[10px] text-neutral-500 font-mono">
                          {traffic}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Format Filter Tabs */}
          <div className="flex items-center justify-between gap-4 border-b border-neutral-200 pb-2">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 text-xs font-semibold rounded transition ${
                  activeTab === 'all'
                    ? 'bg-black text-white'
                    : 'text-neutral-600 hover:text-black hover:bg-neutral-100'
                }`}
              >
                All Opportunities ({recsData?.recommendations?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('reels')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition ${
                  activeTab === 'reels'
                    ? 'bg-black text-white'
                    : 'text-neutral-600 hover:text-black hover:bg-neutral-100'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                Reels
              </button>
              <button
                onClick={() => setActiveTab('carousels')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition ${
                  activeTab === 'carousels'
                    ? 'bg-black text-white'
                    : 'text-neutral-600 hover:text-black hover:bg-neutral-100'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Carousels
              </button>
              <button
                onClick={() => setActiveTab('posts')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition ${
                  activeTab === 'posts'
                    ? 'bg-black text-white'
                    : 'text-neutral-600 hover:text-black hover:bg-neutral-100'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Static Posts
              </button>
            </div>

            <div className="text-xs text-neutral-500 font-mono hidden sm:block">
              Calibrated for @{handle}
            </div>
          </div>

          {/* 3-Column Recommendations Grid */}
          {filteredRecs.length === 0 ? (
            <div className="py-12 text-center space-y-2 border border-dashed border-neutral-200 rounded-lg bg-neutral-50/50">
              <p className="text-xs font-semibold text-neutral-700">No recommendations found for this format filter.</p>
              <button
                onClick={() => setActiveTab('all')}
                className="text-xs text-neutral-900 underline font-medium"
              >
                View all format opportunities
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              {filteredRecs.map((rec: any, idx: number) => {
                const isExpanded = expandedBlueprints[rec.id] ?? false;
                const userFeedback = feedbackMap[rec.id];

                // Caption Varieties
                const captionOptions = Array.isArray(rec.caption_options) && rec.caption_options.length > 0
                  ? rec.caption_options
                  : [{ style: 'Primary Draft', hook: '', text: rec.caption_draft || '' }];
                const activeStyleIdx = selectedCaptionStyles[rec.id] ?? 0;
                const activeCaption = captionOptions[activeStyleIdx] || captionOptions[0];

                // Hashtag Varieties & Bundles
                const activeBundleKey = selectedHashtagBundles[rec.id] ?? 'all';
                const activeTags = getActiveHashtags(rec, activeBundleKey);

                return (
                  <div
                    key={rec.id || idx}
                    className="rounded-lg border border-neutral-200 bg-white flex flex-col justify-between overflow-hidden hover:border-neutral-400 transition"
                  >
                    <div className="p-5 space-y-4">
                      {/* Top Opportunity Header */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-800 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200">
                            Opportunity #{idx + 1}
                          </span>
                          <span className="text-[10px] font-mono font-semibold text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-300">
                            {rec.niche_match_score || 95}% Match
                          </span>
                        </div>

                        {/* Format & Lift Pill */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded flex items-center gap-1.5 capitalize">
                            {formatIcon(rec.recommended_format)}
                            {rec.recommended_format}
                          </span>
                          <span className="text-xs font-mono text-neutral-700 bg-neutral-50 px-2 py-0.5 rounded border border-neutral-200">
                            {rec.format_lift}
                          </span>
                        </div>

                        {/* Title */}
                        <h3 className="text-sm font-bold text-neutral-900 leading-snug">
                          {rec.title}
                        </h3>

                        {/* Trend Context */}
                        <div className="text-xs text-neutral-700 bg-neutral-50 border border-neutral-200 rounded p-2.5 space-y-1">
                          <div className="flex items-center gap-1.5 font-semibold text-neutral-900">
                            <Flame className="w-3.5 h-3.5 text-neutral-700 shrink-0" />
                            <span>Trend: {rec.trend_topic}</span>
                          </div>
                          {rec.trend_news_context && (
                            <p className="text-[11px] text-neutral-600 line-clamp-2 leading-relaxed">
                              {rec.trend_news_context}
                            </p>
                          )}
                          <div className="text-[10px] text-neutral-400 font-mono">
                            {rec.trend_source} • {rec.trend_traffic || 'Trending'}
                          </div>
                        </div>

                        {/* Rationale */}
                        <div className="text-xs text-neutral-700 leading-relaxed bg-neutral-50 border-l-2 border-neutral-900 p-2.5">
                          <strong className="text-neutral-900 block mb-0.5">Why This Fits Your Niche:</strong>
                          {rec.rationale}
                        </div>
                      </div>

                      {/* Next Steps Checklist */}
                      <div className="space-y-2 pt-2 border-t border-neutral-100">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-900 uppercase tracking-wider">
                          <CheckSquare className="w-3.5 h-3.5 text-neutral-700" />
                          <span>Actionable Next Steps</span>
                        </div>
                        <div className="space-y-1.5">
                          {(rec.next_steps || [
                            `Step 1: Hook & Concept - Craft a compelling 5-second opening for ${rec.title}.`,
                            `Step 2: Scripting & Visuals - Break down 3 key takeaways with high-contrast text overlays.`,
                            `Step 3: Call to Action - Ask audience for their reaction and pin your clarifying comment.`,
                          ]).map((step: string, sIdx: number) => (
                            <div
                              key={sIdx}
                              className="text-xs text-neutral-700 bg-neutral-50 border border-neutral-200 rounded p-2 leading-relaxed flex items-start gap-2"
                            >
                              <span className="w-4 h-4 rounded bg-neutral-200 text-neutral-800 font-mono font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                                {sIdx + 1}
                              </span>
                              <span>{step}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Creation Blueprint Toggle */}
                      {rec.creation_blueprint && (
                        <div className="pt-2 border-t border-neutral-100">
                          <button
                            onClick={() => toggleBlueprint(rec.id)}
                            className="w-full flex items-center justify-between text-xs font-bold text-neutral-800 hover:text-black py-1 transition"
                          >
                            <span className="flex items-center gap-1.5">
                              <Lightbulb className="w-3.5 h-3.5 text-neutral-700" />
                              {isExpanded ? 'Hide Production Blueprint' : 'View Production Blueprint'}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5 text-neutral-500" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
                            )}
                          </button>

                          {isExpanded && (
                            <div className="mt-2.5 p-3.5 rounded bg-neutral-900 text-neutral-100 space-y-3 text-xs">
                              <div className="space-y-1">
                                <span className="font-mono text-neutral-400 block uppercase text-[10px] tracking-wider">
                                  1. Hook (First 3s)
                                </span>
                                <p className="text-neutral-200 leading-relaxed text-[11px]">
                                  {rec.creation_blueprint.hook}
                                </p>
                              </div>

                              <div className="space-y-1">
                                <span className="font-mono text-neutral-400 block uppercase text-[10px] tracking-wider">
                                  2. Value Delivery Body
                                </span>
                                <p className="text-neutral-200 leading-relaxed text-[11px] whitespace-pre-line">
                                  {rec.creation_blueprint.body}
                                </p>
                              </div>

                              <div className="space-y-1">
                                <span className="font-mono text-neutral-400 block uppercase text-[10px] tracking-wider">
                                  3. Call To Action
                                </span>
                                <p className="text-neutral-200 leading-relaxed text-[11px]">
                                  {rec.creation_blueprint.call_to_action}
                                </p>
                              </div>

                              {rec.creation_blueprint.production_tips && (
                                <div className="pt-2 border-t border-neutral-800 space-y-1">
                                  <span className="font-mono text-neutral-400 block uppercase text-[10px] tracking-wider">
                                    Production Tips
                                  </span>
                                  <ul className="space-y-1 text-neutral-300 text-[11px]">
                                    {rec.creation_blueprint.production_tips.map((tip: string, tIdx: number) => (
                                      <li key={tIdx} className="flex items-start gap-1.5">
                                        <span className="text-neutral-400">•</span>
                                        <span>{tip}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Ready-to-Post Multi-Style Caption & Hashtag Strategy Section */}
                      <div className="space-y-3 pt-3 border-t border-neutral-100">
                        {/* Caption Variety Header & Style Selector */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-neutral-700" />
                              Caption Variations ({captionOptions.length})
                            </span>
                            <span className="text-[10px] font-mono text-neutral-700 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200">
                              {activeCaption.style}
                            </span>
                          </div>

                          {/* Style Tabs */}
                          <div className="grid grid-cols-3 gap-1 bg-neutral-100 p-1 rounded">
                            {captionOptions.map((opt: any, optIdx: number) => {
                              const isSelected = activeStyleIdx === optIdx;
                              const icon =
                                optIdx === 0 ? (
                                  <BookOpen className="w-3 h-3" />
                                ) : optIdx === 1 ? (
                                  <Zap className="w-3 h-3" />
                                ) : (
                                  <Target className="w-3 h-3" />
                                );
                              return (
                                <button
                                  key={optIdx}
                                  onClick={() =>
                                    setSelectedCaptionStyles((prev) => ({
                                      ...prev,
                                      [rec.id]: optIdx,
                                    }))
                                  }
                                  className={`py-1 px-1.5 text-[11px] font-medium rounded transition flex items-center justify-center gap-1 ${
                                    isSelected
                                      ? 'bg-white text-neutral-900 border border-neutral-300 font-bold'
                                      : 'text-neutral-600 hover:text-neutral-900'
                                  }`}
                                >
                                  {icon}
                                  <span className="truncate">{opt.style.split(' ')[0]}</span>
                                </button>
                              );
                            })}
                          </div>

                          {/* Opening Hook Angle Badge */}
                          {activeCaption.hook && (
                            <div className="text-[11px] text-neutral-800 bg-neutral-50 border border-neutral-200 rounded p-2 leading-snug flex items-start gap-1.5">
                              <div className="flex-1">
                                <strong className="font-semibold text-neutral-900">Hook:</strong>{' '}
                                <span>"{activeCaption.hook}"</span>
                              </div>
                            </div>
                          )}

                          {/* Caption Preview Box */}
                          <div className="relative group">
                            <div className="p-3 rounded bg-neutral-50 border border-neutral-200 text-xs text-neutral-900 leading-relaxed font-normal max-h-36 overflow-y-auto whitespace-pre-wrap select-text">
                              {activeCaption.text}
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-1 px-1 font-mono">
                              <span>
                                {activeCaption.text.length} chars
                              </span>
                              <button
                                onClick={() => handleCopy(activeCaption.text, `cap_only_${rec.id}`)}
                                className="text-neutral-700 hover:text-black underline font-sans"
                              >
                                {copiedId === `cap_only_${rec.id}` ? 'Copied' : 'Copy text'}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Hashtag Strategy Variety & Categorized Bundles */}
                        <div className="space-y-2 pt-2 border-t border-neutral-100">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
                              <Hash className="w-3.5 h-3.5 text-neutral-700" />
                              Hashtag Strategy
                            </span>
                            <button
                              onClick={() => {
                                const tagStr = activeTags.join(' ');
                                handleCopy(tagStr, `tags_${rec.id}`);
                              }}
                              className="text-[11px] font-medium text-neutral-700 hover:text-black underline flex items-center gap-1"
                            >
                              {copiedId === `tags_${rec.id}` ? (
                                <>
                                  <Check className="w-3 h-3 text-neutral-900" />
                                  <span className="text-neutral-900 font-semibold">Copied!</span>
                                </>
                              ) : (
                                <span>Copy Tags ({activeTags.length})</span>
                              )}
                            </button>
                          </div>

                          {/* Strategy Bundle Tabs */}
                          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
                            {[
                              { key: 'all', label: `All (${(rec.suggested_hashtags || []).length || 10})` },
                              { key: 'niche', label: `Niche (${rec.hashtag_bundles?.niche?.length || 5})` },
                              { key: 'broad', label: `Reach (${rec.hashtag_bundles?.broad?.length || 5})` },
                              { key: 'trending', label: `Trending (${rec.hashtag_bundles?.trending?.length || 5})` },
                            ].map((b) => {
                              const isSelected = activeBundleKey === b.key;
                              return (
                                <button
                                  key={b.key}
                                  onClick={() =>
                                    setSelectedHashtagBundles((prev) => ({
                                      ...prev,
                                      [rec.id]: b.key as any,
                                    }))
                                  }
                                  className={`px-2 py-0.5 text-[11px] rounded transition whitespace-nowrap font-medium ${
                                    isSelected
                                      ? 'bg-black text-white font-bold'
                                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                                  }`}
                                >
                                  {b.label}
                                </button>
                              );
                            })}
                          </div>

                          {/* Hashtag Chips with Individual Click-to-Copy */}
                          <div className="flex flex-wrap items-center gap-1 pt-0.5">
                            {activeTags.map((tag: string, tIdx: number) => {
                              const isCopied = copiedTag === tag;
                              return (
                                <button
                                  key={tIdx}
                                  onClick={() => handleCopyTag(tag)}
                                  title="Click to copy this hashtag"
                                  className={`text-[11px] font-mono px-1.5 py-0.5 rounded transition border flex items-center gap-1 cursor-pointer ${
                                    isCopied
                                      ? 'bg-neutral-900 text-white border-neutral-900 font-bold'
                                      : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:border-black'
                                  }`}
                                >
                                  {isCopied ? <Check className="w-2.5 h-2.5 text-white" /> : null}
                                  <span>{tag}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Master 1-Click Copy Bar */}
                        <div className="pt-2">
                          <button
                            onClick={() => {
                              const fullText = `${activeCaption.text}\n\n${activeTags.join(' ')}`;
                              handleCopy(fullText, `cap_${rec.id}`);
                            }}
                            className="w-full py-2 px-3 border border-black bg-white text-black hover:bg-black hover:text-white transition rounded text-xs font-semibold flex items-center justify-center gap-2"
                          >
                            {copiedId === `cap_${rec.id}` ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Copied Caption & Hashtags!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy {activeCaption.style.split(' ')[0]} Caption + {activeTags.length} Hashtags</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Card Action Footer */}
                    <div className="p-3.5 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleFeedback(rec, true)}
                          title="Helpful recommendation"
                          className={`p-1.5 rounded border transition text-xs flex items-center gap-1 ${
                            userFeedback === 'accepted'
                              ? 'bg-neutral-900 border-neutral-900 text-white font-bold'
                              : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                          }`}
                        >
                          <ThumbsUp className="w-3 h-3" />
                          <span className="text-[11px]">Helpful</span>
                        </button>
                        <button
                          onClick={() => handleFeedback(rec, false)}
                          title="Not relevant to niche"
                          className={`p-1.5 rounded border transition text-xs flex items-center gap-1 ${
                            userFeedback === 'rejected'
                              ? 'bg-neutral-900 border-neutral-900 text-white font-bold'
                              : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                          }`}
                        >
                          <ThumbsDown className="w-3 h-3" />
                          <span className="text-[11px]">Downrank</span>
                        </button>
                      </div>

                      <button
                        onClick={() => handleSchedulePost(rec)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-black hover:bg-neutral-800 rounded transition flex items-center gap-1.5"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Schedule Post</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="py-16 text-center space-y-3 border border-neutral-200 rounded-lg bg-white p-8">
          <p className="text-sm font-semibold text-neutral-800">
            No recommendations loaded for @{handle}
          </p>
          <p className="text-xs text-neutral-500 max-w-md mx-auto">
            Click below or enter your Instagram handle above to generate live content blueprints.
          </p>
          {handle && (
            <button
              onClick={() => fetchRecommendations(handle, true)}
              className="px-4 py-2 border border-black bg-white text-black hover:bg-black hover:text-white rounded text-xs font-semibold transition"
            >
              Generate Recommendations for @{handle}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
