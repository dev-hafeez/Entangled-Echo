'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { api } from '@/lib/api';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Send,
  Trash2,
  Layers,
  Video,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  X,
  ExternalLink,
} from 'lucide-react';

interface ScheduledPost {
  id: string;
  userId: string;
  accountHandle: string;
  caption: string;
  hashtags: string[];
  mediaUrl?: string;
  mediaType: 'image' | 'video' | 'carousel';
  platform: 'instagram' | 'facebook';
  scheduledTime: string;
  status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  publishedAt: string | null;
  publishedPostId: string | null;
  aiSuggestedSlot?: boolean;
  confidenceScore?: number;
}

interface RecommendedSlot {
  dayOfWeek: string;
  dayIndex: number;
  hour: number;
  timeFormatted: string;
  confidenceScore: number;
  isGenericPrior: boolean;
  rationale: string;
}

export default function CalendarPage() {
  const { user, isLoaded } = useUser();
  const userId = user?.id || 'default_user';

  const [activeHandle, setActiveHandle] = useState<string>('creator');
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [recommendedSlots, setRecommendedSlots] = useState<RecommendedSlot[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  // Modals
  const [showScheduleModal, setShowScheduleModal] = useState<boolean>(false);
  const [selectedPost, setSelectedPost] = useState<ScheduledPost | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [ticking, setTicking] = useState<boolean>(false);
  const [tickMessage, setTickMessage] = useState<string | null>(null);

  // Form State
  const [formHandle, setFormHandle] = useState<string>('');
  const [formCaption, setFormCaption] = useState<string>('');
  const [formHashtags, setFormHashtags] = useState<string>('');
  const [formMediaUrl, setFormMediaUrl] = useState<string>('');
  const [formMediaType, setFormMediaType] = useState<'image' | 'video' | 'carousel'>('image');
  const [formPlatform, setFormPlatform] = useState<'instagram' | 'facebook'>('instagram');
  const [formDateTime, setFormDateTime] = useState<string>('');
  const [formStatus, setFormStatus] = useState<'SCHEDULED' | 'DRAFT'>('SCHEDULED');
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Load account handle from local storage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(`ee_handle_${userId}`);
      if (stored) {
        setActiveHandle(stored);
        setFormHandle(stored);
      } else {
        setActiveHandle('creator');
        setFormHandle('creator');
      }
    }
  }, [userId]);

  // Fetch Scheduled Posts
  const fetchPosts = async () => {
    setLoading(true);
    try {
      const res = await api.getScheduledPosts(userId);
      if (res?.posts) {
        setPosts(res.posts);
      }
    } catch (err) {
      console.error('Failed to load scheduled posts:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Recommended Slots
  const fetchRecommendedSlots = async (handle: string) => {
    try {
      const res = await api.getRecommendedSlots(handle);
      if (res?.slots) {
        setRecommendedSlots(res.slots);
      }
    } catch (err) {
      console.warn('Could not load recommended slots:', err);
    }
  };

  useEffect(() => {
    if (!isLoaded) return;
    fetchPosts();
    if (activeHandle) {
      fetchRecommendedSlots(activeHandle);
    }
  }, [isLoaded, userId, activeHandle]);

  // Navigate calendar
  const prevPeriod = () => {
    const next = new Date(currentDate);
    if (viewMode === 'week') next.setDate(next.getDate() - 7);
    else next.setMonth(next.getMonth() - 1);
    setCurrentDate(next);
  };

  const nextPeriod = () => {
    const next = new Date(currentDate);
    if (viewMode === 'week') next.setDate(next.getDate() + 7);
    else next.setMonth(next.getMonth() + 1);
    setCurrentDate(next);
  };

  const jumpToToday = () => {
    setCurrentDate(new Date());
  };

  // Week Days Calculation (Mon -> Sun)
  const getWeekDates = (date: Date) => {
    const start = new Date(date);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);

    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      week.push(d);
    }
    return week;
  };

  // Month Days Calculation
  const getMonthDays = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const days: (Date | null)[] = [];
    const firstDayIndex = (firstDay.getDay() + 6) % 7; // Monday start offset

    for (let i = 0; i < firstDayIndex; i++) {
      days.push(null);
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const weekDays = getWeekDates(currentDate);
  const monthDays = getMonthDays(currentDate);

  // Check if dates match YYYY-MM-DD
  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  // Drag and Drop handlers (FR-25, FR-26)
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedPostId(id);
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent, dateKey: string) => {
    e.preventDefault();
    setDragOverDate(dateKey);
  };

  const handleDrop = async (e: React.DragEvent, targetDate: Date, targetHour: number = 18) => {
    e.preventDefault();
    setDragOverDate(null);
    const id = e.dataTransfer.getData('text/plain') || draggedPostId;
    if (!id) return;

    const targetTime = new Date(targetDate);
    targetTime.setHours(targetHour, 0, 0, 0);

    try {
      // Optimistic update
      setPosts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, scheduledTime: targetTime.toISOString() } : p))
      );
      await api.reschedulePost(id, targetTime.toISOString(), userId);
    } catch (err: any) {
      console.error('Drag reschedule failed:', err);
      fetchPosts(); // revert on error
    } finally {
      setDraggedPostId(null);
    }
  };

  // Open Schedule Modal with Pre-filled time
  const handleOpenScheduleForSlot = (date: Date, hour: number = 18) => {
    const slotDate = new Date(date);
    slotDate.setHours(hour, 0, 0, 0);
    const localIso = new Date(slotDate.getTime() - slotDate.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

    setFormHandle(activeHandle);
    setFormCaption('');
    setFormHashtags('');
    setFormMediaUrl('');
    setFormMediaType('image');
    setFormPlatform('instagram');
    setFormDateTime(localIso);
    setFormStatus('SCHEDULED');
    setFormError(null);
    setShowScheduleModal(true);
  };

  // Submit Schedule Form
  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDateTime) {
      setFormError('Please select a valid scheduled date & time');
      return;
    }
    if (!formCaption.trim() && !formMediaUrl.trim()) {
      setFormError('Please enter a caption or media URL');
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    const tags = formHashtags
      .split(/[\s,]+/)
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);

    try {
      const res = await api.createScheduledPost({
        userId,
        accountHandle: formHandle.trim() || activeHandle || 'creator',
        caption: formCaption.trim(),
        hashtags: tags,
        mediaUrl: formMediaUrl.trim() || undefined,
        mediaType: formMediaType,
        platform: formPlatform,
        scheduledTime: new Date(formDateTime).toISOString(),
        status: formStatus,
      });

      if (res?.post) {
        setPosts((prev) => [...prev, res.post]);
        setShowScheduleModal(false);
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to schedule post');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Immediate Publish Action
  const handlePublishNow = async (id: string, forceError: boolean = false) => {
    setPublishingId(id);
    try {
      const res = await api.publishPostNow(id, userId, forceError);
      if (res?.post) {
        setPosts((prev) => prev.map((p) => (p.id === id ? res.post : p)));
        if (selectedPost?.id === id) {
          setSelectedPost(res.post);
        }
      }
    } catch (err: any) {
      console.error('Publish error:', err);
    } finally {
      setPublishingId(null);
    }
  };

  // Delete Post Action
  const handleDeletePost = async (id: string) => {
    try {
      await api.deleteScheduledPost(id, userId);
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setSelectedPost(null);
    } catch (err: any) {
      console.error('Delete failed:', err);
    }
  };

  // Trigger Publishing Ticker Check
  const handleTriggerTick = async () => {
    setTicking(true);
    setTickMessage(null);
    try {
      const res = await api.triggerPublishTick();
      setTickMessage(`Processed ${res.processed} due posts (${res.published} published, ${res.failed} failed)`);
      fetchPosts();
      setTimeout(() => setTickMessage(null), 4000);
    } catch (err: any) {
      setTickMessage(`Tick failed: ${err.message}`);
    } finally {
      setTicking(false);
    }
  };

  // Status Badge Component
  const getStatusBadge = (status: ScheduledPost['status']) => {
    switch (status) {
      case 'PUBLISHED':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Published
          </span>
        );
      case 'PUBLISHING':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded animate-pulse">
            <Loader2 className="w-3 h-3 text-blue-600 animate-spin" />
            Publishing...
          </span>
        );
      case 'SCHEDULED':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
            <Clock className="w-3 h-3 text-purple-600" />
            Scheduled
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            Failed
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
            <XCircle className="w-3 h-3 text-slate-500" />
            Cancelled
          </span>
        );
      case 'DRAFT':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
            Draft
          </span>
        );
    }
  };

  const getMediaIcon = (type: ScheduledPost['mediaType']) => {
    switch (type) {
      case 'video':
        return <Video className="w-3 h-3 text-blue-500" />;
      case 'carousel':
        return <Layers className="w-3 h-3 text-purple-500" />;
      case 'image':
      default:
        return <ImageIcon className="w-3 h-3 text-emerald-500" />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Header & Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Content Calendar</h1>
            <span className="text-[10px] bg-slate-100 text-slate-600 border border-slate-200 font-mono px-2 py-0.5 rounded">
              FR-25 / FR-26
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Weekly & monthly visual scheduling with native drag-and-drop and AI recommended optimal windows.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Run Tick / Queue Button */}
          <button
            onClick={handleTriggerTick}
            disabled={ticking}
            title="Evaluate and publish due posts right now (Tick runner)"
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${ticking ? 'animate-spin' : ''}`} />
            <span>Check Queue</span>
          </button>

          {/* New Post Button */}
          <button
            onClick={() => handleOpenScheduleForSlot(new Date(), 18)}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Schedule Post</span>
          </button>
        </div>
      </div>

      {tickMessage && (
        <div className="text-xs bg-slate-900 text-white px-3 py-2 rounded-lg flex items-center justify-between animate-in fade-in">
          <span>✓ {tickMessage}</span>
          <button onClick={() => setTickMessage(null)} className="text-slate-400 hover:text-white">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Calendar Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={prevPeriod}
            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={jumpToToday}
            className="px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 transition"
          >
            Today
          </button>
          <button
            onClick={nextPeriod}
            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <span className="text-sm font-bold text-slate-900 ml-2">
            {currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1 rounded-md font-semibold transition ${
                viewMode === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Week View
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1 rounded-md font-semibold transition ${
                viewMode === 'month' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Month View
            </button>
          </div>
        </div>
      </div>

      {/* AI Optimal Posting Slots Banner */}
      {recommendedSlots.length > 0 && (
        <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/40 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              <h3 className="text-xs font-bold text-slate-900">AI-Calibrated Optimal Slots</h3>
              <span className="text-[10px] text-purple-700 bg-purple-100 font-mono px-1.5 py-0.5 rounded">
                FR-25 Overlay
              </span>
            </div>
            <span className="text-[11px] text-slate-500">Click any slot to schedule directly</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            {recommendedSlots.map((slot, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  const targetDay = weekDays.find((d) => d.getDay() === slot.dayIndex) || currentDate;
                  handleOpenScheduleForSlot(targetDay, slot.hour);
                }}
                className="p-2.5 bg-white border border-purple-200 hover:border-purple-400 rounded-lg text-left transition shadow-2xs hover:shadow-xs group"
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span>{slot.dayOfWeek}</span>
                  <span className="text-[10px] text-purple-600 font-mono">{slot.confidenceScore}% conf</span>
                </div>
                <div className="text-xs font-semibold text-purple-700 mt-0.5 group-hover:underline">
                  {slot.timeFormatted}
                </div>
                <p className="text-[10px] text-slate-400 truncate mt-1">{slot.rationale}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 1: WEEK VIEW */}
      {viewMode === 'week' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/70 text-center text-xs font-semibold">
            {weekDays.map((date, idx) => {
              const isToday = isSameDay(date, new Date());
              return (
                <div
                  key={idx}
                  className={`py-3 px-2 border-r border-slate-100 last:border-r-0 ${
                    isToday ? 'bg-purple-50/50 text-purple-900' : 'text-slate-700'
                  }`}
                >
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider">
                    {date.toLocaleDateString(undefined, { weekday: 'short' })}
                  </div>
                  <div
                    className={`inline-flex items-center justify-center w-7 h-7 mt-1 rounded-full text-sm font-bold ${
                      isToday ? 'bg-slate-900 text-white' : 'text-slate-800'
                    }`}
                  >
                    {date.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Week Grid Slots */}
          <div className="grid grid-cols-7 min-h-[500px] divide-x divide-slate-100">
            {weekDays.map((date, colIdx) => {
              const dayPosts = posts.filter((p) => isSameDay(new Date(p.scheduledTime), date));
              const dateKey = date.toISOString().slice(0, 10);
              const isDragTarget = dragOverDate === dateKey;

              // Find if this day has an AI recommended slot
              const daySlot = recommendedSlots.find((s) => s.dayIndex === date.getDay());

              return (
                <div
                  key={colIdx}
                  onDragOver={(e) => handleDragOver(e, dateKey)}
                  onDrop={(e) => handleDrop(e, date, daySlot ? daySlot.hour : 18)}
                  className={`p-2 space-y-2 transition flex flex-col justify-between ${
                    isDragTarget ? 'bg-purple-50/60 ring-2 ring-purple-400 ring-inset' : 'bg-white'
                  }`}
                >
                  <div className="space-y-2">
                    {/* Render scheduled posts on this day */}
                    {dayPosts.map((post) => {
                      const postTime = new Date(post.scheduledTime).toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      });

                      return (
                        <div
                          key={post.id}
                          draggable={post.status !== 'PUBLISHED'}
                          onDragStart={(e) => handleDragStart(e, post.id)}
                          onClick={() => setSelectedPost(post)}
                          className="p-2.5 rounded-lg border border-slate-200 bg-white hover:border-slate-400 shadow-2xs hover:shadow-xs cursor-pointer transition space-y-1.5 group select-none"
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-slate-700 flex items-center gap-1">
                              {getMediaIcon(post.mediaType)}
                              <span>{postTime}</span>
                            </span>
                            {getStatusBadge(post.status)}
                          </div>

                          <p className="text-xs text-slate-800 line-clamp-2 leading-snug">
                            {post.caption || 'No caption'}
                          </p>

                          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                            <span className="font-mono">@{post.accountHandle}</span>
                            <span className="uppercase text-[9px] font-bold text-slate-500">
                              {post.platform}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* AI Optimal Slot Suggestion Card */}
                    {daySlot && (
                      <div
                        onClick={() => handleOpenScheduleForSlot(date, daySlot.hour)}
                        className="p-2 border border-dashed border-purple-200 hover:border-purple-400 rounded-lg bg-purple-50/20 hover:bg-purple-50/50 cursor-pointer transition text-left space-y-1 group"
                      >
                        <div className="flex items-center gap-1 text-[10px] font-bold text-purple-700">
                          <Sparkles className="w-3 h-3 text-purple-500" />
                          <span>Optimal Slot ({daySlot.timeFormatted})</span>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-tight">
                          Click to place post at peak window
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Quick Add Slot Button */}
                  <button
                    type="button"
                    onClick={() => handleOpenScheduleForSlot(date, 18)}
                    className="w-full py-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-800 hover:bg-slate-50 rounded border border-transparent hover:border-slate-200 transition text-center flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Schedule</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 2: MONTH VIEW */}
      {viewMode === 'month' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/70 text-center text-xs font-semibold py-2.5 text-slate-700">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
            {monthDays.map((date, idx) => {
              if (!date) {
                return <div key={idx} className="min-h-[100px] bg-slate-50/30" />;
              }

              const isToday = isSameDay(date, new Date());
              const dayPosts = posts.filter((p) => isSameDay(new Date(p.scheduledTime), date));
              const dateKey = date.toISOString().slice(0, 10);
              const isDragTarget = dragOverDate === dateKey;

              return (
                <div
                  key={idx}
                  onDragOver={(e) => handleDragOver(e, dateKey)}
                  onDrop={(e) => handleDrop(e, date, 18)}
                  className={`min-h-[100px] p-2 space-y-1.5 transition ${
                    isDragTarget ? 'bg-purple-50/60 ring-2 ring-purple-400 ring-inset' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full font-bold ${
                        isToday ? 'bg-slate-900 text-white' : 'text-slate-700'
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {dayPosts.length > 0 && (
                      <span className="text-[10px] font-mono text-slate-400">
                        {dayPosts.length} post{dayPosts.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {dayPosts.slice(0, 2).map((post) => (
                      <div
                        key={post.id}
                        draggable={post.status !== 'PUBLISHED'}
                        onDragStart={(e) => handleDragStart(e, post.id)}
                        onClick={() => setSelectedPost(post)}
                        className="px-1.5 py-1 rounded bg-slate-50 border border-slate-200 hover:border-slate-400 text-[10px] truncate cursor-pointer transition font-medium text-slate-800 flex items-center justify-between gap-1"
                      >
                        <span className="truncate">{post.caption || 'Post'}</span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            post.status === 'PUBLISHED'
                              ? 'bg-emerald-500'
                              : post.status === 'FAILED'
                              ? 'bg-rose-500'
                              : 'bg-purple-500'
                          }`}
                        />
                      </div>
                    ))}
                    {dayPosts.length > 2 && (
                      <div className="text-[9px] text-slate-400 text-center font-medium">
                        +{dayPosts.length - 2} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SCHEDULE POST MODAL */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Schedule Post</h3>
                <p className="text-xs text-slate-500">Add to calendar for automated publishing (FR-26)</p>
              </div>
              <button
                onClick={() => setShowScheduleModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreatePost} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Creator Account Handle
                  </label>
                  <input
                    type="text"
                    required
                    value={formHandle}
                    onChange={(e) => setFormHandle(e.target.value)}
                    placeholder="e.g. cristiano"
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Target Platform
                  </label>
                  <select
                    value={formPlatform}
                    onChange={(e: any) => setFormPlatform(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                  >
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Scheduled Date & Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={formDateTime}
                  onChange={(e) => setFormDateTime(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Media Type & URL (optional)
                </label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {(['image', 'video', 'carousel'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFormMediaType(t)}
                      className={`py-1 text-xs font-semibold rounded border capitalize transition ${
                        formMediaType === t
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <input
                  type="url"
                  value={formMediaUrl}
                  onChange={(e) => setFormMediaUrl(e.target.value)}
                  placeholder="https://images.unsplash.com/... or public image URL"
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-700">Caption</label>
                  <span className="text-[10px] text-slate-400 font-mono">{formCaption.length}/2200</span>
                </div>
                <textarea
                  rows={3}
                  value={formCaption}
                  onChange={(e) => setFormCaption(e.target.value)}
                  placeholder="Write your post caption here..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Hashtags (space or comma separated)
                </label>
                <input
                  type="text"
                  value={formHashtags}
                  onChange={(e) => setFormHashtags(e.target.value)}
                  placeholder="marketing socialgrowth creator"
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFormStatus(formStatus === 'SCHEDULED' ? 'DRAFT' : 'SCHEDULED')}
                    className="text-xs text-slate-600 hover:underline"
                  >
                    Mode: <span className="font-semibold">{formStatus}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowScheduleModal(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    className="px-4 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {formSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{formStatus === 'SCHEDULED' ? 'Schedule Post' : 'Save as Draft'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* POST DETAILS INSPECTOR MODAL */}
      {selectedPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">Post Details</h3>
                {getStatusBadge(selectedPost.status)}
              </div>
              <button
                onClick={() => setSelectedPost(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedPost.mediaUrl && (
              <div className="w-full h-44 rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
                <img
                  src={selectedPost.mediaUrl}
                  alt="Post preview"
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Account: <strong className="text-slate-800 font-mono">@{selectedPost.accountHandle}</strong></span>
                <span className="capitalize">Platform: <strong className="text-slate-800">{selectedPost.platform}</strong></span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <Clock className="w-3.5 h-3.5 text-purple-600" />
                <span>
                  Scheduled for: <strong className="text-slate-900">{new Date(selectedPost.scheduledTime).toLocaleString()}</strong>
                </span>
              </div>

              {selectedPost.lastError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  <span className="font-semibold block">Publishing Error (Attempt {selectedPost.retryCount}/{selectedPost.maxRetries}):</span>
                  <span className="text-[11px]">{selectedPost.lastError}</span>
                </div>
              )}

              {selectedPost.publishedPostId && (
                <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 p-2 rounded">
                  Published ID: <code className="font-mono">{selectedPost.publishedPostId}</code>
                </div>
              )}

              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {selectedPost.caption || <span className="text-slate-400 italic">No caption</span>}
                </p>
                {selectedPost.hashtags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedPost.hashtags.map((h, i) => (
                      <span key={i} className="text-[10px] text-purple-600 font-mono">
                        #{h}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Actions Toolbar */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => handleDeletePost(selectedPost.id)}
                className="text-xs font-semibold text-rose-600 hover:text-rose-800 transition flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>

              <div className="flex items-center gap-2">
                {selectedPost.status !== 'PUBLISHED' && (
                  <button
                    type="button"
                    disabled={publishingId === selectedPost.id}
                    onClick={() => handlePublishNow(selectedPost.id)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                  >
                    {publishingId === selectedPost.id ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Publishing...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Publish Now</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}