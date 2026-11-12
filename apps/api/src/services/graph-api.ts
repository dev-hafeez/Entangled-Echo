import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { ScrapedPost, ScrapedProfile } from '../scraper/types.js';

export interface GraphApiConfig {
  accessToken: string;
  instagramAccountId?: string;
  graphVersion?: string;
}

export interface GraphApiProfile {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
}

export interface GraphApiMedia {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_product_type?: 'FEED' | 'REELS' | 'STORY';
  timestamp: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
  media_url?: string;
  thumbnail_url?: string;
  children?: {
    data: Array<{
      id: string;
      media_type: string;
      media_url?: string;
    }>;
  };
  insights?: {
    data: Array<{
      name: string;
      period: string;
      values: Array<{ value: number }>;
    }>;
  };
}

export interface AudienceDemographics {
  handle: string;
  collectedAt: string;
  source: 'graph_api';
  ageGender: Array<{
    ageRange: string;
    male: number; // percentage (0-100)
    female: number;
    other: number;
  }>;
  countries: Array<{
    country: string;
    percentage: number;
  }>;
  cities: Array<{
    city: string;
    percentage: number;
  }>;
}

export class GraphApiClient {
  private accessToken: string;
  private graphVersion: string;
  private baseUrl: string;

  constructor(options: GraphApiConfig) {
    this.accessToken = options.accessToken.trim();
    this.graphVersion = options.graphVersion || process.env.META_GRAPH_VERSION || 'v19.0';
    this.baseUrl = `https://graph.facebook.com/${this.graphVersion}`;
  }

