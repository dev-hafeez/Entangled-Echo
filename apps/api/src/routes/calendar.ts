import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { schedulerService } from '../services/scheduler.js';
import { requireAuth, optionalAuth, isUserAccountOwnerOrAdmin, verifyTickSecret } from '../lib/auth.js';

export const calendarRouter = Router();

const createPostSchema = z.object({
  accountHandle: z.string().min(1, 'accountHandle is required'),
  caption: z.string().default(''),
  hashtags: z.array(z.string()).default([]),
  mediaUrl: z.string().optional().default(''),
  mediaType: z.enum(['image', 'video', 'carousel']).default('image'),
  platform: z.enum(['instagram', 'facebook']).default('instagram'),
  scheduledTime: z.string().datetime({ offset: true }).or(z.string().min(10)),
  status: z.enum(['DRAFT', 'SCHEDULED']).optional().default('SCHEDULED'),
  aiSuggestedSlot: z.boolean().optional(),
  confidenceScore: z.number().optional(),
});

// GET /api/calendar/posts - List scheduled posts for verified user
calendarRouter.get('/posts', requireAuth, (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const handle = req.query.handle as string | undefined;

  const posts = schedulerService.listPosts(userId, handle);
  return res.json({ success: true, count: posts.length, posts });
});

// GET /api/calendar/posts/:id - Single scheduled post for verified user
calendarRouter.get('/posts/:id', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.auth!.userId;

  const post = schedulerService.getPost(id, userId);
  if (!post) return res.status(404).json({ error: 'Scheduled post not found' });
  return res.json({ success: true, post });
});

// POST /api/calendar/posts - Schedule a new post for verified user
calendarRouter.post('/posts', requireAuth, (req: Request, res: Response) => {
  const parse = createPostSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.errors[0]?.message || 'Invalid payload' });
  }

  // Enforce social account ownership
  if (!isUserAccountOwnerOrAdmin(req, parse.data.accountHandle)) {
    return res.status(403).json({
      error: `Forbidden: You do not have permission to schedule posts for account @${parse.data.accountHandle}`,
      status: 403,
    });
  }

  const userId = req.auth!.userId;
  const post = schedulerService.createPost(userId, {
    ...parse.data,
  });
  return res.status(201).json({ success: true, post });
});

// PATCH /api/calendar/posts/:id - Update post content or status for verified user
calendarRouter.patch('/posts/:id', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.auth!.userId;

  // Prevent reassigning post to an unowned handle
  if (req.body && req.body.accountHandle) {
    const cleanTarget = String(req.body.accountHandle).toLowerCase().replace(/^@/, '').trim();
    if (!isUserAccountOwnerOrAdmin(req, cleanTarget)) {
      return res.status(403).json({
        error: `Forbidden: Cannot reassign post to unowned handle @${cleanTarget}`,
        status: 403,
      });
    }
  }

  try {
    const post = schedulerService.updatePost(id, userId, req.body);
    return res.json({ success: true, post });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// PATCH /api/calendar/posts/:id/reschedule - Fast reschedule for verified user
calendarRouter.patch('/posts/:id/reschedule', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.auth!.userId;
  const { newScheduledTime } = req.body;

  if (!newScheduledTime) {
    return res.status(400).json({ error: 'newScheduledTime is required' });
  }

  try {
    const post = schedulerService.reschedulePost(id, userId, newScheduledTime);
    return res.json({ success: true, post });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/calendar/posts/:id/publish - Trigger immediate publish for verified user
calendarRouter.post('/posts/:id/publish', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.auth!.userId;
  const forceError = Boolean(req.body.forceError);

  try {
    const post = await schedulerService.publishPost(id, userId, forceError);
    return res.json({ success: true, post });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/calendar/posts/:id - Delete or cancel a scheduled post for verified user
calendarRouter.delete('/posts/:id', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.auth!.userId;

  const deleted = schedulerService.deletePost(id, userId);
  if (!deleted) return res.status(404).json({ error: 'Scheduled post not found or already deleted' });
  return res.json({ success: true, message: 'Scheduled post deleted' });
});

// GET /api/calendar/slots/recommended - Optimal scheduling slots for creator
calendarRouter.get('/slots/recommended', optionalAuth, (req: Request, res: Response) => {
  const handle = (req.query.handle as string)?.toLowerCase().replace(/^@/, '');
  if (!handle) {
    return res.status(400).json({ error: 'handle parameter is required' });
  }

  const slots = schedulerService.getRecommendedSlots(handle);
  return res.json({ success: true, handle, slots });
});

// POST /api/calendar/tick - Trigger publishing ticker check (Protected with INTERNAL_TICK_SECRET)
calendarRouter.post('/tick', async (req: Request, res: Response) => {
  const tickAuth = verifyTickSecret(req);
  if (!tickAuth.authorized) {
    return res.status(tickAuth.status || 401).json({ error: tickAuth.error });
  }

  try {
    const result = await schedulerService.runTick();
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
