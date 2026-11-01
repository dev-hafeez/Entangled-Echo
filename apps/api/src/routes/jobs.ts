import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';

export const jobsRouter = Router();

// GET /api/jobs - List all jobs
jobsRouter.get('/', async (req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const [{ count: totalCount }, { data, error }] = await Promise.all([
    supabase.from('jobs').select('*', { count: 'exact', head: true }),
    supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ jobs: data || [], total: totalCount ?? data?.length ?? 0 });
});

// POST /api/jobs/:id/retry - Retry a failed or cancelled job
jobsRouter.post('/:id/retry', async (req: Request, res: Response) => {
  const { id } = req.params;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: 'queued',
      error: null,
      failure_reason: null,
      locked_at: null,
      heartbeat_at: null,
      started_at: null,
      finished_at: null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ success: true, job: data });
});

// POST /api/jobs/:id/cancel - Cancel a queued or running job
jobsRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  const { id } = req.params;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: 'cancelled',
      finished_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ success: true, job: data });
});

// DELETE /api/jobs/:id - Delete a single job from the queue
jobsRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('jobs')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ success: true, message: `Job ${id} deleted.` });
});

// DELETE /api/jobs - Clear jobs (supports type=completed | queued | all)
jobsRouter.delete('/', async (req: Request, res: Response) => {
  const type = ((req.query.type as string) || 'completed').toLowerCase();
  const supabase = getSupabaseAdmin();

  let statuses: string[] = ['done', 'failed', 'cancelled'];
  if (type === 'queued') {
    statuses = ['queued'];
  } else if (type === 'all') {
    statuses = ['queued', 'running', 'done', 'failed', 'partial', 'cancelled'];
  }

  try {
    let deletedCount = 0;
    while (true) {
      const { data, error } = await supabase
        .from('jobs')
        .delete()
        .in('status', statuses)
        .select('id')
        .limit(1000);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      const count = data?.length || 0;
      deletedCount += count;
      if (count === 0 || count < 1000) break;
    }

    return res.json({
      success: true,
      message: `Cleared ${deletedCount} job(s) (${type}).`,
      deletedCount,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
