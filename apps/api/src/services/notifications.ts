import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { emailProvider, renderWeeklyDigestHtml } from '../services/email.js';

export type NotificationType =
  | 'publish_success'
  | 'publish_failure'
  | 'reminder'
  | 'milestone'
  | 'ai_insight';

export interface InAppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPreferences {
  userId: string;
  inAppPublish: boolean;
  inAppReminders: boolean;
  inAppMilestones: boolean;
  inAppAiInsights: boolean;
  emailDigest: boolean;
  emailMilestones: boolean;
  emailPublishFailures: boolean;
  updatedAt: string;
}

export const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'userId' | 'updatedAt'> = {
  inAppPublish: true,
  inAppReminders: true,
  inAppMilestones: true,
  inAppAiInsights: true,
  emailDigest: true,
  emailMilestones: true,
  emailPublishFailures: true,
};

export class NotificationStore {
  private notificationsDir: string;
  private preferencesDir: string;

  constructor() {
    this.notificationsDir = path.join(config.localStorageDir, 'notifications');
    this.preferencesDir = path.join(config.localStorageDir, 'notification_preferences');

    if (!fs.existsSync(this.notificationsDir)) fs.mkdirSync(this.notificationsDir, { recursive: true });
    if (!fs.existsSync(this.preferencesDir)) fs.mkdirSync(this.preferencesDir, { recursive: true });
  }

  private getUserNotifFile(userId: string): string {
    return path.join(this.notificationsDir, `${userId}.json`);
  }

  private getUserPrefFile(userId: string): string {
    return path.join(this.preferencesDir, `${userId}.json`);
  }

