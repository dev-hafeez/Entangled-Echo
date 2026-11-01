import { BrowserContext, Page, chromium } from 'playwright';
import fs from 'fs';
import { config } from '../config.js';
import {
  MetricSource,
  ParsedMetric,
  ScrapeResult,
  ScrapedComment,
  ScrapedPost,
  ScrapedProfile,
} from './types.js';
import {
  extractHashtags,
  extractMentions,
  parseCountString,
  parseDateTime,
  parseExactNumber,
} from './parser.js';
import { normalizeTarget } from './normalize.js';
import { uploadPostMedia } from './media-storage.js';
import { BrowserProfileLock } from './browser-lock.js';
import { extractRelayPayloads } from './relay-parser.js';

interface RawCaptureRecord {
  captureType: string;
  endpointUrl: string;
  payload: any;
}

export class InstagramScraper {
  private profileDir: string;
  private headless: boolean;
  private lock: BrowserProfileLock;

  constructor(options?: { profileDir?: string; headless?: boolean }) {
    this.profileDir = options?.profileDir || config.playwrightProfileDir;
    this.headless = options?.headless !== undefined ? options.headless : config.playwrightHeadless;
    this.lock = new BrowserProfileLock(this.profileDir);
  }

  public async scrape(
    targetInput: string,
    options?: {
      maxPosts?: number | null;
      onProgress?: (progress: { found: number; detailed: number; failed: number }) => void;
    }
  ): Promise<{ result: ScrapeResult; rawCaptures: RawCaptureRecord[] }> {
    const rawCaptures: RawCaptureRecord[] = [];
    const normalized = normalizeTarget(targetInput);

    const lockAcquired = await this.lock.acquire(30000, 1000);
    if (!lockAcquired) {
      return {
        result: {
          success: false,
          failureReason: 'unknown',
          error:
            'Could not acquire browser profile lock after waiting 30s: another worker is currently using it.',
          postsFound: 0,
          postsDetailed: 0,
          postsFailed: 0,
        },
        rawCaptures,
      };
    }

    let context: BrowserContext | null = null;

    try {
      if (!fs.existsSync(this.profileDir)) {
        fs.mkdirSync(this.profileDir, { recursive: true });
      }

      context = await chromium.launchPersistentContext(this.profileDir, {
        headless: this.headless,
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
        ],
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
      });

      let handle = normalized.handle;
      if (normalized.type === 'post') {
        const resolution = await this.resolveAuthorFromPost(
          context,
          normalized.postUrl!,
          rawCaptures
        );
        if (!resolution.handle) {
          return {
            result: {
              success: false,
              failureReason: 'author_resolution_failed',
              error: `Failed to resolve author from post URL: ${targetInput}`,
              postsFound: 0,
              postsDetailed: 0,
              postsFailed: 0,
            },
            rawCaptures,
          };
        }
        handle = resolution.handle;
      }

      if (!handle) {
        return {
          result: {
            success: false,
            failureReason: 'not_found',
            error: `Invalid handle or URL: ${targetInput}`,
            postsFound: 0,
            postsDetailed: 0,
            postsFailed: 0,
          },
          rawCaptures,
        };
      }

      const page = await context.newPage();
      let profileNetworkData: any = null;
      const networkPostsMap = new Map<string, any>();

      // Listen to network responses
      page.on('response', async (res) => {
        try {
          const url = res.url();
          const contentType = res.headers()['content-type'] || '';
          if (
            contentType.includes('application/json') ||
            url.includes('graphql') ||
            url.includes('web_profile_info') ||
            url.includes('/api/v1/')
          ) {
            const body = await res.json().catch(() => null);
            if (body) {
              rawCaptures.push({
                captureType: 'profile_network_json',
                endpointUrl: url,
                payload: body,
              });

              if (body.data?.user) {
                profileNetworkData = body.data.user;
              }

              const edges =
                body.data?.user?.edge_owner_to_timeline_media?.edges ||
                body.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.edges;
              if (Array.isArray(edges)) {
                for (const edge of edges) {
                  const node = edge.node;
                  const sc = node?.code || node?.shortcode;
                  if (sc) networkPostsMap.set(sc, node);
                }
              }
            }
          }
        } catch {}
      });

      const profileUrl = `https://www.instagram.com/${handle}/`;
      const response = await page.goto(profileUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await page.waitForTimeout(2500);

      // Check status & failure modes
      const statusCheck = await this.detectPageStatus(page, response?.status());
      if (statusCheck !== 'ok') {
        await page.close();
        return {
          result: {
            success: false,
            failureReason: statusCheck,
            error: `Profile scrape halted: ${statusCheck}`,
            postsFound: 0,
            postsDetailed: 0,
            postsFailed: 0,
          },
          rawCaptures,
        };
      }

      // Check inline Relay/GraphQL script tags on profile page
      const inlineScripts = await page
        .$$eval('script', (els) =>
          els.map((e) => e.textContent || '').filter((t) => t.includes('RelayPrefetchedStreamCache'))
        )
        .catch(() => []);

      for (const scriptContent of inlineScripts) {
        try {
          const matches = extractRelayPayloads(scriptContent);
          for (const match of matches) {
            rawCaptures.push({
              captureType: 'relay_prefetched_stream_cache',
              endpointUrl: profileUrl,
              payload: match.value,
            });

            if (match.key === 'xig_user_by_username') {
              if (!profileNetworkData) {
                profileNetworkData = match.value;
              }
              const timelineEdges = match.value.polaris_ordered_timeline_connection?.edges;
              if (Array.isArray(timelineEdges)) {
                for (const edge of timelineEdges) {
                  const sc = edge.node?.code || edge.node?.shortcode;
                  if (sc) networkPostsMap.set(sc, edge.node);
                }
              }
            }
            if (match.key === 'polaris_ordered_timeline_connection') {
              const timelineEdges = match.value?.edges;
              if (Array.isArray(timelineEdges)) {
                for (const edge of timelineEdges) {
                  const sc = edge.node?.code || edge.node?.shortcode;
                  if (sc) networkPostsMap.set(sc, edge.node);
                }
              }
            }
          }
        } catch {}
      }

      // Wait for profile post grid to be rendered in the DOM
      await page.waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 8000 }).catch(() => {});

