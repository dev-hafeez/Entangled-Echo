import { Router, Request, Response } from 'express';
import { z } from 'zod';
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

// GET /api/notifications/digest/preview - Preview the weekly digest email HTML
notificationsRouter.get('/digest/preview', (req: Request, res: Response) => {
  const handle = (req.query.handle as string) || 'creator';
  const html = renderWeeklyDigestHtml({
    handle,
    followersCount: 142000,
    totalPosts: 48,
    totalLikes: 825000,
    totalComments: 14200,
    avgEngagementRate: '3.42',
    topPostCaption: 'Excited to announce our newest visual campaign launching this Friday!',
    topPostLikes: 42100,
    milestones: ['Crossed 100K follower milestone (+12.4% reach)!'],
  });

  res.setHeader('Content-Type', 'text/html');
  return res.send(html);
});
