import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getSupabaseAdmin } from '../lib/supabase.js';

export const accountsRouter = Router();

// Helper to load accounts and completeness metrics directly from local disk
function getLocalAccounts() {
  const profilesDir = path.join(config.localStorageDir, 'profiles');
  const postsDir = path.join(config.localStorageDir, 'posts');

  if (!fs.existsSync(profilesDir)) return [];

  const files = fs.readdirSync(profilesDir).filter((f) => f.endsWith('.json'));
  const accounts: any[] = [];

  for (const f of files) {
    try {
      const fullPath = path.join(profilesDir, f);
      const acc = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      const handle = acc.handle || f.replace('.json', '');

      // Check posts file
      let totalPosts = 0;
      let realLikes = 0;
      let realTimestamps = 0;
      let realCaptions = 0;

      const postFile = path.join(postsDir, `${handle}.json`);
      if (fs.existsSync(postFile)) {
        try {
          const posts = JSON.parse(fs.readFileSync(postFile, 'utf-8'));
          if (Array.isArray(posts)) {
            totalPosts = posts.length;
            for (const p of posts) {
              const likes = p.likesCount ?? p.likes_count;
              if (likes !== null && likes !== undefined) realLikes++;
              const ts = p.postedAt ?? p.posted_at;
              if (ts !== null && ts !== undefined) realTimestamps++;
              const cap = p.caption;
              if (cap && typeof cap === 'string' && cap.trim().length > 0) realCaptions++;
            }
          }
        } catch {}
      }

      const likesRate = totalPosts > 0 ? Math.round((realLikes / totalPosts) * 100) : 0;
      const timestampRate = totalPosts > 0 ? Math.round((realTimestamps / totalPosts) * 100) : 0;
      const captionRate = totalPosts > 0 ? Math.round((realCaptions / totalPosts) * 100) : 0;
      const overallRate = totalPosts > 0 ? Math.round((likesRate + timestampRate + captionRate) / 3) : 0;

      accounts.push({
        ...acc,
        handle,
        total_posts_collected: totalPosts,
        completeness: {
          likes_rate: likesRate,
          timestamp_rate: timestampRate,
          caption_rate: captionRate,
          overall_rate: overallRate,
        },
      });
    } catch {}
  }

  // Sort by last_scraped_at descending or created_at
  accounts.sort((a, b) => {
    const timeA = new Date(a.last_scraped_at || a.created_at || 0).getTime();
    const timeB = new Date(b.last_scraped_at || b.created_at || 0).getTime();
    return timeB - timeA;
  });

  return accounts;
}

// GET /api/accounts - List all accounts with completeness metrics
accountsRouter.get('/', async (req: Request, res: Response) => {
  // 1. Always load local accounts first for sub-millisecond, zero-timeout response
  const localAccounts = getLocalAccounts();
  if (localAccounts.length > 0) {
    return res.json({ accounts: localAccounts });
  }

  // Fallback to Supabase only if local directory is empty
  try {
    const supabase = getSupabaseAdmin();
    const { data: accounts, error: accErr } = await supabase
      .from('accounts')
      .select('*')
      .order('created_at', { ascending: false });

    if (accErr) {
      return res.json({ accounts: [] });
    }

    return res.json({ accounts: accounts || [] });
  } catch (err) {
    return res.json({ accounts: [] });
  }
});

