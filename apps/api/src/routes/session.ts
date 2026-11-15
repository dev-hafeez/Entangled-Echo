import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { config } from '../config.js';
import { runCanaryCheck } from '../scraper/canary.js';
import { requireAdmin } from '../lib/auth.js';

export const sessionRouter = Router();

// Enforce FR-06: Internal scraper session inspection requires verified administrator privileges
sessionRouter.use(requireAdmin);

// GET /api/session/status - Check whether Instagram session is authenticated & active
sessionRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const profileDir = config.playwrightProfileDir;
    if (!fs.existsSync(profileDir)) {
      return res.json({
        authenticated: false,
        reason: 'Chromium profile directory does not exist yet',
        cookieNames: [],
      });
    }

    const browser = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const cookies = await browser.cookies('https://www.instagram.com');
      const cookieNames = cookies.map((c) => c.name);
      const hasSession = cookieNames.includes('sessionid');
      const hasDsUserId = cookieNames.includes('ds_user_id');

      if (!hasSession || !hasDsUserId) {
        await browser.close();
        return res.json({
          authenticated: false,
          hasSession,
          hasDsUserId,
          reason: 'Missing sessionid or ds_user_id cookies',
          cookieNames,
        });
      }

      await browser.close();
      return res.json({
        authenticated: true,
        hasSession: true,
        hasDsUserId: true,
        cookieNames: cookieNames.sort(),
        timestamp: new Date().toISOString(),
      });
    } catch (innerErr: any) {
      await browser.close().catch(() => {});
      return res.json({
        authenticated: false,
        reason: innerErr.message,
        cookieNames: [],
      });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/session/canary - Run pre-flight extraction canary on 3 known posts
sessionRouter.get('/canary', async (req: Request, res: Response) => {
  try {
    const canaryResult = await runCanaryCheck();
    return res.json(canaryResult);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/session/curated-list - Return the curated deep-scrape list
sessionRouter.get('/curated-list', (req: Request, res: Response) => {
  try {
    const listPath = path.join(config.projectRoot, 'scripts', 'curated_deep_scrape_list.json');
    if (!fs.existsSync(listPath)) {
      return res.status(404).json({ error: 'Curated list file not found' });
    }
    const data = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
