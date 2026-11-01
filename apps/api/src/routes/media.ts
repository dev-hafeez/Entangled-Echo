import { Router, Request, Response } from 'express';
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
