'use client';

import { useState, useEffect } from 'react';
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
  ChevronRight,
  Flame,
  Globe,
  ArrowUpRight,
  RefreshCw,
  Compass,
  Lightbulb,
  Calendar,
  AlertCircle,
  User,
} from 'lucide-react';
import { api } from '@/lib/api';

const POPULAR_HANDLES = ['nightcreeper24', 'cristiano', 'leomessi', 'icc', '100xengineers'];

export default function RecommendationsPage() {
  const { user, isLoaded } = useUser();
  const [handle, setHandle] = useState<string>('');
  const [customHandleInput, setCustomHandleInput] = useState<string>('');
  const [isEditingHandle, setIsEditingHandle] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recsData, setRecsData] = useState<any>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedRec, setExpandedRec] = useState<string>('rec_1');
  const [activeTab, setActiveTab] = useState<'all' | 'reels' | 'carousels' | 'posts'>('all');

  // Load user handle and generate recommendations
  useEffect(() => {
    if (!isLoaded) return;

    const resolveHandle = async () => {
      let resolved = '';
      if (user) {
        try {
          const userProfile = await api.getUserProfile(user.id).catch(() => null);
          if (userProfile?.profile?.handle) {
            resolved = userProfile.profile.handle;
          } else {
            resolved = localStorage.getItem(`ee_handle_${user.id}`) || 'nightcreeper24';
          }
        } catch {
          resolved = 'nightcreeper24';
        }
      } else {
        resolved = (typeof window !== 'undefined' && localStorage.getItem('ee_active_handle')) || 'nightcreeper24';
      }

      setHandle(resolved);
      setCustomHandleInput(resolved);
      fetchRecommendations(resolved);
    };

    resolveHandle();
  }, [isLoaded, user]);

  const fetchRecommendations = async (targetHandle: string) => {
    const clean = targetHandle.trim().toLowerCase().replace(/^@/, '');
    if (!clean) return;

    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await api.generateRecommendations(clean);
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
    if (user?.id) {
      localStorage.setItem(`ee_handle_${user.id}`, newHandle);
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

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
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

  const filteredRecs = recsData?.recommendations?.filter((r: any) => {
    if (activeTab === 'reels') return r.recommended_format === 'reel' || r.recommended_format === 'video';
    if (activeTab === 'carousels') return r.recommended_format === 'carousel';
    if (activeTab === 'posts') return r.recommended_format === 'image';
    return true;
  }) || [];

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-16">
      {/* Top Header & Context Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200 flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-purple-600" />
              Live Trends & Algorithmic Blueprint
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 mt-2 tracking-tight">
            AI Content Recommendations
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
            Correlated against live Google Search Trends, platform viral topics, your calibrated statistical format lift, and optimal posting timelines.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Creator Account Selector / Pill */}
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
                className="px-2.5 py-1.5 text-xs font-semibold bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
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
                className="text-[10px] text-purple-600 hover:text-purple-800 underline font-medium ml-1"
                title="Change Creator Account"
              >
                Switch
              </button>
            </div>
          )}

          <button
            onClick={() => handle && fetchRecommendations(handle)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Trends
          </button>
          <Link
            href="/dashboard"
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>

      {/* Account Quick Switch Pills */}
      <div className="flex items-center gap-2 overflow-x-auto text-xs pb-1 no-scrollbar">
        <span className="text-slate-400 font-medium shrink-0">Sample Accounts:</span>
        {POPULAR_HANDLES.map((h) => (
          <button
            key={h}
            onClick={() => handleSelectHandle(h)}
            className={`px-2.5 py-1 rounded-md transition font-medium shrink-0 ${
              handle === h
                ? 'bg-purple-100 text-purple-800 font-semibold border border-purple-200'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            @{h}
          </button>
        ))}
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 flex items-center justify-between gap-4 animate-in fade-in">
          <div className="flex items-center gap-2.5 text-sm">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => handle && fetchRecommendations(handle)}
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
              Ingesting live search trends and correlating with your niche profile...
            </p>
            <p className="text-xs text-slate-400">
              Cross-referencing Google Trends, optimal slot windows, and format lifts for @{handle}
            </p>
          </div>
        </div>
      ) : recsData ? (
        <>
          {/* Creator Intel Highlights Strip */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-600 shrink-0">
                <Compass className="w-5 h-5" />
              </div>
              <div className="space-y-0.5">
                <span className="text-xs text-slate-500 font-medium">Classified Niche</span>
                <div className="text-sm font-bold text-slate-900 leading-tight">
                  {recsData?.user_niche || 'Digital Creator'}
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-purple-50 border border-purple-100 text-purple-600 shrink-0">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div className="space-y-0.5">
                <span className="text-xs text-slate-500 font-medium">Recommended Format</span>
                <div className="text-sm font-bold text-slate-900 capitalize leading-tight flex items-center gap-1.5">
                  {formatIcon(recsData?.dominant_format_recommendation)}
                  <span>{recsData?.dominant_format_recommendation || 'Reels'}</span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div className="space-y-0.5">
                <span className="text-xs text-slate-500 font-medium">Peak Engagement Window</span>
                <div className="text-sm font-bold text-slate-900 leading-tight">
                  {recsData?.optimal_time_window || '6:00 PM - 8:00 PM UTC'}
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 shrink-0">
                <Globe className="w-5 h-5" />
              </div>
              <div className="space-y-0.5">
                <span className="text-xs text-slate-500 font-medium">Target Language</span>
                <div className="text-sm font-bold text-slate-900 leading-tight">
                  {recsData?.language_preference || 'English'}
                </div>
              </div>
            </div>
          </div>

          {/* Live Google Trends Real-Time Ticker */}
          {recsData?.live_trend_signals && recsData.live_trend_signals.length > 0 && (
            <div className="p-3.5 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border border-amber-200 rounded-xl flex flex-col md:flex-row md:items-center gap-3 text-xs shadow-xs">
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
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                All Opportunities ({recsData?.recommendations?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('reels')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeTab === 'reels'
                    ? 'bg-purple-700 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                Reels
              </button>
              <button
                onClick={() => setActiveTab('carousels')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                  activeTab === 'carousels'
                    ? 'bg-blue-700 text-white shadow-sm'
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
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Posts
              </button>
            </div>

            <div className="text-xs text-slate-500 font-medium hidden sm:block">
              Matched against Live Search Trends
            </div>
          </div>

          {/* Recommendations Content Cards */}
          {filteredRecs.length === 0 ? (
            <div className="py-12 text-center space-y-2 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
              <p className="text-sm font-semibold text-slate-700">No recommendations found for this filter.</p>
              <button
                onClick={() => setActiveTab('all')}
                className="text-xs text-purple-600 hover:text-purple-800 font-medium underline"
              >
                View all format opportunities
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {filteredRecs.map((rec: any, idx: number) => {
                const isExpanded = expandedRec === rec.id;
                return (
                  <div
                    key={rec.id || idx}
                    className="rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition overflow-hidden"
                  >
                    {/* Top Opportunity Bar */}
                    <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-purple-700 bg-purple-100 px-2.5 py-0.5 rounded-full">
                            Opportunity #{idx + 1}
                          </span>
                          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                            {rec.niche_match_score}% Niche Match
                          </span>
                          <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                            {rec.format_lift}
                          </span>
                          <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                            <Flame className="w-3.5 h-3.5 text-amber-600" />
                            {rec.trend_source || 'Google Trends (Live)'}
                          </span>
                          {rec.trend_traffic && (
                            <span className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                              📈 {rec.trend_traffic}
                            </span>
                          )}
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 tracking-tight">
                          {rec.title}
                        </h3>
                        {rec.trend_news_context && (
                          <div className="text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 flex items-center gap-2 max-w-3xl shadow-2xs">
                            <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="font-semibold text-slate-800 shrink-0">Live Search Driver:</span>
                            <span className="truncate">{rec.trend_news_context}</span>
                          </div>
                        )}
                        <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
                          {rec.rationale}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedRec(isExpanded ? '' : rec.id)}
                          className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition shadow-sm flex items-center gap-1.5"
                        >
                          <span>{isExpanded ? 'Collapse Blueprint' : 'View Creation Guide'}</span>
                          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                      </div>
                    </div>

                    {/* Strategy & Timing Overview */}
                    <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 border-b border-slate-100">
                      <div className="space-y-1">
                        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                          Recommended Media Type
                        </span>
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-800 capitalize">
                          {formatIcon(rec.recommended_format)}
                          <span>{rec.recommended_format}</span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Higher retention & algorithmic discovery
                        </p>
                      </div>

                      <div className="space-y-1">
                        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                          Optimal Posting Time
                        </span>
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                          <Clock className="w-4 h-4 text-amber-500" />
                          <span>{rec.optimal_posting_time}</span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Calibrated from your audience peak reach
                        </p>
                      </div>

                      <div className="space-y-1">
                        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                          Suggested Timeline Day
                        </span>
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                          <Calendar className="w-4 h-4 text-blue-500" />
                          <span>{rec.recommended_day}</span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Highest weekly engagement surge
                        </p>
                      </div>
                    </div>

                    {/* Caption & Hashtag Draft Box */}
                    <div className="p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-purple-600" />
                          Generated Caption Draft ({recsData?.language_preference || 'English'})
                        </span>
                        <button
                          onClick={() => handleCopy(rec.caption_draft, `cap_${rec.id}`)}
                          className="text-xs font-semibold text-purple-700 hover:text-purple-900 flex items-center gap-1 transition"
                        >
                          {copiedId === `cap_${rec.id}` ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-600">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy Caption</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 leading-relaxed font-normal">
                        {rec.caption_draft}
                      </div>

                      {/* Hashtags */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-xs font-medium text-slate-500">Suggested Tags:</span>
                        {rec.suggested_hashtags?.map((tag: string, tIdx: number) => (
                          <span
                            key={tIdx}
                            className="text-xs font-mono font-medium px-2.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Expanded Creation Blueprint (How to Create It) */}
                    {isExpanded && rec.creation_blueprint && (
                      <div className="p-6 bg-slate-900 text-white border-t border-slate-800 space-y-5 animate-in fade-in duration-200">
                        <div className="flex items-center gap-2">
                          <Lightbulb className="w-5 h-5 text-amber-400" />
                          <h4 className="text-base font-bold text-white tracking-tight">
                            Production Blueprint: How to Create This Content
                          </h4>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-1.5">
                            <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">
                              1. Hook (First 3s)
                            </span>
                            <p className="text-xs text-slate-200 leading-relaxed">
                              {rec.creation_blueprint.hook}
                            </p>
                          </div>

                          <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-1.5">
                            <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">
                              2. Value Delivery (15-25s)
                            </span>
                            <p className="text-xs text-slate-200 leading-relaxed">
                              {rec.creation_blueprint.body}
                            </p>
                          </div>

                          <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-1.5">
                            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                              3. Call to Action (Final 5s)
                            </span>
                            <p className="text-xs text-slate-200 leading-relaxed">
                              {rec.creation_blueprint.call_to_action}
                            </p>
                          </div>
                        </div>

                        {rec.creation_blueprint.production_tips && (
                          <div className="space-y-2 pt-2">
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                              Technical Production Rules
                            </span>
                            <ul className="space-y-1.5 text-xs text-slate-300">
                              {rec.creation_blueprint.production_tips.map((tip: string, tipIdx: number) => (
                                <li key={tipIdx} className="flex items-center gap-2">
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
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="py-16 text-center space-y-3 border border-slate-200 rounded-2xl bg-white shadow-sm p-8">
          <p className="text-base font-semibold text-slate-800">
            No recommendations loaded for @{handle}
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Select a sample account or enter your Instagram handle above to generate live AI content blueprints.
          </p>
          <button
            onClick={() => handleSelectHandle('nightcreeper24')}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 transition"
          >
            Load Sample Account (@nightcreeper24)
          </button>
        </div>
      )}
    </div>
  );
}