      // Extract Profile Data
      const profile = await this.extractProfileData(page, handle, profileNetworkData);

      // Grid scrolling: collect post shortcodes (all 12 visible posts on profile by default)
      const maxPosts = options?.maxPosts ?? 12;
      const discoveredShortcodes = await this.scrollAndCollectGrid(
        page,
        maxPosts,
        networkPostsMap
      );

      await page.close();

      const postsFound = discoveredShortcodes.length;
      let postsDetailed = 0;
      let postsFailed = 0;

      if (options?.onProgress) {
        options.onProgress({ found: postsFound, detailed: postsDetailed, failed: postsFailed });
      }

      // Fetch detail for EVERY post discovered
      const scrapedPosts: ScrapedPost[] = [];
      const shortcodesToFetch = maxPosts
        ? discoveredShortcodes.slice(0, maxPosts)
        : discoveredShortcodes;

      const concurrency = 2;
      for (let i = 0; i < shortcodesToFetch.length; i += concurrency) {
        const batch = shortcodesToFetch.slice(i, i + concurrency);
        const batchPromises = batch.map(async (shortcode) => {
          try {
            const postDetail = await this.fetchPostDetailWithRetry(
              context!,
              handle!,
              shortcode,
              networkPostsMap.get(shortcode),
              rawCaptures,
              3
            );
            if (postDetail) {
              postsDetailed++;
              scrapedPosts.push(postDetail);
            } else {
              postsFailed++;
            }
          } catch (err: any) {
            console.warn(`[scraper] Post detail failure for ${shortcode}: ${err.message}`);
            postsFailed++;
          } finally {
            if (options?.onProgress) {
              options.onProgress({
                found: postsFound,
                detailed: postsDetailed,
                failed: postsFailed,
              });
            }
          }
        });

        await Promise.all(batchPromises);
      }

