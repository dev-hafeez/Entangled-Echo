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

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from('post-media')
    .createSignedUrl(filePath, 3600); // 1 hour

  if (error || !data) {
    return res.status(404).json({ error: error?.message || 'Could not create signed URL' });
  }

  return res.json({ signedUrl: data.signedUrl });
});

// GET /api/media/image?path=...
// Streams media file from local storage first, then private post-media Supabase bucket
mediaRouter.get('/image', async (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).send('Query parameter "path" is required');
  }

  // 1. Check local filesystem storage (with path traversal security)
  const baseDir = path.resolve(config.localStorageDir, 'post-media');
  const localFile = path.resolve(baseDir, filePath);

  if (localFile.startsWith(baseDir) && fs.existsSync(localFile)) {
    const stat = fs.statSync(localFile);
    if (stat.isFile()) {
      const ext = path.extname(localFile).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return fs.createReadStream(localFile).pipe(res);
    }
  }

  // 2. Fallback to Supabase Storage
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage.from('post-media').download(filePath);

    if (error || !data) {
      return res.status(404).send('Image not found in post-media storage');
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    res.setHeader('Content-Type', data.type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return res.send(buffer);
  } catch {
    return res.status(404).send('Image not found in post-media storage');
  }
});

// GET /api/media/avatar?handle=...
// Streams creator's stored avatar image; downloads and stores locally if only external URL exists
mediaRouter.get('/avatar', async (req: Request, res: Response) => {
  const handle = req.query.handle as string;
  if (!handle) {
    return res.status(400).send('Query parameter "handle" is required');
  }

  const cleanHandle = handle.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._-]/g, '');
  const baseDir = path.resolve(config.localStorageDir, 'post-media');
  const avatarDir = path.join(baseDir, cleanHandle);
  const localAvatarFile = path.join(avatarDir, 'avatar.jpg');

  // 1. Return existing stored avatar if present
  if (fs.existsSync(localAvatarFile)) {
    const stat = fs.statSync(localAvatarFile);
    if (stat.isFile() && stat.size > 0) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return fs.createReadStream(localAvatarFile).pipe(res);
    }
  }

  // 2. Check profile file for external avatar_url and download it to local storage
  const profilePath = path.join(config.localStorageDir, 'profiles', `${cleanHandle}.json`);
  if (fs.existsSync(profilePath)) {
    try {
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      if (profile.avatar_url && typeof profile.avatar_url === 'string' && profile.avatar_url.startsWith('http')) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const downloadRes = await fetch(profile.avatar_url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          },
        }).finally(() => clearTimeout(timeoutId));

        if (downloadRes.ok) {
          const arrayBuf = await downloadRes.arrayBuffer();
          const buf = Buffer.from(arrayBuf);
          if (buf.length > 0) {
            fs.mkdirSync(avatarDir, { recursive: true });
            fs.writeFileSync(localAvatarFile, buf);
            res.setHeader('Content-Type', downloadRes.headers.get('content-type') || 'image/jpeg');
            res.setHeader('Content-Length', buf.length);
            res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
            return res.send(buf);
          }
        }
      }
    } catch (e: any) {
      console.warn(`[media] Failed to download external avatar for ${cleanHandle}:`, e.message);
    }
  }

  // 3. Fallback: check if any stored post media exists for this creator and cache as avatar
  if (fs.existsSync(avatarDir)) {
    try {
      const subEntries = fs.readdirSync(avatarDir, { withFileTypes: true });
      for (const entry of subEntries) {
        if (entry.isDirectory()) {
          const candidatePath = path.join(avatarDir, entry.name, '0.jpg');
          if (fs.existsSync(candidatePath)) {
            const stat = fs.statSync(candidatePath);
            if (stat.isFile() && stat.size > 0) {
              fs.copyFileSync(candidatePath, localAvatarFile);
              res.setHeader('Content-Type', 'image/jpeg');
              res.setHeader('Content-Length', stat.size);
              res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
              return fs.createReadStream(localAvatarFile).pipe(res);
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[media] Fallback post avatar failed for ${cleanHandle}:`, e.message);
    }
  }

  // 4. Fallback: avatar not available
  return res.status(404).send('Avatar not available');
});
