import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';
import { notificationStore } from './notifications.js';
import { emailProvider } from './email.js';
import { GraphApiClient } from './graph-api.js';
import { writeJsonAtomic } from '../lib/atomic-file.js';

export type PostStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';
export type MediaType = 'image' | 'video' | 'carousel';
export type SocialPlatform = 'instagram' | 'facebook';

export interface ScheduledPost {
  id: string;
  userId: string;
  accountHandle: string;
  caption: string;
  hashtags: string[];
  mediaUrl?: string;
  mediaType: MediaType;
  platform: SocialPlatform;
  scheduledTime: string; // ISO 8601
  status: PostStatus;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  publishedAt: string | null;
  publishedPostId: string | null;
  aiSuggestedSlot?: boolean;
  confidenceScore?: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecommendedSlot {
  dayOfWeek: string; // e.g. "Wednesday"
  dayIndex: number;  // 0-6 (Sun-Sat)
  hour: number;      // 0-23
  timeFormatted: string; // e.g. "6:00 PM"
  confidenceScore: number; // 0-100
  isGenericPrior: boolean;
  rationale: string;
}

const VALID_TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  DRAFT: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['DRAFT', 'SCHEDULED', 'PUBLISHING', 'CANCELLED'],
  PUBLISHING: ['PUBLISHED', 'FAILED', 'SCHEDULED'],
  FAILED: ['SCHEDULED', 'DRAFT', 'CANCELLED'],
  PUBLISHED: [],
  CANCELLED: ['DRAFT', 'SCHEDULED'],
};

export class SchedulerService {
  private baseDir: string;

  constructor() {
    this.baseDir = path.join(config.localStorageDir, 'scheduled_posts');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getUserFile(userId: string): string {
    const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baseDir, `${safeUser}.json`);
  }

  /**
   * Validate state transition per SRDS 5.5
   */
  private canTransition(from: PostStatus, to: PostStatus): boolean {
    if (from === to) return true;
    const allowed = VALID_TRANSITIONS[from] || [];
    return allowed.includes(to);
  }

  /**
   * List scheduled posts for a user
   */
  listPosts(userId: string, handle?: string): ScheduledPost[] {
    const file = this.getUserFile(userId);
    if (!fs.existsSync(file)) return [];
    try {
      const posts: ScheduledPost[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!Array.isArray(posts)) return [];
      if (handle) {
        const clean = handle.toLowerCase().replace(/^@/, '');
        return posts.filter((p) => p.accountHandle.toLowerCase() === clean);
      }
      return posts.sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
    } catch {
      return [];
    }
  }

  /**
   * Get a single scheduled post by ID
   */
  getPost(id: string, userId: string): ScheduledPost | null {
    const posts = this.listPosts(userId);
    return posts.find((p) => p.id === id) || null;
  }

