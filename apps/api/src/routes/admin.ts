import { Router, Request, Response } from 'express';
import { config } from '../config.js';
import { localJobQueue } from '../lib/local-queue.js';
import { requireAdmin } from '../lib/auth.js';
import fs from 'fs';
import path from 'path';

export const adminRouter = Router();

// Middleware: Strict verified Admin role check (FR-06)
adminRouter.use(requireAdmin);

/**
 * GET /api/admin/status
 * Administrative system overview
 */
adminRouter.get('/status', (req: Request, res: Response) => {
  const postsDir = path.join(config.localStorageDir, 'posts');
  const accountsDir = path.join(config.localStorageDir, 'profiles');

  const accountsCount = fs.existsSync(accountsDir) ? fs.readdirSync(accountsDir).length : 0;
  const postsFiles = fs.existsSync(postsDir) ? fs.readdirSync(postsDir).length : 0;

  return res.json({
    status: 'ok',
    admin: true,
    totalAccountsTracked: accountsCount,
    postDataFiles: postsFiles,
    serverUptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  });
});

/**
 * GET /api/admin/queue
 * Administrative job queue metrics
 */
adminRouter.get('/queue', (req: Request, res: Response) => {
  const result = localJobQueue.queryJobs({ limit: 10 });
  return res.json({
    status: 'ok',
    summary: result.summary,
    pagination: result.pagination,
  });
});
