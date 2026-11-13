import { Router, Request, Response } from 'express';
import { config } from '../config.js';
import { localJobQueue } from '../lib/local-queue.js';
import fs from 'fs';
import path from 'path';

export const adminRouter = Router();

// Middleware: Admin role check (FR-06)
adminRouter.use((req: Request, res: Response, next) => {
  const adminPassword = config.adminPassword || 'admin123';
  const authHeader = req.headers['authorization'] || req.headers['x-admin-password'];
  const cookieHeader = req.headers['cookie'] || '';
  const hasCookie = cookieHeader.includes('admin_auth=true');

  const isAuthorized =
    hasCookie ||
    authHeader === adminPassword ||
    authHeader === `Bearer ${adminPassword}`;

  if (!isAuthorized) {
    return res.status(403).json({
      error: 'Forbidden: Administrator privileges required (FR-06)',
      status: 403,
    });
  }
  next();
});

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