  /**
   * Create and schedule a new post
   */
  createPost(
    userId: string,
    params: {
      accountHandle: string;
      caption: string;
      hashtags?: string[];
      mediaUrl?: string;
      mediaType?: MediaType;
      platform?: SocialPlatform;
      scheduledTime: string;
      status?: PostStatus;
      aiSuggestedSlot?: boolean;
      confidenceScore?: number;
    }
  ): ScheduledPost {
    const now = new Date().toISOString();
    const targetStatus = params.status || 'SCHEDULED';

    const post: ScheduledPost = {
      id: `sp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      userId,
      accountHandle: params.accountHandle.toLowerCase().replace(/^@/, ''),
      caption: params.caption || '',
      hashtags: params.hashtags || [],
      mediaUrl: params.mediaUrl || '',
      mediaType: params.mediaType || 'image',
      platform: params.platform || 'instagram',
      scheduledTime: new Date(params.scheduledTime).toISOString(),
      status: targetStatus,
      retryCount: 0,
      maxRetries: 3,
      lastError: null,
      publishedAt: null,
      publishedPostId: null,
      aiSuggestedSlot: !!params.aiSuggestedSlot,
      confidenceScore: params.confidenceScore || 85,
      createdAt: now,
      updatedAt: now,
    };

    const file = this.getUserFile(userId);
    const existing = this.listPosts(userId);
    existing.push(post);
    writeJsonAtomic(file, existing);

    return post;
  }

  /**
   * Update post fields and status with transition enforcement
   */
  updatePost(id: string, userId: string, updates: Partial<ScheduledPost>): ScheduledPost {
    const file = this.getUserFile(userId);
    const posts = this.listPosts(userId);
    const index = posts.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new Error(`Scheduled post not found: ${id}`);
    }

    const current = posts[index];

    // Enforce transition rules
    if (updates.status && updates.status !== current.status) {
      if (!this.canTransition(current.status, updates.status)) {
        throw new Error(`Illegal state transition from ${current.status} to ${updates.status}`);
      }
    }

    const updated: ScheduledPost = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    posts[index] = updated;
    writeJsonAtomic(file, posts);
    return updated;
  }

  /**
   * Reschedule post (for Drag and Drop on calendar)
   */
  reschedulePost(id: string, userId: string, newScheduledTime: string): ScheduledPost {
    const post = this.getPost(id, userId);
    if (!post) throw new Error(`Scheduled post not found: ${id}`);

    if (post.status === 'PUBLISHED') {
      throw new Error('Cannot reschedule an already published post');
    }

    return this.updatePost(id, userId, {
      scheduledTime: new Date(newScheduledTime).toISOString(),
      status: 'SCHEDULED',
      retryCount: 0,
      lastError: null,
    });
  }

  /**
   * Delete or cancel a scheduled post
   */
  deletePost(id: string, userId: string): boolean {
    const file = this.getUserFile(userId);
    const posts = this.listPosts(userId);
    const filtered = posts.filter((p) => p.id !== id);
    if (filtered.length === posts.length) return false;
    writeJsonAtomic(file, filtered);
    return true;
  }

  /**
   * Calculate AI Recommended Slots from real historical post engagement
   */
  getRecommendedSlots(handle: string): RecommendedSlot[] {
    const clean = handle.toLowerCase().replace(/^@/, '');
    const postFile = path.join(config.localStorageDir, 'posts', `${clean}.json`);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    if (fs.existsSync(postFile)) {
      try {
        const posts = JSON.parse(fs.readFileSync(postFile, 'utf-8'));
        if (Array.isArray(posts) && posts.length >= 5) {
          // Aggregate by (dayOfWeek, hour)
          const slotMap = new Map<string, { totalEng: number; count: number; day: number; hour: number }>();

          for (const post of posts) {
            const rawDate = post.postedAt || post.posted_at;
            if (!rawDate) continue;
            const d = new Date(rawDate);
            if (isNaN(d.getTime())) continue;

            const day = d.getDay();
            const hour = d.getHours();
            const key = `${day}_${hour}`;

            const likes = post.likesCount ?? post.likes_count ?? 0;
            const comments = post.commentsCount ?? post.comments_count ?? 0;
            const eng = likes + comments * 3;

            const existing = slotMap.get(key) || { totalEng: 0, count: 0, day, hour };
            existing.totalEng += eng;
            existing.count += 1;
            slotMap.set(key, existing);
          }

          if (slotMap.size > 0) {
            const ranked = Array.from(slotMap.values())
              .map((s) => ({
                day: s.day,
                hour: s.hour,
                avgEng: s.totalEng / s.count,
                count: s.count,
              }))
              .sort((a, b) => b.avgEng - a.avgEng)
              .slice(0, 4);

            return ranked.map((r, idx) => {
              const hour12 = r.hour === 0 ? 12 : r.hour > 12 ? r.hour - 12 : r.hour;
              const ampm = r.hour >= 12 ? 'PM' : 'AM';
              return {
                dayOfWeek: dayNames[r.day],
                dayIndex: r.day,
                hour: r.hour,
                timeFormatted: `${hour12}:00 ${ampm}`,
                confidenceScore: Math.min(96, Math.max(70, 92 - idx * 5)),
                isGenericPrior: false,
                rationale: `Historical peak engagement average from ${r.count} analyzed past posts on ${dayNames[r.day]}s`,
              };
            });
          }
        }
      } catch (e: any) {
        console.warn(`[Scheduler] Could not compute historical slots for ${clean}: ${e.message}`);
      }
    }

    // Generic prior fallback per Section 6.1 (labeled honestly)
    return [
      {
        dayOfWeek: 'Wednesday',
        dayIndex: 3,
        hour: 18,
        timeFormatted: '6:00 PM',
        confidenceScore: 82,
        isGenericPrior: true,
        rationale: 'Generic global industry baseline for midweek evening audience traffic',
      },
      {
        dayOfWeek: 'Thursday',
        dayIndex: 4,
        hour: 19,
        timeFormatted: '7:00 PM',
        confidenceScore: 80,
        isGenericPrior: true,
        rationale: 'Generic global industry baseline for Thursday prime engagement window',
      },
      {
        dayOfWeek: 'Friday',
        dayIndex: 5,
        hour: 20,
        timeFormatted: '8:00 PM',
        confidenceScore: 78,
        isGenericPrior: true,
        rationale: 'Generic global industry baseline for weekend kickoff surge',
      },
      {
        dayOfWeek: 'Saturday',
        dayIndex: 6,
        hour: 13,
        timeFormatted: '1:00 PM',
        confidenceScore: 75,
        isGenericPrior: true,
        rationale: 'Generic global industry baseline for weekend midday engagement',
      },
    ];
  }

  /**
   * Execute immediate or scheduled publishing
   */
  async publishPost(
    id: string,
    userId: string,
    forceErrorForTest: boolean = false,
    forceNow?: Date
  ): Promise<ScheduledPost> {
    const post = this.getPost(id, userId);
    if (!post) throw new Error(`Scheduled post not found: ${id}`);

    if (post.status === 'PUBLISHED') {
      return post;
    }

    // 1. Set to PUBLISHING
    const publishingPost = this.updatePost(id, userId, { status: 'PUBLISHING' });

    try {
      // Check for forced error test (e.g. testing FR-27 retry and FR-28 failure alert)
      if (forceErrorForTest || post.caption.includes('[fail_test]')) {
        throw new Error('Simulated Meta Graph API 500 error: Media upload timed out');
      }

      // Check if real live token is available in environment or account store
      const liveToken = process.env.META_GRAPH_ACCESS_TOKEN;
      const liveAccountId = process.env.META_IG_ACCOUNT_ID;

      let publishedId = `mock_pub_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

      if (liveToken && liveAccountId && post.mediaUrl && !post.mediaUrl.startsWith('/')) {
        const client = new GraphApiClient({ accessToken: liveToken });
        const fullCaption = `${post.caption}\n\n${(post.hashtags || []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}`.trim();
        const res = await client.publishMedia(liveAccountId, {
          imageUrl: post.mediaUrl,
          caption: fullCaption,
          mediaType: post.mediaType === 'video' ? 'video' : 'image',
        });
        publishedId = res.id;
      } else {
        // Mock publishing provider (SRDS Rule 3 / fully functional offline)
        console.log(`[Scheduler] Published post "${post.id}" for @${post.accountHandle} (${post.platform}): ID=${publishedId}`);
      }

      // 2. Mark as PUBLISHED
      const finalPost = this.updatePost(id, userId, {
        status: 'PUBLISHED',
        publishedAt: (forceNow || new Date()).toISOString(),
        publishedPostId: publishedId,
        lastError: null,
      });

      // 3. Dispatch success in-app notification (FR-33)
      await notificationStore.createNotification({
        userId,
        type: 'publish_success',
        title: 'Post Published Successfully',
        message: `Your scheduled post for @${post.accountHandle} has been published to ${post.platform}.`,
        link: '/calendar',
      });

      return finalPost;
    } catch (err: any) {
      console.error(`[Scheduler] Publishing failed for ${post.id}:`, err.message);
      const nextRetries = post.retryCount + 1;

      if (nextRetries < post.maxRetries) {
        // Exponential back-off retry (FR-27)
        const delaySeconds = Math.pow(2, nextRetries) * 30; // 60s, 120s
        const nextAttempt = new Date(Date.now() + delaySeconds * 1000).toISOString();

        return this.updatePost(id, userId, {
          status: 'SCHEDULED',
          retryCount: nextRetries,
          scheduledTime: nextAttempt,
          lastError: err.message,
        });
      } else {
        // Max retries reached -> Mark FAILED and send immediate alerts (FR-28)
        const failedPost = this.updatePost(id, userId, {
          status: 'FAILED',
          retryCount: nextRetries,
          lastError: err.message,
        });

        await notificationStore.createNotification({
          userId,
          type: 'publish_failure',
          title: 'Post Publishing Failed',
          message: `Post for @${post.accountHandle} failed to publish after ${post.maxRetries} attempts: ${err.message}`,
          link: '/calendar',
        });

        return failedPost;
      }
    }
  }