  /**
   * Get preferences for a user
   */
  getPreferences(userId: string): NotificationPreferences {
    const file = this.getUserPrefFile(userId);
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
      } catch {}
    }

    const defaultPrefs: NotificationPreferences = {
      userId,
      ...DEFAULT_PREFERENCES,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(file, JSON.stringify(defaultPrefs, null, 2));
    return defaultPrefs;
  }

  /**
   * Save or update preferences
   */
  updatePreferences(userId: string, partial: Partial<NotificationPreferences>): NotificationPreferences {
    const current = this.getPreferences(userId);
    const updated: NotificationPreferences = {
      ...current,
      ...partial,
      userId,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.getUserPrefFile(userId), JSON.stringify(updated, null, 2));
    return updated;
  }

  /**
   * Get all in-app notifications for user
   */
  getNotifications(userId: string): InAppNotification[] {
    const file = this.getUserNotifFile(userId);
    if (fs.existsSync(file)) {
      try {
        const list = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (Array.isArray(list)) return list;
      } catch {}
    }
    return [];
  }

  /**
   * Create an in-app notification (respecting preferences)
   */
  async createNotification(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    emailRecipient?: string;
  }): Promise<{ created: boolean; notification?: InAppNotification; emailSent?: boolean }> {
    const { userId, type, title, message, link, emailRecipient } = params;
    const prefs = this.getPreferences(userId);

    // Check in-app preference gate (FR-35)
    let shouldCreateInApp = true;
    if (type === 'publish_success' && !prefs.inAppPublish) shouldCreateInApp = false;
    if (type === 'publish_failure' && !prefs.inAppPublish) shouldCreateInApp = false;
    if (type === 'reminder' && !prefs.inAppReminders) shouldCreateInApp = false;
    if (type === 'milestone' && !prefs.inAppMilestones) shouldCreateInApp = false;
    if (type === 'ai_insight' && !prefs.inAppAiInsights) shouldCreateInApp = false;

    let newNotif: InAppNotification | undefined;
    if (shouldCreateInApp) {
      const all = this.getNotifications(userId);
      newNotif = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId,
        type,
        title,
        message,
        link,
        isRead: false,
        createdAt: new Date().toISOString(),
      };
      all.unshift(newNotif);
      fs.writeFileSync(this.getUserNotifFile(userId), JSON.stringify(all.slice(0, 50), null, 2));
    }

    // Check email preference gate
    let emailSent = false;
    if (emailRecipient) {
      let shouldSendEmail = false;
      if (type === 'publish_failure' && prefs.emailPublishFailures) shouldSendEmail = true;
      if (type === 'milestone' && prefs.emailMilestones) shouldSendEmail = true;

      if (shouldSendEmail) {
        await emailProvider.send({
          to: emailRecipient,
          subject: `[EntangledEcho] ${title}`,
          text: message,
          html: `<p><strong>${title}</strong></p><p>${message}</p>`,
          type: type === 'milestone' ? 'milestone' : 'publish_failure',
        });
        emailSent = true;
      }
    }

    return { created: shouldCreateInApp, notification: newNotif, emailSent };
  }

  /**
   * Mark a single notification as read
   */
  markAsRead(userId: string, notificationId: string): boolean {
    const all = this.getNotifications(userId);
    const item = all.find((n) => n.id === notificationId);
    if (!item) return false;
    item.isRead = true;
    fs.writeFileSync(this.getUserNotifFile(userId), JSON.stringify(all, null, 2));
    return true;
  }

  /**
   * Mark all notifications as read
   */
  markAllAsRead(userId: string): void {
    const all = this.getNotifications(userId);
    for (const n of all) n.isRead = true;
    fs.writeFileSync(this.getUserNotifFile(userId), JSON.stringify(all, null, 2));
  }

  /**
   * Trigger weekly performance email digest (FR-34)
   */
  async triggerWeeklyDigest(userId: string, handle: string, emailTo: string): Promise<{ success: boolean; messageId?: string }> {
    const prefs = this.getPreferences(userId);
    if (!prefs.emailDigest) {
      console.log(`[Digest] User ${userId} has opted out of weekly email digests.`);
      return { success: false };
    }

    // Read profile & posts data
    const profFile = path.join(config.localStorageDir, 'profiles', `${handle.toLowerCase()}.json`);
    const postFile = path.join(config.localStorageDir, 'posts', `${handle.toLowerCase()}.json`);

    let followers = 0;
    let postsCount = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let topPostCaption = '';
    let topPostLikes = 0;

    if (fs.existsSync(profFile)) {
      try {
        const p = JSON.parse(fs.readFileSync(profFile, 'utf-8'));
        followers = p.followers_count || 0;
        postsCount = p.posts_count || 0;
      } catch {}
    }

    if (fs.existsSync(postFile)) {
      try {
        const posts = JSON.parse(fs.readFileSync(postFile, 'utf-8'));
        if (Array.isArray(posts) && posts.length > 0) {
          for (const post of posts) {
            const likes = post.likesCount ?? post.likes_count ?? 0;
            const comments = post.commentsCount ?? post.comments_count ?? 0;
            totalLikes += likes;
            totalComments += comments;

            if (likes > topPostLikes) {
              topPostLikes = likes;
              topPostCaption = post.caption || '';
            }
          }
        }
      } catch {}
    }

    const n = Math.max(postsCount, 1);
    const avgER = followers > 0 ? (((totalLikes + totalComments) / followers) * 100).toFixed(2) : '0.00';

    const html = renderWeeklyDigestHtml({
      handle,
      followersCount: followers,
      totalPosts: postsCount,
      totalLikes,
      totalComments,
      avgEngagementRate: avgER,
      topPostCaption,
      topPostLikes,
      milestones: followers > 100000 ? ['Crossed the 100K follower milestone!'] : undefined,
    });

    const res = await emailProvider.send({
      to: emailTo,
      subject: `Your Weekly Performance Digest for @${handle}`,
      html,
      text: `Weekly Performance Digest for @${handle}: ${followers} followers, ${avgER}% average engagement.`,
      type: 'weekly_digest',
    });

    return { success: res.success, messageId: res.messageId };
  }
}

export const notificationStore = new NotificationStore();
