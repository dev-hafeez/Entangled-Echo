import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { schedulerService } from '../services/scheduler.js';

export const calendarRouter = Router();

const createPostSchema = z.object({
  userId: z.string().default('default_user'),
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

// GET /api/calendar/posts - List scheduled posts for user/handle
calendarRouter.get('/posts', (req: Request, res: Response) => {
  const userId = (req.query.userId as string) || 'default_user';
  const handle = req.query.handle as string | undefined;

  const posts = schedulerService.listPosts(userId, handle);
  return res.json({ success: true, count: posts.length, posts });
});

// GET /api/calendar/posts/:id - Single scheduled post
calendarRouter.get('/posts/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = (req.query.userId as string) || 'default_user';

  const post = schedulerService.getPost(id, userId);
  if (!post) return res.status(404).json({ error: 'Scheduled post not found' });
  return res.json({ success: true, post });
});

// POST /api/calendar/posts - Schedule a new post
calendarRouter.post('/posts', (req: Request, res: Response) => {
  const parse = createPostSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.errors[0]?.message || 'Invalid payload' });
  }

  const post = schedulerService.createPost(parse.data.userId, parse.data);
  return res.status(201).json({ success: true, post });
});

// PATCH /api/calendar/posts/:id - Update post content or status
calendarRouter.patch('/posts/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = (req.body.userId as string) || 'default_user';

  try {
    const post = schedulerService.updatePost(id, userId, req.body);
    return res.json({ success: true, post });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// PATCH /api/calendar/posts/:id/reschedule - Fast reschedule (for drag-and-drop)
calendarRouter.patch('/posts/:id/reschedule', (req: Request, res: Response) => {
  const { id } = req.params;
  const { newScheduledTime, userId } = req.body;

  if (!newScheduledTime) {
    return res.status(400).json({ error: 'newScheduledTime is required' });
  }

  try {
    const post = schedulerService.reschedulePost(id, userId || 'default_user', newScheduledTime);
    return res.json({ success: true, post });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/calendar/posts/:id/publish - Trigger immediate publish
calendarRouter.post('/posts/:id/publish', async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = (req.body.userId as string) || 'default_user';
  const forceError = Boolean(req.body.forceError);

  try {
    const post = await schedulerService.publishPost(id, userId, forceError);
    return res.json({ success: true, post });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/calendar/posts/:id - Delete or cancel a scheduled post
calendarRouter.delete('/posts/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = (req.query.userId as string) || (req.body.userId as string) || 'default_user';

  const deleted = schedulerService.deletePost(id, userId);
  if (!deleted) return res.status(404).json({ error: 'Scheduled post not found or already deleted' });
  return res.json({ success: true, message: 'Scheduled post deleted' });
});

// GET /api/calendar/slots/recommended - Optimal scheduling slots for creator
calendarRouter.get('/slots/recommended', (req: Request, res: Response) => {
  const handle = (req.query.handle as string)?.toLowerCase().replace(/^@/, '');
  if (!handle) {
    return res.status(400).json({ error: 'handle parameter is required' });
  }

  const slots = schedulerService.getRecommendedSlots(handle);
  return res.json({ success: true, handle, slots });
});

// POST /api/calendar/tick - Trigger publishing ticker check
calendarRouter.post('/tick', async (req: Request, res: Response) => {
  try {
    const result = await schedulerService.runTick();
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});