// GET /api/accounts/:handle - Profile and snapshots
accountsRouter.get('/:handle', async (req: Request, res: Response) => {
  const { handle } = req.params;
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');

  // 1. Try local storage profile first
  const profileFile = path.join(config.localStorageDir, 'profiles', `${cleanHandle}.json`);
  if (fs.existsSync(profileFile)) {
    try {
      const account = JSON.parse(fs.readFileSync(profileFile, 'utf-8'));
      return res.json({ account, snapshots: [] });
    } catch {}
  }

  // Fallback to Supabase
  try {
    const supabase = getSupabaseAdmin();
    const { data: account, error: accErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('handle', cleanHandle)
      .single();

    if (accErr || !account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    return res.json({ account, snapshots: [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/:handle/posts - Grid of posts with metric details & sources
accountsRouter.get('/:handle/posts', async (req: Request, res: Response) => {
  const { handle } = req.params;
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');

  // 1. Try local storage posts first
  const postsFile = path.join(config.localStorageDir, 'posts', `${cleanHandle}.json`);
  const profileFile = path.join(config.localStorageDir, 'profiles', `${cleanHandle}.json`);

  if (fs.existsSync(postsFile)) {
    try {
      const postsRaw = JSON.parse(fs.readFileSync(postsFile, 'utf-8'));
      let account = { handle: cleanHandle };
      if (fs.existsSync(profileFile)) {
        try {
          account = JSON.parse(fs.readFileSync(profileFile, 'utf-8'));
        } catch {}
      }

      const formattedPosts = (postsRaw || []).map((p: any) => {
        const shortcode = p.shortcode || '';
        const storagePaths = p.storagePaths || p.storage_paths || [
          `${cleanHandle}/${shortcode}/0.jpg`,
        ];

        const likes_count = p.likesCount ?? p.likes_count ?? null;
        const likes_source = p.likesSource ?? p.likes_source ?? (likes_count != null ? 'network_json' : null);
        const likes_raw_str = p.likesRawStr ?? p.likes_raw_str ?? (likes_count != null ? String(likes_count) : null);
        const comments_count = p.commentsCount ?? p.comments_count ?? null;
        const comments_source = p.commentsSource ?? p.comments_source ?? (comments_count != null ? 'network_json' : null);
        const comments_raw_str = p.commentsRawStr ?? p.comments_raw_str ?? (comments_count != null ? String(comments_count) : null);
        const views_count = p.viewsCount ?? p.views_count ?? null;
        const views_source = p.viewsSource ?? p.views_source ?? null;
        const views_raw_str = p.viewsRawStr ?? p.views_raw_str ?? null;

        return {
          id: p.id || `local-${cleanHandle}-${shortcode}`,
          shortcode,
          url: p.url || `https://www.instagram.com/p/${shortcode}/`,
          media_type: p.mediaType || p.media_type || 'image',
          media_type_source: p.mediaTypeSource || p.media_type_source || 'network_json',
          caption: p.caption || '',
          caption_source: p.captionSource || p.caption_source || 'network_json',
          hashtags: p.hashtags || [],
          mentions: p.mentions || [],
          posted_at: p.postedAt || p.posted_at || null,
          posted_at_source: p.postedAtSource || p.posted_at_source || 'network_json',
          likes_count,
          likes_source,
          likes_raw_str,
          likesCount: likes_count,
          likesSource: likes_source,
          comments_count,
          comments_source,
          comments_raw_str,
          commentsCount: comments_count,
          commentsSource: comments_source,
          views_count,
          views_source,
          views_raw_str,
          viewsCount: views_count,
          viewsSource: views_source,
          location_tag: p.locationTag || p.location_tag || null,
          location_tag_source: p.locationTagSource || p.location_tag_source || null,
          audio_name: p.audioName || p.audio_name || null,
          audio_name_source: p.audioNameSource || p.audio_name_source || null,
          carousel_size: p.carouselSize || p.carousel_size || 0,
          media_urls: p.mediaUrls || p.media_urls || [],
          storage_paths: storagePaths,
          post_snapshots: [
            {
              likes_count,
              likes_source,
              likes_raw_str,
              comments_count,
              comments_source,
              comments_raw_str,
              views_count,
              views_source,
              views_raw_str,
            },
          ],
          comments: p.topComments || p.comments || [],
        };
      });

      return res.json({ account, posts: formattedPosts });
    } catch (e: any) {
      console.warn(`[local-storage] Error reading posts for ${cleanHandle}:`, e.message);
    }
  }

  // Fallback to Supabase if not found locally
  try {
    const supabase = getSupabaseAdmin();
    const { data: account, error: accErr } = await supabase
      .from('accounts')
      .select('id, handle')
      .eq('handle', cleanHandle)
      .single();

    if (accErr || !account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const { data: posts } = await supabase
      .from('posts')
      .select(`
        *,
        post_snapshots (
          likes_count,
          likes_source,
          likes_raw_str,
          comments_count,
          comments_source,
          comments_raw_str,
          views_count,
          views_source,
          views_raw_str,
          collected_at
        ),
        comments (
          comment_id,
          author,
          text,
          likes_count,
          posted_at,
          author_source,
          text_source,
          likes_source,
          posted_at_source
        )
      `)
      .eq('account_id', account.id)
      .order('created_at', { ascending: false });

    return res.json({ account, posts: posts || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/accounts/:idOrHandle - Delete an account and its posts, snapshots, and media
accountsRouter.delete('/:idOrHandle', async (req: Request, res: Response) => {
  const { idOrHandle } = req.params;
  const clean = idOrHandle.toLowerCase().replace(/^@/, '');

  let handle = clean;
  const profilesDir = path.join(config.localStorageDir, 'profiles');
  const postsDir = path.join(config.localStorageDir, 'posts');
  const mediaDir = path.join(config.localStorageDir, 'post-media');

  // Check if target is UUID or handle
  const directProfileJson = path.join(profilesDir, `${clean}.json`);
  if (!fs.existsSync(directProfileJson)) {
    // Search profiles for matching id
    if (fs.existsSync(profilesDir)) {
      const files = fs.readdirSync(profilesDir).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        try {
          const prof = JSON.parse(fs.readFileSync(path.join(profilesDir, f), 'utf-8'));
          if (prof.id === clean || prof.handle?.toLowerCase() === clean) {
            handle = prof.handle.toLowerCase();
            break;
          }
        } catch {}
      }
    }
  }

  const profileJsonPath = path.join(profilesDir, `${handle}.json`);
  const postsJsonPath = path.join(postsDir, `${handle}.json`);
  const accountMediaDir = path.join(mediaDir, handle);

  const exists =
    fs.existsSync(profileJsonPath) ||
    fs.existsSync(postsJsonPath) ||
    fs.existsSync(accountMediaDir);

  if (!exists) {
    return res.status(404).json({ error: `Account @${handle} not found in local storage.` });
  }

  // 1. Delete local JSON files and media directory
  try {
    if (fs.existsSync(profileJsonPath)) fs.unlinkSync(profileJsonPath);
    if (fs.existsSync(postsJsonPath)) fs.unlinkSync(postsJsonPath);
    if (fs.existsSync(accountMediaDir)) fs.rmSync(accountMediaDir, { recursive: true, force: true });

    // 2. Remove any associated personal models
    const modelsJsonPath = path.join(config.localStorageDir, 'models.json');
    if (fs.existsSync(modelsJsonPath)) {
      try {
        const models = JSON.parse(fs.readFileSync(modelsJsonPath, 'utf-8'));
        if (Array.isArray(models)) {
          const filtered = models.filter((m) => m.account_handle?.toLowerCase() !== handle);
          fs.writeFileSync(modelsJsonPath, JSON.stringify(filtered, null, 2));
        }
      } catch {}
    }

    const personalModelDir = path.join(config.localStorageDir, 'models', 'personal', handle);
    if (fs.existsSync(personalModelDir)) {
      fs.rmSync(personalModelDir, { recursive: true, force: true });
    }
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to delete local account files: ${err.message}` });
  }

  return res.json({
    success: true,
    message: `Account @${handle} and all associated data deleted successfully from local storage.`,
  });
});

// GET /api/accounts/:handle/audience - FR-30 Audience Breakdown
accountsRouter.get('/:handle/audience', async (req: Request, res: Response) => {
  const { handle } = req.params;
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');
  const audienceDir = path.join(config.localStorageDir, 'audiences');
  const audiencePath = path.join(audienceDir, `${cleanHandle}.json`);

  // If real Graph API audience exists, return it
  if (fs.existsSync(audiencePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(audiencePath, 'utf-8'));
      if (data && data.source === 'graph_api') {
        return res.json({ success: true, audience: data });
      }
    } catch {}
  }

  // Do NOT fabricate synthetic numbers. Return null if no Graph API demographics exist.
  return res.json({
    success: true,
    audience: null,
    message: 'Audience demographics require an authenticated Meta Graph API connection with an account having >100 followers.',
  });
});

// GET /api/accounts/:handle/export/csv - FR-31 Data Export (CSV format)
accountsRouter.get('/:handle/export/csv', async (req: Request, res: Response) => {
  const { handle } = req.params;
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');
  const postsDir = path.join(config.localStorageDir, 'posts');
  const profilesDir = path.join(config.localStorageDir, 'profiles');

  const postsPath = path.join(postsDir, `${cleanHandle}.json`);
  const profilePath = path.join(profilesDir, `${cleanHandle}.json`);

  if (!fs.existsSync(postsPath)) {
    return res.status(404).json({ error: `No historical post data found for @${cleanHandle}` });
  }

  try {
    const posts = JSON.parse(fs.readFileSync(postsPath, 'utf-8'));
    let followers = 0;
    if (fs.existsSync(profilePath)) {
      const prof = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      followers = prof.followers_count || 0;
    }

    // Generate CSV string
    const headers = [
      'shortcode',
      'permalink',
      'media_type',
      'posted_at',
      'likes_count',
      'comments_count',
      'engagement_rate_pct',
      'caption',
      'hashtags',
      'mentions',
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = (Array.isArray(posts) ? posts : []).map((p: any) => {
      const likes = p.likesCount ?? p.likes_count ?? 0;
      const comments = p.commentsCount ?? p.comments_count ?? 0;
      const er = followers > 0 ? (((likes + comments) / followers) * 100).toFixed(4) : 'N/A';
      const caption = p.caption || '';
      const hashtags = Array.isArray(p.hashtags) ? p.hashtags.join(';') : '';
      const mentions = Array.isArray(p.mentions) ? p.mentions.join(';') : '';
      const shortcode = p.shortcode || '';
      const url = p.url || `https://www.instagram.com/p/${shortcode}/`;
      const mediaType = p.mediaType || p.media_type || 'image';
      const postedAt = p.postedAt || p.posted_at || '';

      return [
        escapeCsv(shortcode),
        escapeCsv(url),
        escapeCsv(mediaType),
        escapeCsv(postedAt),
        escapeCsv(likes),
        escapeCsv(comments),
        escapeCsv(er),
        escapeCsv(caption),
        escapeCsv(hashtags),
        escapeCsv(mentions),
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${cleanHandle}_metrics_export.csv"`);
    return res.status(200).send(csvContent);
  } catch (err: any) {
    return res.status(500).json({ error: `CSV export failed: ${err.message}` });
  }
});

// GET /api/accounts/competitors/compare - FR-32 Competitive Analysis
accountsRouter.get('/competitors/compare', async (req: Request, res: Response) => {
  const handlesQuery = req.query.handles as string;
  if (!handlesQuery) {
    return res.status(400).json({ error: 'Please provide query parameter "handles" separated by commas (e.g. ?handles=nike,adidas,puma)' });
  }

  const handles = handlesQuery
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
    .slice(0, 5); // limit to 5 competitors

  const profilesDir = path.join(config.localStorageDir, 'profiles');
  const postsDir = path.join(config.localStorageDir, 'posts');

  const competitorsData: any[] = [];

  for (const handle of handles) {
    const profFile = path.join(profilesDir, `${handle}.json`);
    const postFile = path.join(postsDir, `${handle}.json`);

    let profile: any = null;
    let posts: any[] = [];

    if (fs.existsSync(profFile)) {
      try {
        profile = JSON.parse(fs.readFileSync(profFile, 'utf-8'));
      } catch {}
    }

    if (fs.existsSync(postFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(postFile, 'utf-8'));
        if (Array.isArray(raw)) posts = raw;
      } catch {}
    }

    // Compute stats
    const followers = profile?.followers_count || 0;
    const postsCount = profile?.posts_count || posts.length;

    let totalLikes = 0;
    let totalComments = 0;
    const formatCounts: Record<string, number> = { image: 0, video: 0, carousel: 0, reel: 0 };

    for (const p of posts) {
      const likes = p.likesCount ?? p.likes_count ?? 0;
      const comments = p.commentsCount ?? p.comments_count ?? 0;
      totalLikes += likes;
      totalComments += comments;

      const fmt = (p.mediaType || p.media_type || 'image').toLowerCase();
      if (formatCounts[fmt] !== undefined) formatCounts[fmt]++;
      else formatCounts.image++;
    }

    const n = Math.max(posts.length, 1);
    const avgLikes = Math.round(totalLikes / n);
    const avgComments = Math.round(totalComments / n);
    const avgEngRate = followers > 0 ? Number((((avgLikes + avgComments) / followers) * 100).toFixed(2)) : 0;

    competitorsData.push({
      handle,
      fullName: profile?.full_name || handle,
      avatarUrl: profile?.avatar_url || null,
      bio: profile?.bio || '',
      followers,
      postsCount,
      analyzedPosts: posts.length,
      avgLikes,
      avgComments,
      avgEngRate,
      formatDistribution: formatCounts,
      dataSource: profile?.data_source || 'scraped_public',
    });
  }

  return res.json({
    success: true,
    count: competitorsData.length,
    competitors: competitorsData,
  });
});

