import { Router, Request, Response } from 'express';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { localJobQueue } from '../lib/local-queue.js';
import { config } from '../config.js';

export const jobsRouter = Router();

// GET /api/jobs - List jobs with filtering, pagination, and status summaries
jobsRouter.get('/', async (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'all';
  const search = ((req.query.search as string) || '').trim();
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) || '100', 10)));

  // 1. Query local queue (in-memory + disk-backed storage/jobs.json)
  const localResult = localJobQueue.queryJobs({ status, search, page, limit });

  // If local queue has jobs or DATA_MODE is not live, use local queue
  if (localResult.summary.total > 0 || config.dataMode !== 'live') {
    return res.json(localResult);
  }

  // 2. Fall back to Supabase if local queue is empty
  try {
    const supabase = getSupabaseAdmin();
    const offset = (page - 1) * limit;

    const [totalRes, queuedRes, runningRes, doneRes, failedRes, cancelledRes] = await Promise.all([
      supabase.from('jobs').select('*', { count: 'exact', head: true }),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'queued'),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'running'),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'done'),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).in('status', ['failed', 'partial']),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),
    ]);

    let query = supabase.from('jobs').select('*', { count: 'exact' });

    if (status && status !== 'all') {
      if (status === 'failed') {
        query = query.in('status', ['failed', 'partial']);
      } else {
        query = query.eq('status', status);
      }
    }

    if (search.length > 0) {
      const term = `%${search}%`;
      query = query.or(`target_input.ilike.${term},normalized_handle.ilike.${term}`);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count: filteredCount } = await query;

    if (!error && data) {
      const total = filteredCount ?? data.length ?? 0;
      const totalPages = Math.ceil(total / limit);

      return res.json({
        jobs: data || [],
        pagination: {
          page,
          limit,
          total,
          totalPages: totalPages > 0 ? totalPages : 1,
        },
        summary: {
          total: totalRes.count ?? 0,
          queued: queuedRes.count ?? 0,
          running: runningRes.count ?? 0,
          done: doneRes.count ?? 0,
          failed: failedRes.count ?? 0,
          cancelled: cancelledRes.count ?? 0,
        },
      });
    }
  } catch (err: any) {
    // Supabase unavailable or table empty; fall back to local result
  }

  return res.json(localResult);
});

// POST /api/jobs/:id/retry - Retry a failed or cancelled job
jobsRouter.post('/:id/retry', async (req: Request, res: Response) => {
  const { id } = req.params;

  // Retry in local queue
  const ok = localJobQueue.retryJob(id);
  const localJob = localJobQueue.getJob(id);

  // Try Supabase sync
  try {
    const supabase = getSupabaseAdmin();
    await supabase
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
      .eq('id', id);
  } catch {}

  if (ok && localJob) {
    return res.json({ success: true, job: localJob });
  }

  // Fallback check in Supabase if not in local queue
  try {
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

    if (!error && data) {
      return res.json({ success: true, job: data });
    }
  } catch {}

  return res.status(404).json({ error: `Job ${id} not found` });
});

// POST /api/jobs/:id/cancel - Cancel a queued or running job
jobsRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  const { id } = req.params;

  const ok = localJobQueue.cancelJob(id);
  const localJob = localJobQueue.getJob(id);

  try {
    const supabase = getSupabaseAdmin();
    await supabase
      .from('jobs')
      .update({
        status: 'cancelled',
        finished_at: new Date().toISOString(),
      })
      .eq('id', id);
  } catch {}

  if (ok && localJob) {
    return res.json({ success: true, job: localJob });
  }

  try {
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

    if (!error && data) {
      return res.json({ success: true, job: data });
    }
  } catch {}

  return res.status(404).json({ error: `Job ${id} not found` });
});

// DELETE /api/jobs/:id - Delete a single job from the queue
jobsRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const ok = localJobQueue.deleteJob(id);

  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('jobs').delete().eq('id', id);
  } catch {}

  return res.json({ success: true, message: `Job ${id} deleted.` });
});

// DELETE /api/jobs - Clear jobs (supports type=completed | queued | all)
jobsRouter.delete('/', async (req: Request, res: Response) => {
  const type = ((req.query.type as string) || 'completed').toLowerCase() as 'completed' | 'queued' | 'all';

  const deletedCount = localJobQueue.clearJobs(type);

  try {
    const supabase = getSupabaseAdmin();
    let statuses: string[] = ['done', 'failed', 'cancelled'];
    if (type === 'queued') {
      statuses = ['queued'];
    } else if (type === 'all') {
      statuses = ['queued', 'running', 'done', 'failed', 'partial', 'cancelled'];
    }

    await supabase.from('jobs').delete().in('status', statuses);
  } catch {}

  return res.json({
    success: true,
    message: `Cleared ${deletedCount} job(s) (${type}).`,
    deletedCount,
  });
});
