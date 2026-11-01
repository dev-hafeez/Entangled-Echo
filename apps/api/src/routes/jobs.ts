import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';

export const jobsRouter = Router();

// GET /api/jobs - List all jobs
jobsRouter.get('/', async (req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ jobs: data });
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

// DELETE /api/jobs - Clear all finished, failed, or cancelled jobs
jobsRouter.delete('/', async (req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('jobs')
    .delete()
    .in('status', ['done', 'failed', 'cancelled']);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ success: true, message: 'Cleared completed jobs.' });
});
