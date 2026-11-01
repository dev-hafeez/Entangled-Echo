import { Router, Request, Response } from 'express';
import { getSupabaseAdmin } from '../lib/supabase.js';

export const accountsRouter = Router();

// GET /api/accounts - List all accounts with completeness metrics
accountsRouter.get('/', async (req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();

  const { data: accounts, error: accErr } = await supabase
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false });

  if (accErr) {
    return res.status(500).json({ error: accErr.message });
  }

  // Compute data completeness per account
  const enrichedAccounts = await Promise.all(
    (accounts || []).map(async (acc) => {
      const { data: posts } = await supabase
        .from('posts')
        .select('id, caption, posted_at')
        .eq('account_id', acc.id);

      const totalPosts = posts?.length || 0;
      if (totalPosts === 0) {
        return {
          ...acc,
          total_posts_collected: 0,
          completeness: {
            likes_rate: 0,
            timestamp_rate: 0,
            caption_rate: 0,
            overall_rate: 0,
          },
        };
      }

      const postIds = posts!.map((p) => p.id);
      const { data: snapshots } = await supabase
        .from('post_snapshots')
        .select('post_id, likes_count, comments_count')
        .in('post_id', postIds);

      const snapshotMap = new Map<string, any>();
      if (snapshots) {
        for (const s of snapshots) {
          snapshotMap.set(s.post_id, s);
        }
      }

      let realLikes = 0;
      let realTimestamps = 0;
      let realCaptions = 0;

      for (const p of posts!) {
        const snap = snapshotMap.get(p.id);
        if (snap?.likes_count !== null && snap?.likes_count !== undefined) {
          realLikes++;
        }
        if (p.posted_at !== null && p.posted_at !== undefined) {
          realTimestamps++;
        }
        if (p.caption && p.caption.trim().length > 0) {
          realCaptions++;
        }
      }

      const likesRate = Math.round((realLikes / totalPosts) * 100);
      const timestampRate = Math.round((realTimestamps / totalPosts) * 100);
      const captionRate = Math.round((realCaptions / totalPosts) * 100);
      const overallRate = Math.round((likesRate + timestampRate + captionRate) / 3);

      return {
        ...acc,
        total_posts_collected: totalPosts,
        completeness: {
          likes_rate: likesRate,
          timestamp_rate: timestampRate,
          caption_rate: captionRate,
          overall_rate: overallRate,
        },
      };
    })
  );

  return res.json({ accounts: enrichedAccounts });
});

// GET /api/accounts/:handle - Profile and snapshots
accountsRouter.get('/:handle', async (req: Request, res: Response) => {
  const { handle } = req.params;
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');
  const supabase = getSupabaseAdmin();

  const { data: account, error: accErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('handle', cleanHandle)
    .single();

  if (accErr || !account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  // Get snapshots
  const { data: snapshots } = await supabase
    .from('account_snapshots')
    .select('*')
    .eq('account_id', account.id)
    .order('collected_at', { ascending: false });

  return res.json({
    account,
    snapshots: snapshots || [],
  });
});

// GET /api/accounts/:handle/posts - Grid of posts with metric details & sources
accountsRouter.get('/:handle/posts', async (req: Request, res: Response) => {
  const { handle } = req.params;
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');
  const supabase = getSupabaseAdmin();

  const { data: account, error: accErr } = await supabase
    .from('accounts')
    .select('id, handle')
    .eq('handle', cleanHandle)
    .single();

  if (accErr || !account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  const { data: posts, error: postErr } = await supabase
    .from('posts')
    .select('*')
    .eq('account_id', account.id)
    .order('posted_at', { ascending: false, nullsFirst: false });

  if (postErr) {
    return res.status(500).json({ error: postErr.message });
  }

  const postIds = (posts || []).map((p) => p.id);
  const { data: snapshots } = await supabase
    .from('post_snapshots')
    .select('*')
    .in('post_id', postIds)
    .order('collected_at', { ascending: false });

  const snapshotMap = new Map<string, any>();
  if (snapshots) {
    for (const s of snapshots) {
      if (!snapshotMap.has(s.post_id)) {
        snapshotMap.set(s.post_id, s);
      }
    }
  }

  const enrichedPosts = (posts || []).map((p) => {
    const snap = snapshotMap.get(p.id);
    return {
      ...p,
      likes_count: snap?.likes_count ?? null,
      likes_source: snap?.likes_source ?? null,
      comments_count: snap?.comments_count ?? null,
      comments_source: snap?.comments_source ?? null,
      views_count: snap?.views_count ?? null,
      views_source: snap?.views_source ?? null,
    };
  });

  return res.json({ posts: enrichedPosts });
});
