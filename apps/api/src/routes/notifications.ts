import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { config } from '../config.js';
import { notificationStore, NotificationType } from '../services/notifications.js';
import { renderWeeklyDigestHtml } from '../services/email.js';
import { requireAuth, optionalAuth } from '../lib/auth.js';

export const notificationsRouter = Router();

// GET /api/notifications - List notifications & unread count for verified user
notificationsRouter.get('/', requireAuth, (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const notifications = notificationStore.getNotifications(userId);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return res.json({
    success: true,
    unreadCount,
    notifications,
  });
});

// PATCH /api/notifications/:id/read - Mark one notification as read for verified user
notificationsRouter.patch('/:id/read', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.auth!.userId;

  const updated = notificationStore.markAsRead(userId, id);
  return res.json({ success: updated });
});

// POST /api/notifications/mark-all-read - Mark all as read for verified user
notificationsRouter.post('/mark-all-read', requireAuth, (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  notificationStore.markAllAsRead(userId);
  return res.json({ success: true });
});

// GET /api/notifications/preferences - Get user preferences (FR-35) for verified user
notificationsRouter.get('/preferences', requireAuth, (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const preferences = notificationStore.getPreferences(userId);
  return res.json({ success: true, preferences });
});

// PUT /api/notifications/preferences - Update preferences (FR-35) for verified user
notificationsRouter.put('/preferences', requireAuth, (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const { userId: _discarded, ...updates } = req.body;
  const preferences = notificationStore.updatePreferences(userId, updates);
  return res.json({ success: true, preferences });
});

// POST /api/notifications/create - Emit an in-app alert (FR-33) for verified user
notificationsRouter.post('/create', requireAuth, async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const { type, title, message, link, emailRecipient } = req.body;
  if (!title || !message) {
    return res.status(400).json({ error: 'title and message are required' });
  }

  const result = await notificationStore.createNotification({
    userId,
    type: (type as NotificationType) || 'ai_insight',
    title,
    message,
    link,
    emailRecipient,
  });

  return res.json({ success: true, ...result });
});

// POST /api/notifications/digest/trigger - Send weekly email digest (FR-34) for verified user
notificationsRouter.post('/digest/trigger', requireAuth, async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const { handle, email } = req.body;
  if (!handle || !email) {
    return res.status(400).json({ error: 'handle and email are required' });
  }

  const result = await notificationStore.triggerWeeklyDigest(userId, handle, email);
  return res.json({
    success: result.success,
    message: result.success ? `Weekly digest successfully sent to <${email}>` : 'Email digest opted out or failed.',
    messageId: result.messageId,
  });
});

// GET /api/notifications/digest/preview - Preview the weekly digest email HTML for an existing ingested account
notificationsRouter.get('/digest/preview', optionalAuth, (req: Request, res: Response) => {
  const handle = (req.query.handle as string)?.toLowerCase().replace(/^@/, '');
  if (!handle) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send('<p style="font-family:sans-serif;padding:24px;color:#64748b;">Specify an account handle: <code>/api/notifications/digest/preview?handle=your_account</code></p>');
  }

  const profFile = path.join(config.localStorageDir, 'profiles', `${handle}.json`);
  const postFile = path.join(config.localStorageDir, 'posts', `${handle}.json`);

  if (!fs.existsSync(profFile) && !fs.existsSync(postFile)) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(404).send(`<p style="font-family:sans-serif;padding:24px;color:#64748b;">No ingested data found for @${handle}. Ingest posts first to preview a performance digest.</p>`);
  }

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
      const posts: any[] = JSON.parse(fs.readFileSync(postFile, 'utf-8'));
      if (Array.isArray(posts) && posts.length > 0) {
        postsCount = Math.max(postsCount, posts.length);
        totalLikes = posts.reduce((sum, p) => sum + (p.likes_count || p.likesCount || 0), 0);
        totalComments = posts.reduce((sum, p) => sum + (p.comments_count || p.commentsCount || 0), 0);
        const sorted = [...posts].sort((a, b) => (b.likes_count || b.likesCount || 0) - (a.likes_count || a.likesCount || 0));
        topPostCaption = (sorted[0]?.caption || '').slice(0, 100);
        topPostLikes = sorted[0]?.likes_count || sorted[0]?.likesCount || 0;
      }
    } catch {}
  }

  const html = renderWeeklyDigestHtml({
    handle,
    followersCount: followers,
    totalPosts: postsCount,
    totalLikes,
    totalComments,
    avgEngagementRate: followers > 0 ? (((totalLikes + totalComments) / followers) * 100).toFixed(2) : '3.42',
    topPostCaption,
    topPostLikes,
  });

  res.setHeader('Content-Type', 'text/html');
  return res.send(html);
});
