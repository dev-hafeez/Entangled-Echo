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
  RefreshCw,
  Compass,
  Lightbulb,
  Calendar,
} from 'lucide-react';
import { api } from '@/lib/api';

export default function RecommendationsPage() {
  const { user, isLoaded } = useUser();
  const [handle, setHandle] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [recsData, setRecsData] = useState<any>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedRec, setExpandedRec] = useState<string>('rec_1');
  const [activeTab, setActiveTab] = useState<'all' | 'reels' | 'carousels' | 'posts'>('all');

  // Load user handle and generate recommendations
  useEffect(() => {
    if (!isLoaded || !user) return;

    const resolveHandle = async () => {
      let resolved = '';
      try {
        const userProfile = await api.getUserProfile(user.id).catch(() => null);
        if (userProfile?.profile?.handle) {
          resolved = userProfile.profile.handle;
        } else {
          resolved = localStorage.getItem(`ee_handle_${user.id}`) || 'cristiano';
        }
      } catch {
        resolved = 'cristiano';
      }

      setHandle(resolved);
      fetchRecommendations(resolved);
    };

    resolveHandle();
  }, [isLoaded, user]);

  const fetchRecommendations = async (targetHandle: string) => {
    setLoading(true);
    try {
      const data = await api.generateRecommendations(targetHandle);
      setRecsData(data);
    } catch (err) {
      console.error('Failed to load recommendations:', err);
    } finally {
      setLoading(false);
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
        return <Video className="w-4 h-4 text-[#285a49]" />;
      case 'carousel':
        return <Layers className="w-4 h-4 text-[#347761]" />;
      default:
        return <ImageIcon className="w-4 h-4 text-[#20372d]" />;
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
    <div className="max-w-[1150px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-16">
      {/* Top Header & Context Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#e3e8e1] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#285a49] bg-[#eef6eb] px-2.5 py-1 rounded-full border border-[#cbe2c5] flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-[#285a49]" />
              Live Trends & Algorithmic Blueprint
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1b3026] mt-2 tracking-tight">
            AI Content Recommendations
          </h1>
          <p className="text-sm text-[#55635a] mt-1 max-w-2xl leading-relaxed">
            Correlated against live search trends, platform viral topics, your calibrated statistical format lift, and optimal posting timelines.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {handle && (
            <div className="flex items-center gap-1.5 bg-[#f0f4ee] border border-[#d8e0d5] px-3 py-1.5 rounded-full text-xs font-semibold text-[#20372d]">
              <span>@{handle}</span>
            </div>
          )}
          <button
            onClick={() => handle && fetchRecommendations(handle)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#20372d] border border-[#20372d] hover:bg-white hover:text-[#20372d] hover:border-[#20372d] rounded-lg transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Trends</span>
          </button>
          <Link
            href="/dashboard"
            className="px-3 py-1.5 text-xs font-semibold text-white bg-[#20372d] border border-[#20372d] hover:bg-white hover:text-[#20372d] hover:border-[#20372d] rounded-lg transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center space-y-4">
          <div className="w-10 h-10 border-4 border-[#e3e8e1] border-t-[#20372d] rounded-full animate-spin" />
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-[#1b3026]">
              Ingesting live search trends and correlating with your niche profile...
            </p>
            <p className="text-xs text-[#748379]">
              Cross-referencing Google Trends, optimal slot windows, and format lifts
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Creator Intel Highlights Strip */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-[#e3e8e1] bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-[#f0f4ee] border border-[#d8e0d5] text-[#285a49] shrink-0">
                <Compass className="w-5 h-5" />
              </div>
              <div className="space-y-0.5">
                <span className="text-xs text-[#748379] font-medium">Classified Niche</span>
                <div className="text-sm font-bold text-[#1b3026] leading-tight">
                  {recsData?.user_niche || 'Digital Creator'}
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-[#e3e8e1] bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-[#eef6eb] border border-[#cbe2c5] text-[#285a49] shrink-0">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div className="space-y-0.5">
                <span className="text-xs text-[#748379] font-medium">Recommended Format</span>
                <div className="text-sm font-bold text-[#1b3026] capitalize leading-tight flex items-center gap-1.5">
                  {formatIcon(recsData?.dominant_format_recommendation)}
                  <span>{recsData?.dominant_format_recommendation || 'Reels'}</span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-[#e3e8e1] bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-[#f0f4ee] border border-[#d8e0d5] text-[#285a49] shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div className="space-y-0.5">
                <span className="text-xs text-[#748379] font-medium">Peak Engagement Window</span>
                <div className="text-sm font-bold text-[#1b3026] leading-tight">
                  {recsData?.optimal_time_window || '6:00 PM - 8:00 PM UTC'}
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-[#e3e8e1] bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-[#eef6eb] border border-[#cbe2c5] text-[#285a49] shrink-0">
                <Globe className="w-5 h-5" />
              </div>
              <div className="space-y-0.5">
                <span className="text-xs text-[#748379] font-medium">Target Language</span>
                <div className="text-sm font-bold text-[#1b3026] leading-tight">
                  {recsData?.language_preference || 'English'}
                </div>
              </div>
            </div>
          </div>

          {/* Live Google Trends Real-Time Ticker */}
          {recsData?.live_trend_signals && recsData.live_trend_signals.length > 0 && (
            <div className="p-3.5 bg-[#f0f4ee] border border-[#d8e0d5] rounded-xl flex flex-col md:flex-row md:items-center gap-3 text-xs shadow-xs">
              <div className="flex items-center gap-2 font-bold text-[#1b3026] shrink-0">
                <Flame className="w-4 h-4 text-[#285a49]" />
                <span>Live Google Search Trends:</span>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto py-0.5">
                {recsData.live_trend_signals.map((trend: any, idx: number) => {
                  const title = typeof trend === 'string' ? trend : trend.title;
                  const traffic = typeof trend === 'object' ? trend.traffic : null;
                  return (
                    <span
                      key={idx}
                      className="bg-white border border-[#d8e0d5] text-[#1b3026] font-medium px-2.5 py-1 rounded-md shrink-0 flex items-center gap-1.5 shadow-xs"
                    >
                      <span className="font-bold text-[#285a49]">#{idx + 1}</span>
                      <span>{title}</span>
                      {traffic && (
                        <span className="text-[10px] font-semibold text-[#20372d] bg-[#f0f4ee] border border-[#d8e0d5] px-1.5 py-0.5 rounded">
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
          <div className="flex items-center justify-between gap-4 border-b border-[#e3e8e1] pb-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                  activeTab === 'all'
                    ? 'bg-[#20372d] text-white border border-[#20372d] shadow-sm'
                    : 'bg-[#f0f4ee] text-[#55635a] border border-transparent hover:border-[#d8e0d5] hover:text-[#1b3026]'
                }`}
              >
                All Opportunities ({recsData?.recommendations?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('reels')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                  activeTab === 'reels'
                    ? 'bg-[#20372d] text-white border border-[#20372d] shadow-sm'
                    : 'bg-[#f0f4ee] text-[#55635a] border border-transparent hover:border-[#d8e0d5] hover:text-[#1b3026]'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>Reels</span>
              </button>
              <button
                onClick={() => setActiveTab('carousels')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                  activeTab === 'carousels'
                    ? 'bg-[#20372d] text-white border border-[#20372d] shadow-sm'
                    : 'bg-[#f0f4ee] text-[#55635a] border border-transparent hover:border-[#d8e0d5] hover:text-[#1b3026]'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Carousels</span>
              </button>
              <button
                onClick={() => setActiveTab('posts')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] ${
                  activeTab === 'posts'
                    ? 'bg-[#20372d] text-white border border-[#20372d] shadow-sm'
                    : 'bg-[#f0f4ee] text-[#55635a] border border-transparent hover:border-[#d8e0d5] hover:text-[#1b3026]'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Posts</span>
              </button>
            </div>

            <div className="text-xs text-[#748379] font-medium hidden sm:block">
              Matched against Live Search Trends
            </div>
          </div>

          {/* Recommendations Content Cards */}
          <div className="space-y-6">
            {filteredRecs.map((rec: any, idx: number) => {
              const isExpanded = expandedRec === rec.id;
              return (
                <div
                  key={rec.id || idx}
                  className="rounded-2xl border border-[#e3e8e1] bg-white shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden"
                >
                  {/* Top Opportunity Bar */}
                  <div className="p-6 border-b border-[#e3e8e1] flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#fbfaf8]">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-[#20372d] bg-[#f0f4ee] border border-[#d8e0d5] px-2.5 py-0.5 rounded-full">
                          Opportunity #{idx + 1}
                        </span>
                        <span className="text-xs font-semibold text-[#285a49] bg-[#eef6eb] px-2.5 py-0.5 rounded-full border border-[#cbe2c5]">
                          {rec.niche_match_score}% Niche Match
                        </span>
                        <span className="text-xs font-semibold text-[#20372d] bg-[#f0f4ee] px-2.5 py-0.5 rounded-full border border-[#d8e0d5]">
                          {rec.format_lift}
                        </span>
                        <span className="text-xs font-bold text-[#285a49] bg-[#eef6eb] border border-[#cbe2c5] px-2.5 py-0.5 rounded-full flex items-center gap-1">
                          <Flame className="w-3.5 h-3.5 text-[#285a49]" />
                          {rec.trend_source || 'Google Trends (Live)'}
                        </span>
                        {rec.trend_traffic && (
                          <span className="text-xs font-semibold text-[#1b3026] bg-[#f0f4ee] border border-[#d8e0d5] px-2 py-0.5 rounded-full flex items-center gap-1">
                            <TrendingUp className="w-3 h-3 text-[#285a49]" />
                            {rec.trend_traffic}
                          </span>
                        )}
                      </div>
                      <h3 className="text-xl font-bold text-[#1b3026] tracking-tight">
                        {rec.title}
                      </h3>
                      {rec.trend_news_context && (
                        <div className="text-xs text-[#55635a] bg-white border border-[#e3e8e1] rounded-lg px-3 py-1.5 flex items-center gap-2 max-w-3xl shadow-xs">
                          <Globe className="w-3.5 h-3.5 text-[#285a49] shrink-0" />
                          <span className="font-semibold text-[#1b3026] shrink-0">Live Search Driver:</span>
                          <span className="truncate">{rec.trend_news_context}</span>
                        </div>
                      )}
                      <p className="text-xs text-[#55635a] leading-relaxed max-w-3xl">
                        {rec.rationale}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedRec(isExpanded ? '' : rec.id)}
                        className="px-3.5 py-2 text-xs font-semibold text-white bg-[#20372d] border border-[#20372d] hover:bg-white hover:text-[#20372d] hover:border-[#20372d] rounded-lg transition-colors shadow-sm flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49]"
                      >
                        <span>{isExpanded ? 'Collapse Blueprint' : 'View Creation Guide'}</span>
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Strategy & Timing Overview */}
                  <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 border-b border-[#e3e8e1]">
                    <div className="space-y-1">
                      <span className="text-xs text-[#748379] font-semibold uppercase tracking-wider">
                        Recommended Media Type
                      </span>
                      <div className="flex items-center gap-2 text-sm font-bold text-[#1b3026] capitalize">
                        {formatIcon(rec.recommended_format)}
                        <span>{rec.recommended_format}</span>
                      </div>
                      <p className="text-xs text-[#748379]">
                        Higher retention & algorithmic discovery
                      </p>
                    </div>

                    <div className="space-y-1">
                      <span className="text-xs text-[#748379] font-semibold uppercase tracking-wider">
                        Optimal Posting Time
                      </span>
                      <div className="flex items-center gap-2 text-sm font-bold text-[#1b3026]">
                        <Clock className="w-4 h-4 text-[#285a49]" />
                        <span>{rec.optimal_posting_time}</span>
                      </div>
                      <p className="text-xs text-[#748379]">
                        Calibrated from your audience peak reach
                      </p>
                    </div>

                    <div className="space-y-1">
                      <span className="text-xs text-[#748379] font-semibold uppercase tracking-wider">
                        Suggested Timeline Day
                      </span>
                      <div className="flex items-center gap-2 text-sm font-bold text-[#1b3026]">
                        <Calendar className="w-4 h-4 text-[#347761]" />
                        <span>{rec.recommended_day}</span>
                      </div>
                      <p className="text-xs text-[#748379]">
                        Highest weekly engagement surge
                      </p>
                    </div>
                  </div>

                  {/* Caption & Hashtag Draft Box */}
                  <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#1b3026] uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-[#285a49]" />
                        Generated Caption Draft ({recsData?.language_preference || 'English'})
                      </span>
                      <button
                        onClick={() => handleCopy(rec.caption_draft, `cap_${rec.id}`)}
                        className="text-xs font-semibold text-[#285a49] hover:text-[#1b3026] flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285a49] rounded px-1.5 py-0.5"
                      >
                        {copiedId === `cap_${rec.id}` ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-[#285a49]" />
                            <span className="text-[#285a49]">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Caption</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="p-4 rounded-xl bg-[#f0f4ee] border border-[#e3e8e1] text-sm text-[#1b3026] leading-relaxed font-normal">
                      {rec.caption_draft}
                    </div>

                    {/* Hashtags */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-xs font-medium text-[#748379]">Suggested Tags:</span>
                      {rec.suggested_hashtags?.map((tag: string, tIdx: number) => (
                        <span
                          key={tIdx}
                          className="text-xs font-mono font-medium px-2.5 py-0.5 rounded-md bg-[#f0f4ee] text-[#20372d] border border-[#d8e0d5]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Expanded Creation Blueprint (How to Create It) */}
                  {isExpanded && rec.creation_blueprint && (
                    <div className="p-6 bg-[#20372d] text-white border-t border-[#1b3026] space-y-5 animate-in fade-in duration-200">
                      <div className="flex items-center gap-2">
                        <Lightbulb className="w-5 h-5 text-[#cbe2c5]" />
                        <h4 className="text-base font-bold text-white tracking-tight">
                          Production Blueprint: How to Create This Content
                        </h4>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-xl bg-[#284639] border border-[#345c4b] space-y-1.5">
                          <span className="text-xs font-bold text-[#cbe2c5] uppercase tracking-wider">
                            1. Hook (First 3s)
                          </span>
                          <p className="text-xs text-slate-200 leading-relaxed">
                            {rec.creation_blueprint.hook}
                          </p>
                        </div>

                        <div className="p-4 rounded-xl bg-[#284639] border border-[#345c4b] space-y-1.5">
                          <span className="text-xs font-bold text-[#cbe2c5] uppercase tracking-wider">
                            2. Value Delivery (15-25s)
                          </span>
                          <p className="text-xs text-slate-200 leading-relaxed">
                            {rec.creation_blueprint.body}
                          </p>
                        </div>

                        <div className="p-4 rounded-xl bg-[#284639] border border-[#345c4b] space-y-1.5">
                          <span className="text-xs font-bold text-[#cbe2c5] uppercase tracking-wider">
                            3. Call to Action (Final 5s)
                          </span>
                          <p className="text-xs text-slate-200 leading-relaxed">
                            {rec.creation_blueprint.call_to_action}
                          </p>
                        </div>
                      </div>

                      {rec.creation_blueprint.production_tips && (
                        <div className="space-y-2 pt-2">
                          <span className="text-xs font-bold text-[#cbe2c5] uppercase tracking-wider">
                            Technical Production Rules
                          </span>
                          <ul className="space-y-1.5 text-xs text-slate-200">
                            {rec.creation_blueprint.production_tips.map((tip: string, tipIdx: number) => (
                              <li key={tipIdx} className="flex items-center gap-2">
                                <span className="text-[#cbe2c5] font-bold">•</span>
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
        </>
      )}
    </div>
  );
}
