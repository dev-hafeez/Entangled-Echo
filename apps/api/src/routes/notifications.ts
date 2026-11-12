import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { config } from '../config.js';
import { notificationStore, NotificationType } from '../services/notifications.js';
import { renderWeeklyDigestHtml } from '../services/email.js';

export const notificationsRouter = Router();

// GET /api/notifications?userId=... - List notifications & unread count
notificationsRouter.get('/', (req: Request, res: Response) => {
  const userId = (req.query.userId as string) || 'default_user';
  const notifications = notificationStore.getNotifications(userId);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return res.json({
    success: true,
    unreadCount,
    notifications,
  });
});

// PATCH /api/notifications/:id/read - Mark one notification as read
notificationsRouter.patch('/:id/read', (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = (req.body.userId as string) || (req.query.userId as string) || 'default_user';

  const updated = notificationStore.markAsRead(userId, id);
  return res.json({ success: updated });
});

// POST /api/notifications/mark-all-read - Mark all as read
notificationsRouter.post('/mark-all-read', (req: Request, res: Response) => {
  const userId = (req.body.userId as string) || 'default_user';
  notificationStore.markAllAsRead(userId);
  return res.json({ success: true });
});

// GET /api/notifications/preferences?userId=... - Get user preferences (FR-35)
notificationsRouter.get('/preferences', (req: Request, res: Response) => {
  const userId = (req.query.userId as string) || 'default_user';
  const preferences = notificationStore.getPreferences(userId);
  return res.json({ success: true, preferences });
});

// PUT /api/notifications/preferences - Update preferences (FR-35)
notificationsRouter.put('/preferences', (req: Request, res: Response) => {
  const { userId, ...updates } = req.body;
  const uid = userId || 'default_user';
  const preferences = notificationStore.updatePreferences(uid, updates);
  return res.json({ success: true, preferences });
});

// POST /api/notifications/create - Emit an in-app alert (FR-33)
notificationsRouter.post('/create', async (req: Request, res: Response) => {
  const { userId, type, title, message, link, emailRecipient } = req.body;
  if (!title || !message) {
    return res.status(400).json({ error: 'title and message are required' });
  }

  const result = await notificationStore.createNotification({
    userId: userId || 'default_user',
    type: (type as NotificationType) || 'ai_insight',
    title,
    message,
    link,
    emailRecipient,
  });

  return res.json({ success: true, ...result });
});

// POST /api/notifications/digest/trigger - Send weekly email digest (FR-34)
notificationsRouter.post('/digest/trigger', async (req: Request, res: Response) => {
  const { userId, handle, email } = req.body;
  if (!handle || !email) {
    return res.status(400).json({ error: 'handle and email are required' });
  }

  const result = await notificationStore.triggerWeeklyDigest(userId || 'default_user', handle, email);
  return res.json({
    success: result.success,
    message: result.success ? `Weekly digest successfully sent to <${email}>` : 'Email digest opted out or failed.',
    messageId: result.messageId,
  });
});

// GET /api/notifications/digest/preview - Preview the weekly digest email HTML for an existing ingested account
notificationsRouter.get('/digest/preview', (req: Request, res: Response) => {
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
      const posts = JSON.parse(fs.readFileSync(postFile, 'utf-8'));
      if (Array.isArray(posts) && posts.length > 0) {
        if (!postsCount) postsCount = posts.length;
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
  });

  res.setHeader('Content-Type', 'text/html');
  return res.send(html);
});
