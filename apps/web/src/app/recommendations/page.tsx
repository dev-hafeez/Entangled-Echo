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
  Compass,
  Lightbulb,
  Calendar,
  AlertCircle,
  User,
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  ArrowRight,
  Zap,
  Target,
  Tag,
  Hash,
  CheckSquare,
  BookOpen,
} from 'lucide-react';
import { api } from '@/lib/api';

const POPULAR_HANDLES = ['tahirabbas_ca', '100xengineers', 'nightcreeper24', 'cristiano', 'leomessi'];

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

  // Initialize handle on mount
  useEffect(() => {
    let initial = 'tahirabbas_ca';
    if (typeof window !== 'undefined') {
      initial = localStorage.getItem('ee_active_handle') || 'tahirabbas_ca';
    }
    setHandle(initial);
    setCustomHandleInput(initial);
    fetchRecommendations(initial);
  }, []);

  // Update with authenticated user handle if available
  useEffect(() => {
    if (!isLoaded || !user) return;

    const checkUserProfile = async () => {
      try {
        const userProfile = await api.getUserProfile(user.id).catch(() => null);
        if (userProfile?.profile?.handle) {
          const userHandle = userProfile.profile.handle;
          setHandle(userHandle);
          setCustomHandleInput(userHandle);
          fetchRecommendations(userHandle);
        } else {
          const stored = localStorage.getItem(`ee_handle_${user.id}`);
          if (stored) {
            setHandle(stored);
            setCustomHandleInput(stored);
            fetchRecommendations(stored);
          }
        }
      } catch {}
    };

    checkUserProfile();
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
      setFeedbackToast('Niche & caption intelligence successfully updated by Gemini AI!');
      setTimeout(() => setFeedbackToast(null), 3500);
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
    setFeedbackToast(`Copied ${tag} to clipboard!`);
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

  // Helper to extract the active caption option for a recommendation
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

  // Helper to extract active hashtags based on selected bundle strategy
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
    // 'all'
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
          ? `Feedback saved! Format preference for ${rec.recommended_format.toUpperCase()} increased.`
          : `Feedback saved! Topics related to "${rec.trend_topic || rec.title}" will be downranked.`
      );
      setTimeout(() => setFeedbackToast(null), 3500);
    } catch (err) {
      console.warn('Feedback submission failed:', err);
    }
  };

  const formatIcon = (fmt: string) => {
    switch (fmt?.toLowerCase()) {
      case 'reel':
      case 'video':
        return <Video className="w-4 h-4 text-purple-600" />;
      case 'carousel':
        return <Layers className="w-4 h-4 text-blue-600" />;
      default:
        return <ImageIcon className="w-4 h-4 text-emerald-600" />;
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
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      {/* Toast Notification */}
      {feedbackToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-slate-700 animate-in fade-in slide-in-from-bottom-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-medium">{feedbackToast}</span>
        </div>
      )}

      {/* Top Header & Account Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200 flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-purple-600" />
              Real-Time Trends & Gemini Niche Matcher
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">
            AI Content Recommendations
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl leading-relaxed">
            Real-time search trends correlated against your verified niche, with multi-style caption variations, categorized hashtag bundles, next steps, and production blueprints.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Creator Account Selector */}
          {isEditingHandle ? (
            <form onSubmit={handleCustomHandleSubmit} className="flex items-center gap-1.5">
              <input
                type="text"
                value={customHandleInput}
                onChange={(e) => setCustomHandleInput(e.target.value)}
                placeholder="instagram_handle"
                className="px-3 py-1.5 text-xs rounded-lg border border-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-800 w-36"
                autoFocus
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-black transition"
              >
                Go
              </button>
              <button
                type="button"
                onClick={() => setIsEditingHandle(false)}
                className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full text-xs font-semibold text-slate-700 shadow-2xs">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>@{handle || 'creator'}</span>
              <button
                onClick={() => setIsEditingHandle(true)}
                className="text-[11px] text-purple-600 hover:text-purple-800 underline font-medium ml-1"
                title="Change Creator Account"
              >
                Switch
              </button>
            </div>
          )}

          <button
            onClick={() => handle && fetchRecommendations(handle, true)}
            disabled={loading || reanalyzingNiche}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition shadow-2xs disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Trends
          </button>

          <button
            onClick={handleReanalyzeNiche}
            disabled={loading || reanalyzingNiche}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:text-purple-900 bg-purple-50 border border-purple-200 hover:bg-purple-100 rounded-lg transition shadow-2xs disabled:opacity-60"
          >
            <Sparkles className={`w-3.5 h-3.5 ${reanalyzingNiche ? 'animate-spin' : ''}`} />
            {reanalyzingNiche ? 'Analyzing Niche...' : 'Re-Analyze Niche with AI'}
          </button>

          <Link
            href="/calendar"
            className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-50 transition"
          >
            Calendar
          </Link>
        </div>
      </div>

      {/* Account Quick Switch Bar */}
      <div className="flex items-center gap-2 overflow-x-auto text-xs pb-1 no-scrollbar">
        <span className="text-slate-500 font-medium shrink-0">Sample Accounts:</span>
        {POPULAR_HANDLES.map((h) => (
          <button
            key={h}
            onClick={() => handleSelectHandle(h)}
            className={`px-2.5 py-1 rounded-md transition font-medium shrink-0 ${
              handle === h
                ? 'bg-slate-900 text-white font-semibold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            @{h}
          </button>
        ))}
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 flex items-center justify-between gap-4 animate-in fade-in">
          <div className="flex items-center gap-2.5 text-sm">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => handle && fetchRecommendations(handle, true)}
            className="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center space-y-4">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-purple-600 rounded-full animate-spin" />
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-slate-800">
              Correlating real-time Google search trends with your verified niche...
            </p>
            <p className="text-xs text-slate-500">
              Generating caption styles, hashtag strategy bundles, and blueprints for @{handle}
            </p>
          </div>
        </div>
      ) : recsData ? (
        <>
          {/* Creator Niche Ground Truth Intelligence Bar */}
          <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                  {handle.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-base">@{handle}</span>
                    <span className="text-[11px] font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                      {recsData?.user_niche || 'Digital Creator'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Sub-Niche: <span className="font-medium text-slate-700">{recsData?.sub_niche || 'Core Industry'}</span> • Follower Tier: <span className="font-medium text-slate-700">{recsData?.follower_tier || 'Micro-Influencer'}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5 text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
                  <TrendingUp className="w-3.5 h-3.5 text-purple-600" />
                  <span>Best Format: <strong className="capitalize">{recsData?.dominant_format_recommendation || 'Reels'}</strong></span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span>Optimal Slot: <strong>{recsData?.optimal_time_window || '5:00 PM - 7:00 PM (UTC)'}</strong></span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
                  <Globe className="w-3.5 h-3.5 text-blue-600" />
                  <span>Language: <strong>{recsData?.language_preference || 'English'}</strong></span>
                </div>
              </div>
            </div>

            {/* Content Pillars & Keywords */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="font-semibold text-slate-500 flex items-center gap-1">
                <Target className="w-3.5 h-3.5 text-slate-400" />
                Content Pillars:
              </span>
              {(recsData?.content_pillars || ['Core Expertise', 'Behind The Scenes', 'Industry Guidance']).map(
                (p: string, i: number) => (
                  <span
                    key={i}
                    className="px-2.5 py-0.5 bg-slate-100 text-slate-700 font-medium rounded-md border border-slate-200"
                  >
                    {p}
                  </span>
                )
              )}

              {recsData?.keywords && recsData.keywords.length > 0 && (
                <>
                  <span className="text-slate-300 mx-1">|</span>
                  <span className="font-semibold text-slate-500 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5 text-slate-400" />
                    Keywords:
                  </span>
                  {recsData.keywords.slice(0, 5).map((kw: string, i: number) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-purple-50 text-purple-700 font-medium rounded-md border border-purple-100 text-[11px]"
                    >
                      {kw}
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Live Google Trends Real-Time Ticker */}
          {recsData?.live_trend_signals && recsData.live_trend_signals.length > 0 && (
            <div className="p-3.5 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border border-amber-200 rounded-xl flex flex-col md:flex-row md:items-center gap-3 text-xs shadow-2xs">
              <div className="flex items-center gap-2 font-bold text-amber-900 shrink-0">
                <Flame className="w-4 h-4 text-orange-600 animate-pulse" />
                <span>Live Google Search Trends:</span>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto py-0.5 no-scrollbar">
                {recsData.live_trend_signals.map((trend: any, idx: number) => {
                  const title = typeof trend === 'string' ? trend : trend.title;
                  const traffic = typeof trend === 'object' ? trend.traffic : null;
                  return (
                    <span
                      key={idx}
                      className="bg-white/90 border border-amber-200 text-slate-800 font-medium px-2.5 py-1 rounded-md shrink-0 flex items-center gap-1.5 shadow-2xs"
                    >
                      <span className="font-bold text-orange-600">#{idx + 1}</span>
                      <span>{title}</span>
                      {traffic && (
                        <span className="text-[10px] font-semibold text-amber-800 bg-amber-100/80 px-1.5 py-0.5 rounded">
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
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeTab === 'all'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                All Opportunities ({recsData?.recommendations?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('reels')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeTab === 'reels'
                    ? 'bg-purple-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                Reels / Video
              </button>
              <button
                onClick={() => setActiveTab('carousels')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeTab === 'carousels'
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Carousels
              </button>
              <button
                onClick={() => setActiveTab('posts')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeTab === 'posts'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Static Posts
              </button>
            </div>

            <div className="text-xs text-slate-500 font-medium hidden sm:block">
              Niche-Calibrated Opportunities
            </div>
          </div>

          {/* 3-Column Recommendations Grid */}
          {filteredRecs.length === 0 ? (
            <div className="py-12 text-center space-y-2 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
              <p className="text-sm font-semibold text-slate-700">No recommendations found for this format filter.</p>
              <button
                onClick={() => setActiveTab('all')}
                className="text-xs text-purple-600 hover:text-purple-800 font-medium underline"
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
                    className="rounded-2xl border border-slate-200 bg-white shadow-xs hover:shadow-md transition duration-200 flex flex-col justify-between overflow-hidden"
                  >
                    <div className="p-5 space-y-4">
                      {/* Top Opportunity Header */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 px-2.5 py-0.5 rounded-full border border-purple-200">
                            Opportunity #{idx + 1}
                          </span>
                          <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                            {rec.niche_match_score || 95}% Match
                          </span>
                        </div>

                        {/* Format & Lift Pill */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md flex items-center gap-1.5 capitalize">
                            {formatIcon(rec.recommended_format)}
                            {rec.recommended_format}
                          </span>
                          <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md border border-purple-200">
                            {rec.format_lift}
                          </span>
                        </div>

                        {/* Title */}
                        <h3 className="text-base font-bold text-slate-900 leading-snug tracking-tight">
                          {rec.title}
                        </h3>

                        {/* Trend Context */}
                        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                            <Flame className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>Trend: {rec.trend_topic}</span>
                          </div>
                          {rec.trend_news_context && (
                            <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                              {rec.trend_news_context}
                            </p>
                          )}
                          <div className="text-[10px] text-slate-400 font-medium">
                            Source: {rec.trend_source} • {rec.trend_traffic || 'Trending'}
                          </div>
                        </div>

                        {/* Rationale */}
                        <div className="text-xs text-slate-700 leading-relaxed bg-purple-50/50 border border-purple-100 rounded-lg p-2.5">
                          <strong className="text-purple-900 block mb-0.5">Why This Fits Your Niche:</strong>
                          {rec.rationale}
                        </div>
                      </div>

                      {/* Next Steps Checklist */}
                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 uppercase tracking-wider">
                          <CheckSquare className="w-4 h-4 text-purple-600" />
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
                              className="text-xs text-slate-700 bg-slate-50 border border-slate-150 rounded-lg p-2 leading-relaxed flex items-start gap-2"
                            >
                              <span className="w-4 h-4 rounded-full bg-purple-100 text-purple-700 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                                {sIdx + 1}
                              </span>
                              <span>{step}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Creation Blueprint Toggle */}
                      {rec.creation_blueprint && (
                        <div className="pt-2 border-t border-slate-100">
                          <button
                            onClick={() => toggleBlueprint(rec.id)}
                            className="w-full flex items-center justify-between text-xs font-bold text-slate-800 hover:text-purple-700 py-1.5 transition"
                          >
                            <span className="flex items-center gap-1.5">
                              <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                              {isExpanded ? 'Hide Production Blueprint' : 'View Production Blueprint'}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-slate-500" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-500" />
                            )}
                          </button>

                          {isExpanded && (
                            <div className="mt-2.5 p-3.5 rounded-xl bg-slate-900 text-white space-y-3 text-xs animate-in fade-in">
                              <div className="space-y-1">
                                <span className="font-bold text-purple-400 block uppercase text-[10px] tracking-wider">
                                  1. Hook (First 3s)
                                </span>
                                <p className="text-slate-300 leading-relaxed text-[11px]">
                                  {rec.creation_blueprint.hook}
                                </p>
                              </div>

                              <div className="space-y-1">
                                <span className="font-bold text-blue-400 block uppercase text-[10px] tracking-wider">
                                  2. Value Delivery Body
                                </span>
                                <p className="text-slate-300 leading-relaxed text-[11px] whitespace-pre-line">
                                  {rec.creation_blueprint.body}
                                </p>
                              </div>

                              <div className="space-y-1">
                                <span className="font-bold text-emerald-400 block uppercase text-[10px] tracking-wider">
                                  3. Call To Action
                                </span>
                                <p className="text-slate-300 leading-relaxed text-[11px]">
                                  {rec.creation_blueprint.call_to_action}
                                </p>
                              </div>

                              {rec.creation_blueprint.production_tips && (
                                <div className="pt-2 border-t border-slate-800 space-y-1">
                                  <span className="font-bold text-slate-400 block uppercase text-[10px] tracking-wider">
                                    Production Tips
                                  </span>
                                  <ul className="space-y-1 text-slate-300 text-[11px]">
                                    {rec.creation_blueprint.production_tips.map((tip: string, tIdx: number) => (
                                      <li key={tIdx} className="flex items-start gap-1.5">
                                        <span className="text-purple-400 font-bold">•</span>
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
                      <div className="space-y-3.5 pt-3 border-t border-slate-100">
                        {/* Caption Variety Header & Style Selector */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                              Caption Variations ({captionOptions.length})
                            </span>
                            <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                              Style: {activeCaption.style}
                            </span>
                          </div>

                          {/* Style Tabs */}
                          <div className="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-xl">
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
                                  className={`py-1.5 px-2 text-[11px] font-semibold rounded-lg transition flex items-center justify-center gap-1.5 ${
                                    isSelected
                                      ? 'bg-white text-purple-900 shadow-xs border border-purple-200 font-bold'
                                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
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
                            <div className="text-[11px] text-purple-900 bg-purple-50 border border-purple-150 rounded-lg p-2 leading-snug flex items-start gap-1.5">
                              <Flame className="w-3.5 h-3.5 text-purple-600 shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <strong className="font-semibold text-purple-800">Hook Angle:</strong>{' '}
                                <span>"{activeCaption.hook}"</span>
                              </div>
                            </div>
                          )}

                          {/* Caption Preview Box */}
                          <div className="relative group">
                            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 leading-relaxed font-normal max-h-40 overflow-y-auto whitespace-pre-wrap select-text">
                              {activeCaption.text}
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 px-1">
                              <span>
                                {activeCaption.text.length} chars • ~{Math.ceil(activeCaption.text.split(/\s+/).length / 2.5)}s read
                              </span>
                              <button
                                onClick={() => handleCopy(activeCaption.text, `cap_only_${rec.id}`)}
                                className="text-purple-600 hover:text-purple-800 font-medium underline"
                              >
                                {copiedId === `cap_only_${rec.id}` ? 'Copied text!' : 'Copy text only'}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Hashtag Strategy Variety & Categorized Bundles */}
                        <div className="space-y-2 pt-2 border-t border-dashed border-slate-200">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                              <Hash className="w-3.5 h-3.5 text-blue-600" />
                              Hashtag Strategy Sets
                            </span>
                            <button
                              onClick={() => {
                                const tagStr = activeTags.join(' ');
                                handleCopy(tagStr, `tags_${rec.id}`);
                              }}
                              className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline flex items-center gap-1"
                            >
                              {copiedId === `tags_${rec.id}` ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span className="text-emerald-600">Copied!</span>
                                </>
                              ) : (
                                <span>Copy Active Tags ({activeTags.length})</span>
                              )}
                            </button>
                          </div>

                          {/* Strategy Bundle Tabs */}
                          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
                            {[
                              { key: 'all', label: `All (${(rec.suggested_hashtags || []).length || 10})` },
                              { key: 'niche', label: `🎯 Niche (${rec.hashtag_bundles?.niche?.length || 5})` },
                              { key: 'broad', label: `🚀 High Reach (${rec.hashtag_bundles?.broad?.length || 5})` },
                              { key: 'trending', label: `🔥 Trending (${rec.hashtag_bundles?.trending?.length || 5})` },
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
                                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition whitespace-nowrap ${
                                    isSelected
                                      ? 'bg-blue-600 text-white shadow-2xs font-bold'
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                                  className={`text-[11px] font-mono px-2 py-0.5 rounded-md transition border flex items-center gap-1 cursor-pointer ${
                                    isCopied
                                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold'
                                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-purple-50 hover:text-purple-800 hover:border-purple-200'
                                  }`}
                                >
                                  {isCopied ? <Check className="w-2.5 h-2.5 text-emerald-600" /> : null}
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
                            className="w-full py-2 px-3 bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-2xs"
                          >
                            {copiedId === `cap_${rec.id}` ? (
                              <>
                                <Check className="w-4 h-4 text-emerald-600" />
                                <span className="text-emerald-700 font-bold">Copied Caption & Hashtags to Clipboard!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 text-purple-700" />
                                <span>Copy {activeCaption.style.split(' ')[0]} Caption + {activeTags.length} Hashtags</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Card Action Footer */}
                    <div className="p-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleFeedback(rec, true)}
                          title="Accurate & helpful recommendation"
                          className={`p-1.5 rounded-lg border transition text-xs flex items-center gap-1 ${
                            userFeedback === 'accepted'
                              ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-bold'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span className="text-[11px]">Helpful</span>
                        </button>
                        <button
                          onClick={() => handleFeedback(rec, false)}
                          title="Not relevant to niche"
                          className={`p-1.5 rounded-lg border transition text-xs flex items-center gap-1 ${
                            userFeedback === 'rejected'
                              ? 'bg-rose-100 border-rose-300 text-rose-800 font-bold'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span className="text-[11px]">Downrank</span>
                        </button>
                      </div>

                      <button
                        onClick={() => handleSchedulePost(rec)}
                        className="px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-black rounded-lg transition shadow-xs flex items-center gap-1.5"
                      >
                        <Calendar className="w-3.5 h-3.5 text-purple-300" />
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
        <div className="py-16 text-center space-y-3 border border-slate-200 rounded-2xl bg-white shadow-xs p-8">
          <p className="text-base font-semibold text-slate-800">
            No recommendations loaded for @{handle}
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Select a sample account or enter your Instagram handle above to generate live AI content blueprints.
          </p>
          <button
            onClick={() => handleSelectHandle('tahirabbas_ca')}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black transition"
          >
            Load Sample Account (@tahirabbas_ca)
          </button>
        </div>
      )}
    </div>
  );
}
