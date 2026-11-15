import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getSupabaseAdmin } from '../lib/supabase.js';

export const mediaRouter = Router();

// GET /api/media/signed-url?path=...
mediaRouter.get('/signed-url', async (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: 'Query parameter "path" is required' });
  }

  // Local URL streaming directly from local PC storage
  const localUrl = `/api/media/image?path=${encodeURIComponent(filePath)}`;
  return res.json({ signedUrl: localUrl });
});

// GET /api/media/image?path=...
// Streams media file directly from the local PC storage folder (or caches if found in Supabase)
mediaRouter.get('/image', async (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).send('Query parameter "path" is required');
  }

  const baseMediaDir = path.resolve(config.localStorageDir, 'post-media');
  const localPath = path.resolve(baseMediaDir, filePath);

  // Security check: prevent directory traversal
  if (!localPath.startsWith(baseMediaDir)) {
    return res.status(403).send('Access denied');
  }

  // 1. If stored locally, stream directly with zero latency
  if (fs.existsSync(localPath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return fs.createReadStream(localPath).pipe(res);
  }

  // 2. Fallback: try fetching from Supabase Storage once, and cache to local disk
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage.from('post-media').download(filePath);
    if (!error && data) {
      const buffer = Buffer.from(await data.arrayBuffer());
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, buffer);

      res.setHeader('Content-Type', data.type || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return res.send(buffer);
    }
  } catch {}

  return res.status(404).send('Image not found in local storage');
});