  /**
   * Automated background tick runner (/internal/tick - FR-26)
   * Evaluates due posts across all users and publishes them within 60s of scheduled time
   */
  async runTick(forceNow?: Date): Promise<{
    processed: number;
    published: number;
    failed: number;
    retrying: number;
  }> {
    const now = forceNow || new Date();
    let processed = 0;
    let published = 0;
    let failed = 0;
    let retrying = 0;

    const files = fs.readdirSync(this.baseDir).filter((f) => f.endsWith('.json'));

    for (const f of files) {
      const filePath = path.join(this.baseDir, f);
      try {
        const posts: ScheduledPost[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!Array.isArray(posts)) continue;

        for (const post of posts) {
          // Check if due and in SCHEDULED state
          if (post.status === 'SCHEDULED' && new Date(post.scheduledTime) <= now) {
            processed++;
            const result = await this.publishPost(post.id, post.userId, false, now);
            if (result.status === 'PUBLISHED') published++;
            else if (result.status === 'FAILED') failed++;
            else if (result.status === 'SCHEDULED') retrying++;
          }
        }
      } catch (err: any) {
        console.warn(`[Scheduler] Tick error processing ${f}:`, err.message);
      }
    }

    return { processed, published, failed, retrying };
  }
}

export const schedulerService = new SchedulerService();