import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { GraphApiClient } from '../services/graph-api.js';

export const graphApiRouter = Router();

const connectSchema = z.object({
  accessToken: z.string().min(1, 'Access Token is required'),
  instagramAccountId: z.string().optional(),
});

/**
 * POST /api/graph/connect
 * Validate Meta Graph API Access Token and ingest account data
 */
graphApiRouter.post('/connect', async (req: Request, res: Response) => {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      details: parsed.error.errors,
    });
  }

  const { accessToken, instagramAccountId } = parsed.data;

  try {
    const client = new GraphApiClient({
      accessToken,
      instagramAccountId,
    });

    // Ingest account & posts
    const result = await client.ingestAccount(instagramAccountId);

    return res.json({
      success: true,
      message: `Successfully connected and ingested @${result.handle} via official Meta Graph API v19.`,
      handle: result.handle,
      postsCount: result.postsCount,
      profile: result.profile,
    });
  } catch (err: any) {
    return res.status(400).json({
      error: err.message || 'Failed to connect via Meta Graph API',
    });
  }
});

/**
 * POST /api/graph/validate-token
 * Test if an access token is valid and return associated accounts
 */
graphApiRouter.post('/validate-token', async (req: Request, res: Response) => {
  const { accessToken } = req.body;
  if (!accessToken) {
    return res.status(400).json({ error: 'accessToken is required' });
  }

  try {
    const client = new GraphApiClient({ accessToken });
    const { accountId, pageName } = await client.resolveInstagramAccountId();
    const profile = await client.fetchProfile(accountId);

    return res.json({
      valid: true,
      accountId,
      pageName,
      handle: profile.username,
      name: profile.name,
      followers: profile.followers_count,
    });
  } catch (err: any) {
    return res.status(400).json({
      valid: false,
      error: err.message,
    });
  }
});