      return {
        result: {
          success: true,
          profile,
          posts: scrapedPosts,
          postsFound,
          postsDetailed,
          postsFailed,
        },
        rawCaptures,
      };
    } catch (err: any) {
      return {
        result: {
          success: false,
          failureReason: 'unknown',
          error: err.message,
          postsFound: 0,
          postsDetailed: 0,
          postsFailed: 0,
        },
        rawCaptures,
      };
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
      this.lock.release();
    }
  }

  private async resolveAuthorFromPost(
    context: BrowserContext,
    postUrl: string,
    rawCaptures: RawCaptureRecord[]
  ): Promise<{ handle: string | null }> {
    const page = await context.newPage();
    let detectedHandle: string | null = null;

    try {
      page.on('response', async (res) => {
        try {
          const ct = res.headers()['content-type'] || '';
          if (ct.includes('application/json')) {
            const json = await res.json().catch(() => null);
            if (json) {
              rawCaptures.push({
                captureType: 'post_author_resolution',
                endpointUrl: res.url(),
                payload: json,
              });
              const ownerUsername =
                json.data?.xdt_shortcode_media?.owner?.username ||
                json.data?.shortcode_media?.owner?.username ||
                json.items?.[0]?.user?.username;
              if (ownerUsername && !detectedHandle) {
                detectedHandle = ownerUsername.toLowerCase();
              }
            }
          }
        } catch {}
      });

      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(2000);

      if (!detectedHandle) {
        const metaDesc = await page
          .$eval('meta[property="og:description"]', (el) => el.getAttribute('content'))
          .catch(() => null);
        if (metaDesc) {
          const match = metaDesc.match(/from\s+([a-zA-Z0-9._]+)\s+on/i);
          if (match) detectedHandle = match[1].toLowerCase();
        }
      }

      if (!detectedHandle) {
        const domHandle = await page
          .$eval('header a[role="link"], article header a', (el) => el.textContent?.trim() || null)
          .catch(() => null);
        if (domHandle && /^[a-zA-Z0-9._]{1,30}$/.test(domHandle)) {
          detectedHandle = domHandle.toLowerCase();
        }
      }
    } finally {
      await page.close().catch(() => {});
    }

    return { handle: detectedHandle };
  }

  private async dismissModals(page: Page): Promise<void> {
    try {
      // 1. Try Escape key to dismiss standard Instagram modal popups
      await page.keyboard.press('Escape');

      // 2. Click any explicit close buttons inside dialogs
      const closeButtons = await page.$$(
        'div[role="dialog"] [aria-label="Close"], div[role="dialog"] svg[aria-label="Close"], svg[aria-label="Close"], div[role="dialog"] button:has-text("Close"), button:has-text("Not Now"), [role="dialog"] [role="button"]'
      );
      for (const btn of closeButtons) {
        await btn.click().catch(() => {});
      }

      // 3. Remove blocking modal overlays if still attached to the DOM
      await page
        .evaluate(() => {
          const dialogs = document.querySelectorAll('div[role="dialog"], div[role="presentation"]');
          for (const d of dialogs) {
            const text = d.textContent || '';
            if (
              text.includes('Sign up') ||
              text.includes('Log In') ||
              text.includes('See photos') ||
              text.includes('never miss a post')
            ) {
              (d as HTMLElement).style.display = 'none';
            }
          }
          document.body.style.overflow = 'auto';
        })
        .catch(() => {});
    } catch {}
  }

  private async detectPageStatus(
    page: Page,
    httpStatus?: number
  ): Promise<'ok' | 'not_found' | 'private' | 'login_wall' | 'restricted' | 'rate_limit'> {
    const currentUrl = page.url();

    if (httpStatus === 404) {
      return 'not_found';
    }

    if (currentUrl.includes('/challenge/') || currentUrl.includes('/checkpoint/')) {
      return 'rate_limit';
    }

    const title = await page.title().catch(() => '');
    if (title.includes('Page Not Found') || title.includes("Sorry, this page isn't available")) {
      return 'not_found';
    }

    const bodyText = await page.$eval('body', (el) => el.innerText).catch(() => '');

    if (
      bodyText.includes("Sorry, this page isn't available") ||
      bodyText.includes('The link you followed may be broken')
    ) {
      return 'not_found';
    }

    if (bodyText.includes('This Account is Private') || bodyText.includes('This account is private')) {
      return 'private';
    }

    if (bodyText.includes('Restricted profile') || bodyText.includes('Restricted Profile')) {
      return 'restricted';
    }

    if (
      bodyText.includes('Please wait a few minutes before you try again') ||
      bodyText.includes('Try again later')
    ) {
      return 'rate_limit';
    }

    // Dismiss any non-blocking modal dialogs
    await this.dismissModals(page);

    // If redirected to login page, check if profile/relay data was still delivered
    if (currentUrl.includes('/accounts/login/')) {
      const hasRelay = await page
        .$$eval('script', (els) =>
          els.some(
            (e) =>
              (e.textContent || '').includes('RelayPrefetchedStreamCache') ||
              (e.textContent || '').includes('xig_user_by_username')
          )
        )
        .catch(() => false);

      if (!hasRelay) {
        return 'login_wall';
      }
    }

    // Check if dialog is genuinely a blocking login wall
    const isLoginModal = await page
      .$eval(
        'div[role="dialog"]',
        (el) => (el.textContent || '').includes('Log In') || (el.textContent || '').includes('Sign up')
      )
      .catch(() => false);

    if (isLoginModal) {
      const lowerBody = bodyText.toLowerCase();
      const hasFollowers = lowerBody.includes('followers') || lowerBody.includes('following');
      const hasPostsInDom = await page
        .$('a[href*="/p/"], a[href*="/reel/"]')
        .then((el) => !!el)
        .catch(() => false);
      const hasRelay = await page
        .$$eval('script', (els) =>
          els.some(
            (e) =>
              (e.textContent || '').includes('RelayPrefetchedStreamCache') ||
              (e.textContent || '').includes('xig_user_by_username')
          )
        )
        .catch(() => false);

      // Only mark as login wall if it completely blocks access to profile info, posts, and relay scripts
      if (!hasFollowers && !hasPostsInDom && !hasRelay) {
        return 'login_wall';
      }
    }

    return 'ok';
  }

  private async extractProfileData(
    page: Page,
    handle: string,
    networkUser: any
  ): Promise<ScrapedProfile> {
    let fullName: string | null = null;
    let bio: string | null = null;
    let externalLink: string | null = null;
    let avatarUrl: string | null = null;
    let isVerified: boolean | null = null;
    let isBusiness: boolean | null = null;
    let category: string | null = null;

    let followers: ParsedMetric = { count: null, rawStr: null, precision: null, source: null };
    let following: ParsedMetric = { count: null, rawStr: null, precision: null, source: null };
    let postsCount: ParsedMetric = { count: null, rawStr: null, precision: null, source: null };

    if (networkUser) {
      fullName = networkUser.full_name || null;
      bio = networkUser.biography || null;
      externalLink = networkUser.external_url || null;
      avatarUrl = networkUser.profile_pic_url_hd || networkUser.profile_pic_url || null;
      isVerified =
        typeof networkUser.is_verified === 'boolean' ? networkUser.is_verified : null;
      isBusiness =
        typeof networkUser.is_business_account === 'boolean'
          ? networkUser.is_business_account
          : null;
      category = networkUser.category_name || null;

      if (networkUser.edge_followed_by?.count !== undefined) {
        followers = parseExactNumber(networkUser.edge_followed_by.count, 'network_json');
      }
      if (networkUser.edge_follow?.count !== undefined) {
        following = parseExactNumber(networkUser.edge_follow.count, 'network_json');
      }
      if (networkUser.edge_owner_to_timeline_media?.count !== undefined) {
        postsCount = parseExactNumber(
          networkUser.edge_owner_to_timeline_media.count,
          'network_json'
        );
      }
    }

    if (followers.count === null || following.count === null || postsCount.count === null) {
      const metaDescription = await page
        .$eval('meta[name="description"], meta[property="og:description"]', (el) =>
          el.getAttribute('content')
        )
        .catch(() => null);

      if (metaDescription) {
        const match = metaDescription.match(
          /([\d.,KMkmBb]+)\s*Followers,\s*([\d.,KMkmBb]+)\s*Following,\s*([\d.,KMkmBb]+)\s*Posts/i
        );
        if (match) {
          if (followers.count === null) {
            followers = parseCountString(match[1], 'page_meta');
          }
          if (following.count === null) {
            following = parseCountString(match[2], 'page_meta');
          }
          if (postsCount.count === null) {
            postsCount = parseCountString(match[3], 'page_meta');
          }
        }
      }
    }

    if (!avatarUrl) {
      avatarUrl = await page
        .$eval('meta[property="og:image"]', (el) => el.getAttribute('content'))
        .catch(() => null);
    }

    if (!fullName) {
      fullName = await page
        .$eval('header section h1, header h2', (el) => el.textContent?.trim() || null)
        .catch(() => null);
    }

    if (!bio) {
      bio = await page
        .$eval('header section h1 ~ div, header div.-bio', (el) => el.textContent?.trim() || null)
        .catch(() => null);
    }

    if (!externalLink) {
      externalLink = await page
        .$eval('header section a[href*="l.instagram.com"]', (el) => el.getAttribute('href'))
        .catch(() => null);
    }

    if (isVerified === null) {
      const hasVerifiedSvg = await page
        .$('header svg[aria-label="Verified"]')
        .catch(() => null);
      if (hasVerifiedSvg) isVerified = true;
    }

    return {
      handle,
      fullName,
      bio,
      externalLink,
      avatarUrl,
      isVerified,
      isBusiness,
      category,
      followers,
      following,
      postsCount,
    };
  }

  private async scrollAndCollectGrid(
    page: Page,
    maxPosts: number | null,
    networkPostsMap: Map<string, any>
  ): Promise<string[]> {
    const shortcodeSet = new Set<string>();

    for (const sc of networkPostsMap.keys()) {
      shortcodeSet.add(sc);
    }

    await this.dismissModals(page);

    const extractDomShortcodes = async () => {
      const links = await page
        .$$eval('a[href*="/p/"], a[href*="/reel/"]', (anchors) =>
          anchors.map((a) => a.getAttribute('href') || '')
        )
        .catch(() => []);

      for (const href of links) {
        const match = href.match(/\/(?:p|reel)\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          shortcodeSet.add(match[1]);
        }
      }
    };

    await extractDomShortcodes();

    // If fewer than 12 posts found initially on the page, perform a small scroll to trigger grid hydration
    if (shortcodeSet.size < (maxPosts ? Math.min(12, maxPosts) : 12)) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1200);
      await extractDomShortcodes();
    }

    let attemptsWithoutNew = 0;
    const maxScrolls = maxPosts ? Math.ceil(maxPosts / 12) + 2 : 15;

    for (let scroll = 0; scroll < maxScrolls; scroll++) {
      if (maxPosts && shortcodeSet.size >= maxPosts) {
        break;
      }

      const beforeCount = shortcodeSet.size;
      await this.dismissModals(page);
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));

      try {
        await page.waitForFunction(
          (initialCount) => {
            const els = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
            return els.length > initialCount;
          },
          beforeCount,
          { timeout: 3500 }
        );
      } catch {}

      await extractDomShortcodes();

      if (shortcodeSet.size === beforeCount) {
        attemptsWithoutNew++;
        if (attemptsWithoutNew >= 3) break;
      } else {
        attemptsWithoutNew = 0;
      }

      await page.waitForTimeout(1000 + Math.random() * 1000);
    }

    return Array.from(shortcodeSet);
  }

  private async fetchPostDetailWithRetry(
    context: BrowserContext,
    handle: string,
    shortcode: string,
    cachedNetworkNode: any,
    rawCaptures: RawCaptureRecord[],
    maxRetries: number = 3
  ): Promise<ScrapedPost | null> {
    let attempt = 0;
    let delay = 1500;

    while (attempt < maxRetries) {
      attempt++;
      try {
        await new Promise((r) => setTimeout(r, delay + Math.random() * 1000));
        return await this.fetchPostDetail(
          context,
          handle,
          shortcode,
          cachedNetworkNode,
          rawCaptures
        );
      } catch (err: any) {
        console.warn(
          `[scraper] Detail fetch attempt ${attempt}/${maxRetries} failed for ${shortcode}: ${err.message}`
        );
        if (attempt >= maxRetries) throw err;
        delay *= 2;
      }
    }
    return null;
  }

  private async fetchPostDetail(
    context: BrowserContext,
    handle: string,
    shortcode: string,
    cachedNetworkNode: any,
    rawCaptures: RawCaptureRecord[]
  ): Promise<ScrapedPost> {
    const postUrl = `https://www.instagram.com/p/${shortcode}/`;
    const page = await context.newPage();

    let postNetworkData: any = cachedNetworkNode || null;

    try {
      page.on('response', async (res) => {
        try {
          const ct = res.headers()['content-type'] || '';
          if (ct.includes('application/json')) {
            const json = await res.json().catch(() => null);
            if (json) {
              rawCaptures.push({
                captureType: 'post_network_json',
                endpointUrl: res.url(),
                payload: json,
              });
              const media =
                json.data?.xdt_shortcode_media ||
                json.data?.shortcode_media ||
                json.items?.[0];
              const sc = media?.code || media?.shortcode;
              if (media && sc === shortcode) {
                postNetworkData = media;
              }
            }
          }
        } catch {}
      });

      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(2000 + Math.random() * 1000);

      // Search inline Relay/GraphQL script tags on the post page
      const postScripts = await page
        .$$eval('script', (els) =>
          els.map((e) => e.textContent || '').filter((t) => t.includes('RelayPrefetchedStreamCache') || t.includes('xdt_'))
        )
        .catch(() => []);

      for (const s of postScripts) {
        try {
          const matches = extractRelayPayloads(s);
          for (const m of matches) {
            rawCaptures.push({
              captureType: 'relay_prefetched_stream_cache_post',
              endpointUrl: postUrl,
              payload: m.value,
            });
            const sc = m.value.code || m.value.shortcode;
            if (sc === shortcode || m.key === 'xdt_shortcode_media') {
              postNetworkData = { ...postNetworkData, ...m.value };
            }
          }
        } catch {}
      }

      // Also parse exact metrics from script contents if present
      for (const s of postScripts) {
        if (!postNetworkData?.taken_at_timestamp && !postNetworkData?.taken_at) {
          const takenMatch = s.match(/(?:taken_at_timestamp|taken_at)[\"':\s]+(\d+)/);
          if (takenMatch) {
            postNetworkData = postNetworkData || {};
            postNetworkData.taken_at = parseInt(takenMatch[1], 10);
          }
        }
        if (postNetworkData?.like_count === undefined && postNetworkData?.edge_media_preview_like === undefined) {
          const likeMatch = s.match(/(?:like_count|edge_media_preview_like)[\"':\s]+(\d+)/);
          if (likeMatch) {
            postNetworkData = postNetworkData || {};
            postNetworkData.like_count = parseInt(likeMatch[1], 10);
          }
        }
        if (postNetworkData?.comment_count === undefined && postNetworkData?.edge_media_to_parent_comment === undefined) {
          const commentMatch = s.match(/(?:comment_count|edge_media_to_parent_comment)[\"':\s]+(\d+)/);
          if (commentMatch) {
            postNetworkData = postNetworkData || {};
            postNetworkData.comment_count = parseInt(commentMatch[1], 10);
          }
        }
      }

      let mediaType: 'image' | 'video' | 'reel' | 'carousel' | null = null;
      let mediaTypeSource: MetricSource = null;
      let caption: string | null = null;
      let captionSource: MetricSource = null;
      let postedAt: string | null = null;
      let postedAtSource: MetricSource = null;
      let likesCount: number | null = null;
      let likesSource: MetricSource = null;
      let likesRawStr: string | null = null;
      let commentsCount: number | null = null;
      let commentsSource: MetricSource = null;
      let commentsRawStr: string | null = null;
      let viewsCount: number | null = null;
      let viewsSource: MetricSource = null;
      let viewsRawStr: string | null = null;
      let locationTag: string | null = null;
      let locationTagSource: MetricSource = null;
      let audioName: string | null = null;
      let audioNameSource: MetricSource = null;
      let mediaUrls: string[] = [];
      let carouselSize: number | null = null;
      const topComments: ScrapedComment[] = [];

      // 1. Process network / relay JSON
      if (postNetworkData) {
        if (
          postNetworkData.__typename === 'GraphSidecar' ||
          postNetworkData.__typename === 'XIGPolarisSidecarMedia' ||
          postNetworkData.carousel_media_count
        ) {
          mediaType = 'carousel';
          mediaTypeSource = 'network_json';
          carouselSize =
            postNetworkData.edge_sidecar_to_children?.edges?.length ||
            postNetworkData.carousel_media_count ||
            null;
        } else if (
          postNetworkData.is_video ||
          postNetworkData.__typename === 'GraphVideo' ||
          postNetworkData.__typename === 'XIGPolarisVideoMedia' ||
          postNetworkData.media_type === 2
        ) {
          mediaType = postUrl.includes('/reel/') ? 'reel' : 'video';
          mediaTypeSource = 'network_json';
        } else {
          mediaType = 'image';
          mediaTypeSource = 'network_json';
        }

        const captionNode =
          postNetworkData.caption?.text ||
          postNetworkData.edge_media_to_caption?.edges?.[0]?.node?.text;
        if (typeof captionNode === 'string') {
          caption = captionNode;
          captionSource = 'network_json';
        }

        const timestamp =
          postNetworkData.taken_at_timestamp || postNetworkData.taken_at;
        if (timestamp) {
          postedAt = parseDateTime(timestamp);
          if (postedAt) postedAtSource = 'network_json';
        }

        if (postNetworkData.like_count !== undefined) {
          likesCount = postNetworkData.like_count;
          likesSource = 'network_json';
          likesRawStr = String(likesCount);
        } else if (postNetworkData.edge_media_preview_like?.count !== undefined) {
          likesCount = postNetworkData.edge_media_preview_like.count;
          likesSource = 'network_json';
          likesRawStr = String(likesCount);
        }

        if (postNetworkData.comment_count !== undefined) {
          commentsCount = postNetworkData.comment_count;
          commentsSource = 'network_json';
          commentsRawStr = String(commentsCount);
        } else if (postNetworkData.edge_media_to_parent_comment?.count !== undefined) {
          commentsCount = postNetworkData.edge_media_to_parent_comment.count;
          commentsSource = 'network_json';
          commentsRawStr = String(commentsCount);
        }

        if (postNetworkData.video_view_count !== undefined) {
          viewsCount = postNetworkData.video_view_count;
          viewsSource = 'network_json';
          viewsRawStr = String(viewsCount);
        }

        if (postNetworkData.location?.name) {
          locationTag = postNetworkData.location.name;
          locationTagSource = 'network_json';
        }

        if (postNetworkData.clips_music_attribution_info?.song_name) {
          audioName = postNetworkData.clips_music_attribution_info.song_name;
          audioNameSource = 'network_json';
        }

        const display = postNetworkData.display_uri || postNetworkData.display_url;
        if (display) mediaUrls.push(display);
      }

      // 2. Fallbacks from DOM / Meta if not populated
      if (!postedAt) {
        const timeEl = await page
          .$eval('time[datetime]', (el) => el.getAttribute('datetime'))
          .catch(() => null);
        if (timeEl) {
          postedAt = parseDateTime(timeEl);
          if (postedAt) postedAtSource = 'dom';
        }
      }

      if (!caption) {
        const domCaption = await page
          .$eval(
            'h1, article div[role="button"] + span, article header + div span',
            (el) => el.textContent?.trim() || null
          )
          .catch(() => null);
        if (domCaption) {
          caption = domCaption;
          captionSource = 'dom';
        }
      }

      if (likesCount === null) {
        const domLikesText = await page
          .$eval(
            'section a[href*="liked_by"] span, section button span',
            (el) => el.textContent?.trim() || null
          )
          .catch(() => null);
        if (domLikesText) {
          const parsed = parseCountString(domLikesText, 'dom');
          if (parsed.count !== null) {
            likesCount = parsed.count;
            likesSource = 'dom';
            likesRawStr = parsed.rawStr;
          }
        }
      }

      if (commentsCount === null) {
        const metaDesc = await page
          .$eval('meta[property="og:description"]', (el) => el.getAttribute('content'))
          .catch(() => null);
        if (metaDesc) {
          const cMatch = metaDesc.match(/([\d.,KMkmBb]+)\s*comments/i);
          if (cMatch) {
            const parsed = parseCountString(cMatch[1], 'page_meta');
            if (parsed.count !== null) {
              commentsCount = parsed.count;
              commentsSource = 'page_meta';
              commentsRawStr = parsed.rawStr;
            }
          }
        }
      }

      if (!mediaType) {
        const isReel = postUrl.includes('/reel/');
        const hasVideo = await page.$('article video').catch(() => null);
        const hasCarouselDots = await page.$('article .coreSpriteRightChevron, article ul li').catch(() => null);
        if (hasCarouselDots) {
          mediaType = 'carousel';
        } else if (isReel) {
          mediaType = 'reel';
        } else if (hasVideo) {
          mediaType = 'video';
        } else {
          mediaType = 'image';
        }
        mediaTypeSource = 'dom';
      }

      if (mediaUrls.length === 0) {
        const imgUrls = await page
          .$$eval('article img[srcset], article img[src]', (imgs) =>
            imgs.map((img) => img.getAttribute('src') || '')
          )
          .catch(() => []);
        mediaUrls = imgUrls.filter((u) => u.startsWith('http') && !u.includes('profile_pic'));
      }

      // Extract top visible comments up to 20
      const domComments = await page
        .$$eval('article ul > ul, article div[role="button"] ~ ul li', (lis) =>
          lis.slice(0, 20).map((li) => {
            const author = li.querySelector('h3 a, a[role="link"]')?.textContent?.trim() || null;
            const text = li.querySelector('span')?.textContent?.trim() || null;
            const time = li.querySelector('time')?.getAttribute('datetime') || null;
            return { author, text, time };
          })
        )
        .catch(() => []);

      for (const dc of domComments) {
        if (dc.author && dc.text) {
          topComments.push({
            commentId: null,
            author: dc.author,
            text: dc.text,
            likesCount: null,
            postedAt: parseDateTime(dc.time),
            authorSource: 'dom',
            textSource: 'dom',
            likesSource: null,
            postedAtSource: dc.time ? 'dom' : null,
          });
        }
      }

      // Download images into post-media bucket and store paths
      const storagePaths: string[] = [];
      for (let idx = 0; idx < Math.min(mediaUrls.length, 5); idx++) {
        const mUrl = mediaUrls[idx];
        try {
          const res = await page.request.get(mUrl, { timeout: 10000 });
          if (res.ok()) {
            const buffer = await res.body();
            const storedPath = await uploadPostMedia(handle, shortcode, idx, buffer);
            if (storedPath) {
              storagePaths.push(storedPath);
            }
          }
        } catch (err: any) {
          console.warn(
            `[scraper] Media download failed for ${shortcode} [${idx}]: ${err.message}`
          );
        }
      }

      const hashtags = extractHashtags(caption);
      const mentions = extractMentions(caption);

      return {
        shortcode,
        url: postUrl,
        mediaType,
        mediaTypeSource,
        caption,
        captionSource,
        hashtags,
        mentions,
        postedAt,
        postedAtSource,
        likesCount,
        likesSource,
        likesRawStr,
        commentsCount,
        commentsSource,
        commentsRawStr,
        viewsCount,
        viewsSource,
        viewsRawStr,
        locationTag,
        locationTagSource,
        audioName,
        audioNameSource,
        mediaUrls,
        storagePaths,
        carouselSize,
        topComments,
      };
    } finally {
      await page.close().catch(() => {});
    }
  }
}
