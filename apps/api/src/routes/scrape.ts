import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { normalizeTarget } from '../scraper/normalize.js';

export const scrapeRouter = Router();

const scrapeSchema = z.object({
  inputs: z.array(z.string().min(1)).min(1),
  maxPosts: z.number().int().positive().nullable().optional(),
  headless: z.boolean().optional().default(true),
});

scrapeRouter.post('/', async (req: Request, res: Response) => {
  const parseResult = scrapeSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      details: parseResult.error.errors,
    });
  }

  const { inputs, maxPosts, headless } = parseResult.data;
  const supabase = getSupabaseAdmin();

  const jobsToInsert = inputs.map((input) => {
    const normalized = normalizeTarget(input);
    return {
      target_type: normalized.type,
      target_input: input.trim(),
      normalized_handle: normalized.handle,
      max_posts: maxPosts || null,
      headless: headless !== undefined ? headless : true,
      status: 'queued',
    };
  });

  const { data: createdJobs, error } = await supabase
    .from('jobs')
    .insert(jobsToInsert)
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(201).json({
    message: `Enqueued ${createdJobs.length} scrape job(s).`,
    jobs: createdJobs,
  });
});
