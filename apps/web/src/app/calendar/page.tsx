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

  // Load account handle and pre-filled draft from local storage
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

      // Check if a draft was handed over from recommendations
      const pendingStr = localStorage.getItem('ee_pending_schedule');
      if (pendingStr) {
        try {
          const pending = JSON.parse(pendingStr);
          if (pending.handle) {
            setActiveHandle(pending.handle);
            setFormHandle(pending.handle);
          }
          if (pending.caption) setFormCaption(pending.caption);
          if (Array.isArray(pending.hashtags)) setFormHashtags(pending.hashtags.join(' '));
          if (pending.mediaType) setFormMediaType(pending.mediaType);

          // Default time to tomorrow at 18:00
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(18, 0, 0, 0);
          const localIso = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
          setFormDateTime(localIso);
          setShowScheduleModal(true);
        } catch (e) {
          console.warn('Could not parse pending schedule:', e);
        } finally {
          localStorage.removeItem('ee_pending_schedule');
        }
      }
    }
  }, [userId]);

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const res = await api.getScheduledPosts(userId);
      if (res?.posts) {
        setPosts(res.posts);
      }
    } catch (err: any) {
      console.error('Failed to load scheduled posts:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecommendations = async () => {
    try {
      const res = await api.getRecommendedSlots(activeHandle);
      const slots = res?.slots || res?.recommendations;
      if (slots && Array.isArray(slots)) {
        setRecommendedSlots(slots);
      }
    } catch (err) {
      console.warn('Could not load schedule recommendations:', err);
    }
  };

  useEffect(() => {
    if (isLoaded) {
      fetchPosts();
    }
  }, [isLoaded, userId]);

  useEffect(() => {
    if (activeHandle) {
      fetchRecommendations();
    }
  }, [activeHandle]);

  // Calendar Date Navigation
  const prevPeriod = () => {
    const next = new Date(currentDate);
    if (viewMode === 'week') {
      next.setDate(next.getDate() - 7);
    } else {
      next.setMonth(next.getMonth() - 1);
    }
    setCurrentDate(next);
  };

  const nextPeriod = () => {
    const next = new Date(currentDate);
    if (viewMode === 'week') {
      next.setDate(next.getDate() + 7);
    } else {
      next.setMonth(next.getMonth() + 1);
    }
    setCurrentDate(next);
  };

  const jumpToToday = () => {
    setCurrentDate(new Date());
  };

  // Helper to generate the 7 dates of the currently selected week (starting Monday)
  const getWeekDates = (date: Date): Date[] => {
    const start = new Date(date);
    const day = start.getDay();
    const diff = (day + 6) % 7; // Monday index is 0
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);

    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  };

  // Helper to generate days of the current month
  const getMonthDays = (date: Date): (Date | null)[] => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const days: (Date | null)[] = [];
    const firstDayIndex = (firstDay.getDay() + 6) % 7;

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

  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

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
      setPosts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, scheduledTime: targetTime.toISOString() } : p))
      );
      await api.reschedulePost(id, targetTime.toISOString(), userId);
    } catch (err: any) {
      console.error('Drag reschedule failed:', err);
      fetchPosts();
    } finally {
      setDraggedPostId(null);
    }
  };

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
      const scheduledUtc = new Date(formDateTime).toISOString();
      await api.createScheduledPost({
        userId,
        accountHandle: formHandle.trim().toLowerCase().replace(/^@/, ''),
        caption: formCaption.trim(),
        hashtags: tags,
        mediaUrl: formMediaUrl.trim() || undefined,
        mediaType: formMediaType,
        platform: formPlatform,
        scheduledTime: scheduledUtc,
        status: formStatus,
      });

      setShowScheduleModal(false);
      fetchPosts();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create scheduled post');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeletePost = async (id: string) => {
    if (!confirm('Are you sure you want to remove this post from the calendar?')) return;
    try {
      await api.deleteScheduledPost(id, userId);
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setSelectedPost(null);
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handlePublishNow = async (id: string) => {
    setPublishingId(id);
    try {
      const res = await api.publishPostNow(id, userId);
      if (res?.post) {
        setPosts((prev) => prev.map((p) => (p.id === id ? res.post : p)));
        setSelectedPost(res.post);
      } else {
        fetchPosts();
      }
    } catch (err: any) {
      alert(`Publish failed: ${err.message}`);
      fetchPosts();
    } finally {
      setPublishingId(null);
    }
  };

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

  const getStatusBadge = (status: ScheduledPost['status']) => {
    switch (status) {
      case 'PUBLISHED':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-neutral-900 bg-neutral-100 border border-neutral-300 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="w-3 h-3 text-neutral-900" />
            Published
          </span>
        );
      case 'PUBLISHING':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-neutral-900 bg-neutral-100 border border-neutral-300 px-1.5 py-0.5 rounded animate-pulse">
            <Loader2 className="w-3 h-3 text-neutral-900 animate-spin" />
            Publishing...
          </span>
        );
      case 'SCHEDULED':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-neutral-800 bg-neutral-50 border border-neutral-200 px-1.5 py-0.5 rounded">
            <Clock className="w-3 h-3 text-neutral-700" />
            Scheduled
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-neutral-900 bg-neutral-200 border border-neutral-400 px-1.5 py-0.5 rounded">
            <AlertTriangle className="w-3 h-3 text-neutral-900" />
            Failed
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-neutral-500 bg-neutral-100 border border-neutral-200 px-1.5 py-0.5 rounded">
            <XCircle className="w-3 h-3 text-neutral-400" />
            Cancelled
          </span>
        );
      case 'DRAFT':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-neutral-600 bg-neutral-50 border border-neutral-200 px-1.5 py-0.5 rounded">
            Draft
          </span>
        );
    }
  };

  const getMediaIcon = (type: ScheduledPost['mediaType']) => {
    switch (type) {
      case 'video':
        return <Video className="w-3 h-3 text-neutral-700" />;
      case 'carousel':
        return <Layers className="w-3 h-3 text-neutral-700" />;
      case 'image':
      default:
        return <ImageIcon className="w-3 h-3 text-neutral-700" />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      {/* Top Header & Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Content Calendar</h1>
            <span className="text-[10px] bg-neutral-100 text-neutral-700 border border-neutral-200 font-mono px-1.5 py-0.5 rounded">
              FR-25 / FR-26
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Weekly and monthly scheduling with drag-and-drop and AI-calibrated windows.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Run Tick / Queue Button */}
          <button
            onClick={handleTriggerTick}
            disabled={ticking}
            title="Evaluate and publish due posts right now (Tick runner)"
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-black bg-white text-black hover:bg-black hover:text-white transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${ticking ? 'animate-spin' : ''}`} />
            <span>Check Queue</span>
          </button>

          {/* New Post Button */}
          <button
            onClick={() => handleOpenScheduleForSlot(new Date(), 18)}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-black rounded-md hover:bg-neutral-800 transition flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Schedule Post</span>
          </button>
        </div>
      </div>

      {tickMessage && (
        <div className="text-xs bg-black text-white px-3 py-2 rounded-md flex items-center justify-between">
          <span>✓ {tickMessage}</span>
          <button onClick={() => setTickMessage(null)} className="text-neutral-400 hover:text-white">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Calendar Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white border border-neutral-200 rounded-lg">
        <div className="flex items-center gap-2">
          <button
            onClick={prevPeriod}
            className="p-1 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={jumpToToday}
            className="px-2.5 py-1 text-xs font-semibold text-neutral-800 border border-neutral-200 rounded hover:bg-neutral-50 transition"
          >
            Today
          </button>
          <button
            onClick={nextPeriod}
            className="p-1 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded transition"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <span className="text-sm font-bold text-neutral-900 ml-2">
            {currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-neutral-100 p-0.5 rounded border border-neutral-200 text-xs">
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1 rounded font-semibold transition ${
                viewMode === 'week' ? 'bg-black text-white' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Week View
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1 rounded font-semibold transition ${
                viewMode === 'month' ? 'bg-black text-white' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Month View
            </button>
          </div>
        </div>
      </div>

      {/* AI Optimal Posting Slots Banner */}
      {recommendedSlots.length > 0 && (
        <div className="p-4 rounded-lg border border-neutral-200 bg-neutral-50 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-neutral-700" />
              <h3 className="text-xs font-bold text-neutral-900">Optimal Slots (QUBO Model)</h3>
              <span className="text-[10px] text-neutral-700 bg-neutral-200 font-mono px-1.5 py-0.5 rounded">
                FR-25 Overlay
              </span>
            </div>
            <span className="text-[11px] text-neutral-500">Click any slot to schedule directly</span>
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
                className="p-2.5 bg-white border border-neutral-200 hover:border-black rounded text-left transition group"
              >
                <div className="flex items-center justify-between text-xs font-bold text-neutral-900">
                  <span>{slot.dayOfWeek}</span>
                  <span className="text-[10px] text-neutral-500 font-mono">{slot.confidenceScore}% conf</span>
                </div>
                <div className="text-xs font-semibold text-neutral-800 mt-0.5 group-hover:underline">
                  {slot.timeFormatted}
                </div>
                <p className="text-[10px] text-neutral-400 truncate mt-1">{slot.rationale}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 1: WEEK VIEW */}
      {viewMode === 'week' && (
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-7 border-b border-neutral-200 bg-neutral-50 text-center text-xs font-semibold">
            {weekDays.map((date, idx) => {
              const isToday = isSameDay(date, new Date());
              return (
                <div
                  key={idx}
                  className={`py-3 px-2 border-r border-neutral-100 last:border-r-0 ${
                    isToday ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-700'
                  }`}
                >
                  <div className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">
                    {date.toLocaleDateString(undefined, { weekday: 'short' })}
                  </div>
                  <div
                    className={`inline-flex items-center justify-center w-6 h-6 mt-1 rounded-full text-xs font-bold ${
                      isToday ? 'bg-black text-white' : 'text-neutral-800'
                    }`}
                  >
                    {date.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Week Grid Slots */}
          <div className="grid grid-cols-7 min-h-[500px] divide-x divide-neutral-100">
            {weekDays.map((date, colIdx) => {
              const dayPosts = posts.filter((p) => isSameDay(new Date(p.scheduledTime), date));
              const dateKey = date.toISOString().slice(0, 10);
              const isDragTarget = dragOverDate === dateKey;

              const daySlot = recommendedSlots.find((s) => s.dayIndex === date.getDay());

              return (
                <div
                  key={colIdx}
                  onDragOver={(e) => handleDragOver(e, dateKey)}
                  onDrop={(e) => handleDrop(e, date, daySlot ? daySlot.hour : 18)}
                  className={`p-2 space-y-2 transition flex flex-col justify-between ${
                    isDragTarget ? 'bg-neutral-100 ring-2 ring-neutral-900 ring-inset' : 'bg-white'
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
                          className="p-2 rounded border border-neutral-200 bg-white hover:border-black cursor-pointer transition space-y-1.5 select-none"
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-neutral-800 flex items-center gap-1 font-mono">
                              {getMediaIcon(post.mediaType)}
                              <span>{postTime}</span>
                            </span>
                            {getStatusBadge(post.status)}
                          </div>

                          <p className="text-xs text-neutral-800 line-clamp-2 leading-snug">
                            {post.caption || 'No caption'}
                          </p>

                          <div className="flex items-center justify-between text-[10px] text-neutral-400 pt-0.5">
                            <span className="font-mono">@{post.accountHandle}</span>
                            <span className="uppercase text-[9px] font-bold text-neutral-600 font-mono">
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
                        className="p-2 border border-dashed border-neutral-300 hover:border-black rounded bg-neutral-50/50 hover:bg-neutral-100 cursor-pointer transition text-left space-y-0.5 group"
                      >
                        <div className="flex items-center gap-1 text-[10px] font-bold text-neutral-800">
                          <Sparkles className="w-3 h-3 text-neutral-600" />
                          <span>Optimal Slot ({daySlot.timeFormatted})</span>
                        </div>
                        <p className="text-[10px] text-neutral-400 leading-tight">
                          Click to place post at peak window
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Quick Add Slot Button */}
                  <button
                    type="button"
                    onClick={() => handleOpenScheduleForSlot(date, 18)}
                    className="w-full py-1.5 text-[11px] font-medium text-neutral-400 hover:text-black hover:bg-neutral-50 rounded border border-transparent hover:border-neutral-200 transition text-center flex items-center justify-center gap-1"
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
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-7 border-b border-neutral-200 bg-neutral-50 text-center text-xs font-semibold py-2 text-neutral-700">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 divide-x divide-y divide-neutral-100">
            {monthDays.map((date, idx) => {
              if (!date) {
                return <div key={idx} className="min-h-[90px] bg-neutral-50/40" />;
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
                  className={`min-h-[90px] p-2 space-y-1.5 transition ${
                    isDragTarget ? 'bg-neutral-100 ring-2 ring-neutral-900 ring-inset' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full font-bold text-xs ${
                        isToday ? 'bg-black text-white' : 'text-neutral-700'
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {dayPosts.length > 0 && (
                      <span className="text-[10px] font-mono text-neutral-400">
                        {dayPosts.length}
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
                        className="px-1.5 py-1 rounded bg-neutral-50 border border-neutral-200 hover:border-black text-[10px] truncate cursor-pointer transition font-medium text-neutral-800 flex items-center justify-between gap-1"
                      >
                        <span className="truncate">{post.caption || 'Post'}</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-900 shrink-0" />
                      </div>
                    ))}
                    {dayPosts.length > 2 && (
                      <div className="text-[9px] text-neutral-400 text-center font-medium">
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
          <div className="bg-white border border-neutral-200 rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-neutral-900">Schedule Post</h3>
                <p className="text-xs text-neutral-500">Add to calendar for automated publishing (FR-26)</p>
              </div>
              <button
                onClick={() => setShowScheduleModal(false)}
                className="text-neutral-400 hover:text-black p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="text-xs text-neutral-900 bg-neutral-100 border border-neutral-300 rounded p-2.5">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreatePost} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-neutral-700 block mb-1">
                    Creator Account Handle
                  </label>
                  <input
                    type="text"
                    required
                    value={formHandle}
                    onChange={(e) => setFormHandle(e.target.value)}
                    placeholder="e.g. cristiano"
                    className="w-full px-3 py-1.5 text-xs border border-neutral-300 rounded focus:outline-none focus:border-black"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-neutral-700 block mb-1">
                    Target Platform
                  </label>
                  <select
                    value={formPlatform}
                    onChange={(e: any) => setFormPlatform(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-neutral-300 rounded focus:outline-none focus:border-black bg-white"
                  >
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-700 block mb-1">
                  Scheduled Date & Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={formDateTime}
                  onChange={(e) => setFormDateTime(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-neutral-300 rounded focus:outline-none focus:border-black"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-700 block mb-1">
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
                          ? 'bg-black text-white border-black'
                          : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
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
                  className="w-full px-3 py-1.5 text-xs border border-neutral-300 rounded focus:outline-none focus:border-black"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-neutral-700">Caption</label>
                  <span className="text-[10px] text-neutral-400 font-mono">{formCaption.length}/2200</span>
                </div>
                <textarea
                  rows={3}
                  value={formCaption}
                  onChange={(e) => setFormCaption(e.target.value)}
                  placeholder="Write your post caption here..."
                  className="w-full px-3 py-2 text-xs border border-neutral-300 rounded focus:outline-none focus:border-black resize-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-700 block mb-1">
                  Hashtags (space or comma separated)
                </label>
                <input
                  type="text"
                  value={formHashtags}
                  onChange={(e) => setFormHashtags(e.target.value)}
                  placeholder="marketing socialgrowth creator"
                  className="w-full px-3 py-1.5 text-xs border border-neutral-300 rounded focus:outline-none focus:border-black"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFormStatus(formStatus === 'SCHEDULED' ? 'DRAFT' : 'SCHEDULED')}
                    className="text-xs text-neutral-600 hover:underline"
                  >
                    Mode: <span className="font-semibold">{formStatus}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowScheduleModal(false)}
                    className="px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-black"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    className="px-4 py-1.5 text-xs font-semibold rounded-md border border-black bg-white text-black hover:bg-black hover:text-white transition flex items-center gap-1.5 disabled:opacity-50"
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
          <div className="bg-white border border-neutral-200 rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-neutral-900">Post Details</h3>
                {getStatusBadge(selectedPost.status)}
              </div>
              <button
                onClick={() => setSelectedPost(null)}
                className="text-neutral-400 hover:text-black p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedPost.mediaUrl && (
              <div className="w-full h-44 rounded overflow-hidden bg-neutral-100 border border-neutral-200">
                <img
                  src={selectedPost.mediaUrl}
                  alt="Post preview"
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span>Account: <strong className="text-neutral-800 font-mono">@{selectedPost.accountHandle}</strong></span>
                <span className="capitalize">Platform: <strong className="text-neutral-800">{selectedPost.platform}</strong></span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-neutral-700">
                <Clock className="w-3.5 h-3.5 text-neutral-700" />
                <span>
                  Scheduled for: <strong className="text-neutral-900">{new Date(selectedPost.scheduledTime).toLocaleString()}</strong>
                </span>
              </div>

              {selectedPost.lastError && (
                <div className="p-2.5 rounded bg-neutral-100 border border-neutral-300 text-xs text-neutral-800">
                  <span className="font-semibold block">Publishing Error (Attempt {selectedPost.retryCount}/{selectedPost.maxRetries}):</span>
                  <span className="text-[11px] font-mono">{selectedPost.lastError}</span>
                </div>
              )}

              {selectedPost.publishedPostId && (
                <div className="text-xs text-neutral-900 bg-neutral-100 border border-neutral-200 p-2 rounded">
                  Published ID: <code className="font-mono">{selectedPost.publishedPostId}</code>
                </div>
              )}

              <div className="p-3 bg-neutral-50 border border-neutral-200 rounded">
                <p className="text-xs text-neutral-800 whitespace-pre-wrap leading-relaxed">
                  {selectedPost.caption || <span className="text-neutral-400 italic">No caption</span>}
                </p>
                {selectedPost.hashtags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedPost.hashtags.map((h, i) => (
                      <span key={i} className="text-[10px] text-neutral-600 font-mono">
                        #{h}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Actions Toolbar */}
            <div className="flex items-center justify-between pt-3 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => handleDeletePost(selectedPost.id)}
                className="text-xs font-semibold text-neutral-600 hover:text-black transition flex items-center gap-1"
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
                    className="px-3 py-1.5 text-xs font-semibold rounded-md border border-black bg-white text-black hover:bg-black hover:text-white transition flex items-center gap-1.5 disabled:opacity-50"
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
