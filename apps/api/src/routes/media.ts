import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { sanitizeAndValidateHandle } from '../lib/security.js';

export const mediaRouter = Router();

function resolveLocalMediaPath(filePath: string): string | null {
  const baseMediaDir = path.resolve(config.localStorageDir, 'post-media');
  let clean = filePath.replace(/^\/+/, '');
  if (clean.startsWith('post-media/')) {
    clean = clean.slice('post-media/'.length);
  }
  const resolved = path.resolve(baseMediaDir, clean);
  // Security check: strictly prevent directory traversal outside baseMediaDir
  if (!resolved.startsWith(baseMediaDir)) {
    return null;
  }
  if (fs.existsSync(resolved)) {
    if (fs.statSync(resolved).isFile()) {
      return resolved;
    }
    // If it's a directory (e.g. handle/shortcode), check for 0.jpg
    const candidate = path.join(resolved, '0.jpg');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

// GET /api/media/signed-url?path=...
mediaRouter.get('/signed-url', async (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: 'Query parameter "path" is required' });
  }

  // Check if file is stored locally on PC
  const local = resolveLocalMediaPath(filePath);
  if (local) {
    return res.json({ signedUrl: `/api/media/image?path=${encodeURIComponent(filePath)}` });
  }

  // Fallback to Supabase signed URL
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from('post-media')
      .createSignedUrl(filePath, 3600); // 1 hour

    if (error || !data) {
      return res.status(404).json({ error: error?.message || 'Could not create signed URL' });
    }

    return res.json({ signedUrl: data.signedUrl });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/media/image?path=...
// Streams media file directly from the local disk storage folder (or Supabase fallback)
mediaRouter.get('/image', async (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).send('Query parameter "path" is required');
  }

  // 1. Check local PC disk storage first
  const localPath = resolveLocalMediaPath(filePath);
  if (localPath) {
    const ext = path.extname(localPath).toLowerCase();
    const contentType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return fs.createReadStream(localPath).pipe(res);
  }

  // 2. Fallback: try fetching from Supabase Storage, and cache to local disk if found
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage.from('post-media').download(filePath);

    if (!error && data) {
      const buffer = Buffer.from(await data.arrayBuffer());
      const baseMediaDir = path.resolve(config.localStorageDir, 'post-media');
      const clean = filePath.replace(/^\/+/, '').replace(/^post-media\//, '');
      const cachePath = path.resolve(baseMediaDir, clean);
      if (cachePath.startsWith(baseMediaDir)) {
        try {
          fs.mkdirSync(path.dirname(cachePath), { recursive: true });
          fs.writeFileSync(cachePath, buffer);
        } catch {}
      }

      res.setHeader('Content-Type', data.type || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return res.send(buffer);
    }
  } catch {}

  // 3. Fallback: try fetching from media_urls in storage/posts/{handle}.json if available
  try {
    const clean = filePath.replace(/^\/+/, '').replace(/^post-media\//, '');
    const parts = clean.split('/');
    if (parts.length >= 2) {
      const handle = parts[0];
      const shortcode = parts[1];
      const postsFile = path.join(config.localStorageDir, 'posts', `${handle}.json`);
      if (fs.existsSync(postsFile)) {
        const posts = JSON.parse(fs.readFileSync(postsFile, 'utf-8'));
        if (Array.isArray(posts)) {
          const match = posts.find((p: any) => p.shortcode === shortcode);
          const mediaUrl = match?.mediaUrls?.[0] || match?.media_urls?.[0];
          if (mediaUrl && typeof mediaUrl === 'string' && mediaUrl.startsWith('http')) {
            const fetchRes = await fetch(mediaUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(4000),
            });
            if (fetchRes.ok) {
              const buffer = Buffer.from(await fetchRes.arrayBuffer());
              const baseMediaDir = path.resolve(config.localStorageDir, 'post-media');
              const cachePath = path.join(baseMediaDir, handle, shortcode, '0.jpg');
              if (cachePath.startsWith(baseMediaDir)) {
                try {
                  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
                  fs.writeFileSync(cachePath, buffer);
                } catch {}
              }
              res.setHeader('Content-Type', fetchRes.headers.get('content-type') || 'image/jpeg');
              res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
              return res.send(buffer);
            }
          }
        }
      }
    }
  } catch {}

  return res.status(404).send('Image not found in post-media storage');
});

// GET /api/media/avatar?handle=...
// Streams cached creator avatar, first post preview, or generated initials SVG avatar
mediaRouter.get('/avatar', async (req: Request, res: Response) => {
  const handleQuery = req.query.handle as string;
  if (!handleQuery) {
    return res.status(400).send('Query parameter "handle" is required');
  }

  let cleanHandle: string;
  try {
    cleanHandle = sanitizeAndValidateHandle(handleQuery);
  } catch {
    return res.status(400).send('Invalid handle');
  }

  const baseMediaDir = path.resolve(config.localStorageDir, 'post-media');

  // 1. Check if avatar.jpg exists directly in creator's folder
  const avatarPath = path.join(baseMediaDir, cleanHandle, 'avatar.jpg');
  if (fs.existsSync(avatarPath) && fs.statSync(avatarPath).isFile()) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return fs.createReadStream(avatarPath).pipe(res);
  }

  // 1.5. Fallback: if avatar.jpg does not exist, try downloading from profile avatar_url
  const profileFile = path.join(config.localStorageDir, 'profiles', `${cleanHandle}.json`);
  if (fs.existsSync(profileFile)) {
    try {
      const pData = JSON.parse(fs.readFileSync(profileFile, 'utf-8'));
      const avatarUrl = pData.avatarUrl || pData.avatar_url;
      if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.startsWith('http')) {
        const fetchRes = await fetch(avatarUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(4000),
        });
        if (fetchRes.ok) {
          const buffer = Buffer.from(await fetchRes.arrayBuffer());
          fs.mkdirSync(path.dirname(avatarPath), { recursive: true });
          fs.writeFileSync(avatarPath, buffer);
          res.setHeader('Content-Type', fetchRes.headers.get('content-type') || 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
          return res.send(buffer);
        }
      }
    } catch {}
  }

  // 2. Fallback: check if the creator has any post thumbnail on disk
  const creatorDir = path.join(baseMediaDir, cleanHandle);
  if (fs.existsSync(creatorDir) && fs.statSync(creatorDir).isDirectory()) {
    try {
      const postFolders = fs.readdirSync(creatorDir);
      for (const folder of postFolders) {
        const candidate = path.join(creatorDir, folder, '0.jpg');
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
          return fs.createReadStream(candidate).pipe(res);
        }
      }
    } catch {}
  }

  // 3. Fallback: generate and serve a clean SVG avatar with creator initial
  const initial = (cleanHandle[0] || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">
  <rect width="100%" height="100%" fill="#373E3E" rx="75"/>
  <text x="50%" y="55%" font-family="system-ui, -apple-system, sans-serif" font-size="64" font-weight="700" fill="#ffffff" dominant-baseline="middle" text-anchor="middle">${initial}</text>
</svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  return res.send(svg);
});

