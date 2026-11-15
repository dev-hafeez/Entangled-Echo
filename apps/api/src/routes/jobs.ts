import { Router, Request, Response } from 'express';
import { localJobQueue } from '../lib/local-queue.js';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { requireUserOrAdmin, requireAdmin } from '../lib/auth.js';

export const jobsRouter = Router();

// GET /api/jobs - List jobs with filtering, pagination, and status summaries (instant local lookup)
jobsRouter.get('/', requireUserOrAdmin, async (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'all';
  const search = ((req.query.search as string) || '').trim();
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(500, Math.max(10, parseInt((req.query.limit as string) || '100', 10)));

  const result = localJobQueue.queryJobs({ status, search, page, limit });
  return res.json({
    ...result,
    isPaused: localJobQueue.getPaused(),
  });
});

// POST /api/jobs/pause - Pause queue processing
jobsRouter.post('/pause', requireAdmin, (req: Request, res: Response) => {
  localJobQueue.setPaused(true);
  return res.json({ success: true, isPaused: true, message: 'Scrape queue paused. No more queued jobs will be claimed.' });
});

// POST /api/jobs/resume - Resume queue processing
jobsRouter.post('/resume', requireAdmin, (req: Request, res: Response) => {
  localJobQueue.setPaused(false);
  return res.json({ success: true, isPaused: false, message: 'Scrape queue resumed.' });
});

// POST /api/jobs/:id/retry - Retry a failed or cancelled job
jobsRouter.post('/:id/retry', requireUserOrAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const success = localJobQueue.retryJob(id);
  return res.json({ success, message: `Job ${id} queued for retry.` });
});

// POST /api/jobs/:id/cancel - Cancel a queued or running job
jobsRouter.post('/:id/cancel', requireUserOrAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const success = localJobQueue.cancelJob(id);
  return res.json({ success, message: `Job ${id} cancelled.` });
});

// DELETE /api/jobs/:id - Delete a single job from the queue
jobsRouter.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const success = localJobQueue.deleteJob(id);
  return res.json({ success, message: `Job ${id} deleted.` });
});

// DELETE /api/jobs - Clear jobs (supports type=completed | queued | all)
jobsRouter.delete('/', requireAdmin, async (req: Request, res: Response) => {
  const type = ((req.query.type as string) || 'completed').toLowerCase() as 'completed' | 'queued' | 'all';
  const deletedCount = localJobQueue.clearJobs(type);

  return res.json({
    success: true,
    message: `Cleared ${deletedCount} job(s) (${type}).`,
    deletedCount,
  });
});
