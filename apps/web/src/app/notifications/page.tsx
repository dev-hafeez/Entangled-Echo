'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  Bell,
  Check,
  CheckCheck,
  Clock,
  ArrowUpRight,
  ShieldAlert,
  Loader2,
  Sliders,
  Sparkles,
} from 'lucide-react';

export default function NotificationsPage() {
  const { user, isLoaded } = useUser();
  const userId = user?.id || 'default_user';

  const [activeTab, setActiveTab] = useState<'alerts' | 'preferences'>('alerts');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  // Preferences state (FR-35)
  const [preferences, setPreferences] = useState<any>({
    inAppPublish: true,
    inAppReminders: true,
    inAppMilestones: true,
    inAppAiInsights: true,
    emailDigest: true,
    emailMilestones: true,
    emailPublishFailures: true,
  });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSavedMessage, setPrefsSavedMessage] = useState(false);

  const fetchNotifs = async () => {
    try {
      const res = await api.getNotifications(userId);
      if (res?.notifications) {
        setNotifications(res.notifications);
        setUnreadCount(res.unreadCount || 0);
      }
    } catch (e) {
      console.error('Error fetching notifications:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchPreferences = async () => {
    try {
      const res = await api.getNotificationPreferences(userId);
      if (res?.preferences) {
        setPreferences(res.preferences);
      }
    } catch (e) {
      console.error('Error fetching preferences:', e);
    }
  };

  useEffect(() => {
    if (!isLoaded) return;
    fetchNotifs();
    fetchPreferences();
  }, [isLoaded, userId]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.markNotificationRead(id, userId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (e) {
      console.error('Mark read failed:', e);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.markAllNotificationsRead(userId);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (e) {
      console.error('Mark all read failed:', e);
    }
  };

  const togglePref = async (key: string) => {
    const updated = { ...preferences, [key]: !preferences[key] };
    setPreferences(updated);
    setSavingPrefs(true);
    setPrefsSavedMessage(false);
    try {
      await api.updateNotificationPreferences(userId, updated);
      setPrefsSavedMessage(true);
      setTimeout(() => setPrefsSavedMessage(false), 2500);
    } catch (e) {
      console.error('Failed to update preferences:', e);
    } finally {
      setSavingPrefs(false);
    }
  };

  const filteredNotifications =
    filter === 'unread' ? notifications.filter((n) => !n.isRead) : notifications;

  const getIconForType = (type: string) => {
    switch (type) {
      case 'publish_success':
        return <Check className="w-4 h-4 text-neutral-800" />;
      case 'publish_failure':
        return <ShieldAlert className="w-4 h-4 text-neutral-800" />;
      case 'reminder':
        return <Clock className="w-4 h-4 text-neutral-800" />;
      case 'milestone':
      case 'ai_insight':
      default:
        return <Sparkles className="w-4 h-4 text-neutral-800" />;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 flex items-center gap-2">
            <Bell className="w-5 h-5 text-neutral-900" />
            <span>Notifications</span>
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Publishing updates, optimization alerts, and digest preferences.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center bg-neutral-100 p-0.5 rounded border border-neutral-200 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('alerts')}
            className={`px-3 py-1 rounded transition flex items-center gap-1.5 ${
              activeTab === 'alerts'
                ? 'bg-black text-white'
                : 'text-neutral-600 hover:text-black'
            }`}
          >
            <span>Alerts Feed</span>
            {unreadCount > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('preferences')}
            className={`px-3 py-1 rounded transition flex items-center gap-1.5 ${
              activeTab === 'preferences'
                ? 'bg-black text-white'
                : 'text-neutral-600 hover:text-black'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Preferences (FR-35)</span>
          </button>
        </div>
      </div>

      {/* TAB 1: Alerts Feed (FR-33) */}
      {activeTab === 'alerts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setFilter('all')}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  filter === 'all'
                    ? 'bg-black text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:text-black'
                }`}
              >
                All ({notifications.length})
              </button>
              <button
                onClick={() => setFilter('unread')}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  filter === 'unread'
                    ? 'bg-black text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:text-black'
                }`}
              >
                Unread ({unreadCount})
              </button>
            </div>

            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-neutral-600 hover:text-black transition flex items-center gap-1 font-medium"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all as read</span>
              </button>
            )}
          </div>

          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-5 h-5 animate-spin text-neutral-400 mx-auto mb-2" />
              <p className="text-xs text-neutral-400">Loading alerts...</p>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="py-16 text-center border border-dashed border-neutral-200 rounded-lg bg-neutral-50/50">
              <Bell className="w-6 h-6 text-neutral-300 mx-auto mb-2" />
              <p className="text-xs text-neutral-700 font-semibold">No alerts found</p>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                {filter === 'unread' ? 'All caught up! No unread notifications.' : 'Publishing confirmations and AI insights will appear here.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredNotifications.map((notif) => {
                const dateStr = notif.createdAt ? new Date(notif.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }) : '';

                return (
                  <div
                    key={notif.id}
                    className={`p-3.5 rounded-lg border transition flex items-start justify-between gap-4 ${
                      notif.isRead
                        ? 'bg-white border-neutral-200'
                        : 'bg-neutral-50 border-neutral-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 rounded bg-neutral-100 border border-neutral-200 shrink-0 mt-0.5">
                        {getIconForType(notif.type)}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-neutral-900">{notif.title}</h4>
                          {!notif.isRead && (
                            <span className="w-1.5 h-1.5 rounded-full bg-neutral-900" />
                          )}
                          <span className="text-[10px] text-neutral-400 font-mono">{dateStr}</span>
                        </div>
                        <p className="text-xs text-neutral-700 leading-relaxed max-w-xl">
                          {notif.message}
                        </p>
                        {notif.link && (
                          <Link
                            href={notif.link}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-900 underline pt-0.5"
                          >
                            <span>Open</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </Link>
                        )}
                      </div>
                    </div>

                    {!notif.isRead && (
                      <button
                        onClick={() => handleMarkAsRead(notif.id)}
                        className="text-[11px] font-medium text-neutral-700 hover:text-black shrink-0 border border-neutral-300 px-2 py-0.5 rounded hover:border-black transition"
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Notification Preferences (FR-35) & Email Digest (FR-34) */}
      {activeTab === 'preferences' && (
        <div className="space-y-6">
          {/* In-App Alerts Preferences */}
          <div className="p-5 rounded-lg border border-neutral-200 bg-white space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-neutral-900">In-App Notification Toggles</h3>
                <p className="text-xs text-neutral-500">Control which alerts appear in your feed</p>
              </div>
              {prefsSavedMessage && (
                <span className="text-xs text-neutral-900 font-mono flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  Saved
                </span>
              )}
            </div>

            <div className="space-y-3 pt-1">
              {[
                { key: 'inAppAiInsights', title: 'AI Optimization Insights', desc: 'Alerts when the quantum-inspired scheduler finishes calibrating' },
                { key: 'inAppPublish', title: 'Post Publishing Confirmations & Failures', desc: 'Direct notices when scheduled posts publish or require attention' },
                { key: 'inAppMilestones', title: 'Milestone Celebrations', desc: 'Notices when account reach or follower count hits new milestones' },
                { key: 'inAppReminders', title: 'Post Reminders', desc: 'Reminders 30 minutes before a scheduled post is set to publish' },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between py-2 border-b border-neutral-50 last:border-0">
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold text-neutral-900">{item.title}</span>
                    <p className="text-[11px] text-neutral-500">{item.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePref(item.key)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      preferences[item.key] ? 'bg-black' : 'bg-neutral-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        preferences[item.key] ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Email Digest & Email Alerts (FR-34) */}
          <div className="p-5 rounded-lg border border-neutral-200 bg-white space-y-4">
            <div className="border-b border-neutral-100 pb-3">
              <h3 className="text-sm font-bold text-neutral-900">Email Notifications & Weekly Digest</h3>
              <p className="text-xs text-neutral-500">Scheduled summaries and urgent alerts delivered to your inbox</p>
            </div>

            <div className="space-y-3 pt-1">
              {[
                { key: 'emailDigest', title: 'Weekly Performance Digest (Mondays 8:00 AM)', desc: 'Clean summary of weekly follower growth, engagement rates, and top-performing post' },
                { key: 'emailPublishFailures', title: 'Immediate Publishing Failure Alerts', desc: 'Instant email notice if a post fails to publish after 3 retry attempts' },
                { key: 'emailMilestones', title: 'Major Engagement Milestones', desc: 'Email celebrations for crossing key reach or follower thresholds' },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between py-2 border-b border-neutral-50 last:border-0">
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold text-neutral-900">{item.title}</span>
                    <p className="text-[11px] text-neutral-500">{item.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePref(item.key)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      preferences[item.key] ? 'bg-black' : 'bg-neutral-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        preferences[item.key] ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