  private async fetchJson<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('access_token', this.accessToken);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errDetail = (data as any)?.error?.message || `HTTP ${res.status} ${res.statusText}`;
      throw new Error(`Graph API error: ${errDetail}`);
    }
    return data as T;
  }

  private async postJson<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('access_token', this.accessToken);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errDetail = (data as any)?.error?.message || `HTTP ${res.status} ${res.statusText}`;
      throw new Error(`Graph API POST error: ${errDetail}`);
    }
    return data as T;
  }

  /**
   * Publish a media post to Instagram (container create -> publish) per Meta Graph API v19
   */
  async publishMedia(
    accountId: string,
    params: {
      imageUrl?: string;
      videoUrl?: string;
      caption?: string;
      mediaType?: 'image' | 'video';
    }
  ): Promise<{ id: string }> {
    const isVideo = params.mediaType === 'video' || !!params.videoUrl;
    const createParams: Record<string, string> = {
      caption: params.caption || '',
    };
    if (isVideo) {
      createParams.video_url = params.videoUrl || '';
      createParams.media_type = 'REELS';
    } else {
      createParams.image_url = params.imageUrl || '';
    }

    const containerRes = await this.postJson<{ id: string }>(`/${accountId}/media`, createParams);
    if (!containerRes.id) {
      throw new Error('Failed to create Instagram media container');
    }

    const publishRes = await this.postJson<{ id: string }>(`/${accountId}/media_publish`, {
      creation_id: containerRes.id,
    });

    return { id: publishRes.id || containerRes.id };
  }

  /**
   * Find linked Instagram Business Account ID from Page / User token
   */
  async resolveInstagramAccountId(providedId?: string): Promise<{ accountId: string; pageName?: string }> {
    if (providedId && providedId.trim().length > 0) {
      return { accountId: providedId.trim() };
    }

    // Try fetching /me/accounts (pages owned by user)
    try {
      const pagesRes = await this.fetchJson<{
        data: Array<{
          id: string;
          name: string;
          instagram_business_account?: { id: string };
        }>;
      }>('/me/accounts', { fields: 'id,name,instagram_business_account' });

      for (const page of pagesRes.data || []) {
        if (page.instagram_business_account?.id) {
          return {
            accountId: page.instagram_business_account.id,
            pageName: page.name,
          };
        }
      }
    } catch {
      // Fallback: check if /me is already an Instagram business account directly
    }

    // Direct /me check
    const meRes = await this.fetchJson<any>('/me', { fields: 'id,username' });
    return { accountId: meRes.id, pageName: meRes.username };
  }

  /**
   * Fetch Instagram Business Profile info
   */
  async fetchProfile(accountId: string): Promise<GraphApiProfile> {
    return this.fetchJson<GraphApiProfile>(`/${accountId}`, {
      fields: 'id,username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count',
    });
  }

  /**
   * Fetch recent media posts with like counts, comments, and insights
   */
  async fetchMediaList(accountId: string, limit: number = 50): Promise<GraphApiMedia[]> {
    const fields = [
      'id',
      'caption',
      'media_type',
      'media_product_type',
      'timestamp',
      'permalink',
      'like_count',
      'comments_count',
      'media_url',
      'thumbnail_url',
      'children{id,media_type,media_url}',
      'insights.metric(reach,saved,shares,total_interactions)',
    ].join(',');

    const res = await this.fetchJson<{ data: GraphApiMedia[] }>(`/${accountId}/media`, {
      fields,
      limit: String(Math.min(limit, 100)),
    });

    return res.data || [];
  }

  /**
   * Fetch Audience Demographics via Graph API insights (age, gender, country, city)
   */
  async fetchAudience(accountId: string, handle: string): Promise<AudienceDemographics | null> {
    try {
      const res = await this.fetchJson<{
        data: Array<{
          name: string;
          period: string;
          title: string;
          values: Array<{
            value: Record<string, number>;
          }>;
        }>;
      }>(`/${accountId}/insights`, {
        metric: 'audience_gender_age,audience_country,audience_city',
        period: 'lifetime',
      });

      const metricsMap = new Map<string, Record<string, number>>();
      for (const item of res.data || []) {
        const val = item.values?.[0]?.value || {};
        metricsMap.set(item.name, val);
      }

      const genderAgeRaw = metricsMap.get('audience_gender_age') || {};
      const countryRaw = metricsMap.get('audience_country') || {};
      const cityRaw = metricsMap.get('audience_city') || {};

      // Parse gender age e.g. "F.18-24": 120, "M.18-24": 90
      const ageGroups = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
      let totalCount = 0;
      const parsedGroups: Record<string, { male: number; female: number; other: number }> = {};
      for (const age of ageGroups) {
        parsedGroups[age] = { male: 0, female: 0, other: 0 };
      }

      for (const [k, v] of Object.entries(genderAgeRaw)) {
        totalCount += v;
        const [gender, age] = k.split('.');
        const targetAge = ageGroups.includes(age) ? age : '25-34';
        if (gender === 'M') parsedGroups[targetAge].male += v;
        else if (gender === 'F') parsedGroups[targetAge].female += v;
        else parsedGroups[targetAge].other += v;
      }

      const ageGenderList = ageGroups.map((age) => {
        const grp = parsedGroups[age];
        const denom = Math.max(totalCount, 1);
        return {
          ageRange: age,
          male: Math.round((grp.male / denom) * 100),
          female: Math.round((grp.female / denom) * 100),
          other: Math.round((grp.other / denom) * 100),
        };
      });

      // Countries
      let countryTotal = 0;
      for (const count of Object.values(countryRaw)) countryTotal += count;
      const countriesList = Object.entries(countryRaw)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([country, count]) => ({
          country,
          percentage: countryTotal > 0 ? Math.round((count / countryTotal) * 100) : 0,
        }));

      // Cities
      let cityTotal = 0;
      for (const count of Object.values(cityRaw)) cityTotal += count;
      const citiesList = Object.entries(cityRaw)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([city, count]) => ({
          city,
          percentage: cityTotal > 0 ? Math.round((count / cityTotal) * 100) : 0,
        }));

      return {
        handle: handle.toLowerCase(),
        collectedAt: new Date().toISOString(),
        source: 'graph_api',
        ageGender: ageGenderList,
        countries: countriesList,
        cities: citiesList,
      };
    } catch (err: any) {
      console.warn(`[GraphAPI] Demographics not available for @${handle}: ${err.message || err}`);
      return null;
    }
  }

  /**
   * Business Discovery for Public Competitor Data (SRDS D7)
   */
  async businessDiscovery(
    myAccountId: string,
    targetHandle: string
  ): Promise<{
    handle: string;
    followersCount: number;
    mediaCount: number;
    biography: string;
    profilePictureUrl: string;
    recentPosts: Array<{
      id: string;
      caption?: string;
      likeCount?: number;
      commentsCount?: number;
      mediaType: string;
      timestamp: string;
    }>;
  }> {
    const cleanHandle = targetHandle.toLowerCase().replace(/^@/, '');
    const fields = `business_discovery.username(${cleanHandle}){username,name,biography,followers_count,media_count,profile_picture_url,media.limit(15){id,caption,like_count,comments_count,media_type,timestamp}}`;

    const res = await this.fetchJson<any>(`/${myAccountId}`, { fields });
    const discovery = res?.business_discovery;
    if (!discovery) {
      throw new Error(`Business discovery failed for @${cleanHandle}`);
    }

    return {
      handle: discovery.username || cleanHandle,
      followersCount: discovery.followers_count || 0,
      mediaCount: discovery.media_count || 0,
      biography: discovery.biography || '',
      profilePictureUrl: discovery.profile_picture_url || '',
      recentPosts: (discovery.media?.data || []).map((m: any) => ({
        id: m.id,
        caption: m.caption || '',
        likeCount: m.like_count ?? null,
        commentsCount: m.comments_count ?? null,
        mediaType: m.media_type?.toLowerCase() || 'image',
        timestamp: m.timestamp,
      })),
    };
  }

  /**
   * Ingest and save profile + posts directly into normalized storage
   */
  async ingestAccount(
    providedAccountId?: string
  ): Promise<{ handle: string; postsCount: number; profile: any }> {
    const { accountId } = await this.resolveInstagramAccountId(providedAccountId);
    const rawProfile = await this.fetchProfile(accountId);
    const handle = rawProfile.username.toLowerCase();

    const rawMedia = await this.fetchMediaList(accountId, 60);

    // 1. Normalize profile into storage/profiles/{handle}.json
    const profilesDir = path.join(config.localStorageDir, 'profiles');
    const postsDir = path.join(config.localStorageDir, 'posts');
    const audienceDir = path.join(config.localStorageDir, 'audiences');
    if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
    if (!fs.existsSync(postsDir)) fs.mkdirSync(postsDir, { recursive: true });
    if (!fs.existsSync(audienceDir)) fs.mkdirSync(audienceDir, { recursive: true });

    const normalizedProfile = {
      handle,
      full_name: rawProfile.name || handle,
      bio: rawProfile.biography || '',
      external_link: rawProfile.website || null,
      avatar_url: rawProfile.profile_picture_url || null,
      is_verified: false,
      is_business: true,
      category: 'Creator / Business',
      followers_count: rawProfile.followers_count || 0,
      followers_source: 'graph_api',
      followers_raw_str: String(rawProfile.followers_count || 0),
      followers_precision: 'exact',
      following_count: rawProfile.follows_count || 0,
      following_source: 'graph_api',
      following_raw_str: String(rawProfile.follows_count || 0),
      following_precision: 'exact',
      posts_count: rawProfile.media_count || rawMedia.length,
      posts_count_source: 'graph_api',
      posts_count_raw_str: String(rawProfile.media_count || rawMedia.length),
      posts_count_precision: 'exact',
      session_authenticated: true,
      scraper_version: 'graph_api_v19',
      data_source: 'official_graph_api',
      instagram_business_id: accountId,
      last_scraped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 2. Normalize posts into storage/posts/{handle}.json
    const normalizedPosts: ScrapedPost[] = rawMedia.map((m) => {
      let mType: 'image' | 'video' | 'reel' | 'carousel' = 'image';
      if (m.media_product_type === 'REELS') mType = 'reel';
      else if (m.media_type === 'VIDEO') mType = 'video';
      else if (m.media_type === 'CAROUSEL_ALBUM') mType = 'carousel';

      const mediaUrls: string[] = [];
      if (m.media_url) mediaUrls.push(m.media_url);
      if (m.children?.data) {
        for (const child of m.children.data) {
          if (child.media_url) mediaUrls.push(child.media_url);
        }
      }

      // Hashtags & mentions from caption
      const caption = m.caption || '';
      const hashtags = (caption.match(/#[a-zA-Z0-9_\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]+/g) || []).map((h) =>
        h.toLowerCase()
      );
      const mentions = (caption.match(/@[a-zA-Z0-9_.]+/g) || []).map((u) =>
        u.replace('@', '').toLowerCase()
      );

      return {
        shortcode: m.id,
        url: m.permalink || `https://www.instagram.com/p/${m.id}/`,
        mediaType: mType,
        mediaTypeSource: 'network_json',
        caption: caption || null,
        captionSource: 'network_json',
        hashtags,
        mentions,
        postedAt: m.timestamp || new Date().toISOString(),
        postedAtSource: 'network_json',
        likesCount: m.like_count ?? null,
        likesSource: 'network_json',
        likesRawStr: m.like_count != null ? String(m.like_count) : null,
        commentsCount: m.comments_count ?? null,
        commentsSource: 'network_json',
        commentsRawStr: m.comments_count != null ? String(m.comments_count) : null,
        viewsCount: null,
        viewsSource: null,
        viewsRawStr: null,
        locationTag: null,
        locationTagSource: null,
        audioName: null,
        audioNameSource: null,
        mediaUrls,
        storagePaths: [],
        carouselSize: m.children?.data?.length || (mType === 'carousel' ? 2 : 1),
        topComments: [],
        session_authenticated: true,
        scraper_version: 'graph_api_v19',
      };
    });

    fs.writeFileSync(path.join(profilesDir, `${handle}.json`), JSON.stringify(normalizedProfile, null, 2));
    fs.writeFileSync(path.join(postsDir, `${handle}.json`), JSON.stringify(normalizedPosts, null, 2));

    // 3. Fetch audience demographics and persist if available
    const audience = await this.fetchAudience(accountId, handle);
    if (audience) {
      fs.writeFileSync(path.join(audienceDir, `${handle}.json`), JSON.stringify(audience, null, 2));
    }

    return {
      handle,
      postsCount: normalizedPosts.length,
      profile: normalizedProfile,
    };
  }
}
