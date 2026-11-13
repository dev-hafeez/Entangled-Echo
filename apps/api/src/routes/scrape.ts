import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { normalizeTarget } from '../scraper/normalize.js';
import { localJobQueue } from '../lib/local-queue.js';
import { createRateLimiter } from '../lib/security.js';

export const scrapeRouter = Router();

// Rate limit scrape submissions (max 20 requests per minute per IP)
scrapeRouter.use(createRateLimiter({ windowMs: 60000, maxRequests: 20, message: 'Scrape job submission rate limit exceeded' }));

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

  const jobsToInsert = inputs.map((input) => {
    const normalized = normalizeTarget(input);
    return {
      target_type: normalized.type as 'handle' | 'profile_url' | 'post_url',
      target_input: input.trim(),
      normalized_handle: normalized.handle || input.trim(),
      max_posts: maxPosts !== undefined && maxPosts !== null ? maxPosts : 60,
      headless: headless !== undefined ? headless : true,
    };
  });

  // Enqueue locally instantly (sub-millisecond, zero timeout, supports 2,000+ jobs)
  const enqueuedJobs = localJobQueue.enqueue(jobsToInsert);

  return res.status(201).json({
    message: `Enqueued ${enqueuedJobs.length} scrape job(s) successfully.`,
    count: enqueuedJobs.length,
    jobs: enqueuedJobs,
  });
});
