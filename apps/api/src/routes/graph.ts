import { Router, Request, Response } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { GraphApiClient } from '../services/graph-api.js';
import { requireAuth, findUserByHandle, getUserLinkedHandleRecord } from '../lib/auth.js';
import { storeEncryptedToken } from '../lib/crypto.js';

export const graphApiRouter = Router();

// Protect all official Meta Graph operations with verified authentication
graphApiRouter.use(requireAuth);

const connectSchema = z.object({
  accessToken: z.string().min(1, 'Access Token is required'),
  instagramAccountId: z.string().optional(),
});

/**
 * POST /api/graph/connect
 * Validate Meta Graph API Access Token and ingest account data.
 * Enforces tenant ownership: prevents claiming an account linked to another user.
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
    const cleanHandle = result.handle.toLowerCase().replace(/^@/, '');
    const currentUserId = req.auth!.userId;
    const sessionsDir = path.join(config.localStorageDir, 'user_sessions');

    // Reject if another user already linked this handle (409 Conflict)
    const existingBinding = findUserByHandle(cleanHandle);
    if (existingBinding && existingBinding.userId !== currentUserId) {
      return res.status(409).json({
        error: `Conflict: Social account @${cleanHandle} is already linked to another user account.`,
        status: 409,
      });
    }

    // Associate account handle with current user session as verified via Graph API
    const userSessionFile = path.join(sessionsDir, `${currentUserId}.json`);
    let existingProfile: any = {};
    if (fs.existsSync(userSessionFile)) {
      try {
        existingProfile = JSON.parse(fs.readFileSync(userSessionFile, 'utf-8'));
      } catch {}
    }

    const updatedProfile = {
      ...existingProfile,
      userId: currentUserId,
      handle: cleanHandle,
      isVerified: true,
      verificationMethod: 'graph_api',
      updatedAt: new Date().toISOString(),
      createdAt: existingProfile.createdAt || new Date().toISOString(),
    };
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }
    fs.writeFileSync(userSessionFile, JSON.stringify(updatedProfile, null, 2));

    // Safely store encrypted access token at rest
    try {
      storeEncryptedToken(cleanHandle, accessToken);
    } catch (encErr) {
      console.error(`Failed to store encrypted token for @${cleanHandle}:`, encErr);
    }

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
