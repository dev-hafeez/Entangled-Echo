import { localJobQueue } from './local-queue.js';
import { getSupabaseAdmin } from './supabase.js';
import { InstagramScraper } from '../scraper/instagram.js';
import { persistScrapeData } from './db-store.js';
import { executeNicheAnalysis } from '../routes/onboarding.js';

export class JobWorker {
  private isRunning: boolean = false;
  private workerId: string;
  private scraper: InstagramScraper;
  private consecutiveAnomalies: number = 0;

  constructor(workerId: string = `worker-${process.pid}`) {
    this.workerId = workerId;
    this.scraper = new InstagramScraper();
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[queue-worker] Starting worker ${this.workerId}...`);

    while (this.isRunning) {
      try {
        const job = await this.claimNextJob();
        if (job) {
          console.log(`[queue-worker] Claimed job ${job.id} for input: ${job.target_input}`);
          await this.processJob(job);
        } else {
          // No job available, sleep 2 seconds
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (err: any) {
        console.error(`[queue-worker] Worker loop error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  public stop(): void {
    this.isRunning = false;
    console.log(`[queue-worker] Stopping worker ${this.workerId}...`);
  }

  private async claimNextJob(): Promise<any | null> {
    // Check local in-memory queue (instant, 0 latency, handles 2,000+ jobs)
    return localJobQueue.claimNext(this.workerId);
  }

  private async processJob(job: any): Promise<void> {
    const jobId = job.id;

    // Heartbeat timer every 15s
    const heartbeatTimer = setInterval(() => {
      localJobQueue.updateHeartbeat(jobId);
    }, 15000);

    try {
      const scraper = new InstagramScraper({ headless: job.headless ?? true });
      const { result, rawCaptures } = await scraper.scrape(job.target_input, {
        maxPosts: job.max_posts,
        onProgress: async (p) => {
          localJobQueue.updateProgress(jobId, p);
        },
        onPostScraped: async (post, profile, count) => {
          // Immediately flush to disk on first post and every post thereafter
          // so dashboard gets instant access after 3-4 posts while remaining posts stream in
          try {
            await persistScrapeData({
              jobId,
              profile,
              posts: [post],
              sessionAuthenticated: true,
            });
          } catch (e: any) {
            console.warn(`[queue-worker] Immediate flush error: ${e.message}`);
          }
        },
      });

      if (!result.success || !result.profile) {
        localJobQueue.finishJob(jobId, {
          status: 'failed',
          failure_reason: result.failureReason || 'unknown',
          error: result.error || 'Failed to scrape profile',
          session_authenticated: result.failureReason !== 'auth_missing',
        });
        return;
      }

      // Persist to local storage
      await persistScrapeData({
        jobId,
        profile: result.profile,
        posts: result.posts,
        rawCaptures,
        sessionAuthenticated: true,
      });

      // Determine final status
      // Rule 3: If a job gets fewer posts than min(max_posts, profile.posts_count), mark it partial with reason, never done.
      const targetMax = job.max_posts !== null && job.max_posts !== undefined ? job.max_posts : 60;
      const profileAvailablePosts = result.profile.postsCount.count || 0;
      const expectedPosts = Math.min(targetMax, profileAvailablePosts);

      let finalStatus: 'done' | 'partial' | 'failed' = 'done';
      let failureReason: string | null = null;

      if (result.postsDetailed === 0 && expectedPosts > 0) {
        finalStatus = 'failed';
        failureReason = result.failureReason || 'unknown';
      } else if (result.postsDetailed < expectedPosts) {
        finalStatus = 'partial';
        if (result.failureReason === 'login_wall') failureReason = 'auth_lost';
        else if (result.failureReason === 'rate_limit') failureReason = 'rate_limited';
        else if (result.postsFound < expectedPosts) failureReason = 'pagination_stalled';
        else failureReason = 'unknown';
      }

      localJobQueue.finishJob(jobId, {
        status: finalStatus,
        normalized_handle: result.profile.handle,
        progress_found: result.postsFound,
        progress_detailed: result.postsDetailed,
        progress_failed: result.postsFailed,
        failure_reason: failureReason,
        error: result.error || null,
        session_authenticated: true,
        scraper_version: '2.0.0-depth',
      });

      // Automatically execute full evidence-grounded NicheIQ analysis across all detailed posts
      if ((finalStatus === 'done' || finalStatus === 'partial') && result.postsDetailed > 0 && result.profile?.handle) {
        try {
          console.log(`[queue-worker] Running automated NicheIQ calibration for @${result.profile.handle} across ${result.postsDetailed} posts...`);
          await executeNicheAnalysis(result.profile.handle, 'instagram');
          console.log(`[queue-worker] NicheIQ calibration complete for @${result.profile.handle}.`);
        } catch (nErr: any) {
          console.warn(`[queue-worker] Post-scrape NicheIQ calibration warning: ${nErr.message}`);
        }
      }

      // Check for consecutive anomalies (login_wall, challenge, or empty_grid)
      const isAnomaly =
        result.failureReason === 'login_wall' ||
        result.failureReason === 'rate_limit' ||
        result.failureReason === 'auth_missing' ||
        result.postsFound === 0;

      if (isAnomaly) {
        this.consecutiveAnomalies++;
        console.warn(
          `[queue-worker] Anomaly detected for job ${jobId} (reason: ${result.failureReason || 'empty_grid'}). Consecutive anomaly count: ${this.consecutiveAnomalies}`
        );
        if (this.consecutiveAnomalies >= 3) {
          console.error(
            `[queue-worker] 3 consecutive anomalies encountered! Automatically pausing queue to protect session.`
          );
          localJobQueue.setPaused(true);
        }
      } else {
        this.consecutiveAnomalies = 0;
      }

      console.log(
        `[queue-worker] Job ${jobId} finished with status '${finalStatus}': ${result.postsDetailed} posts detailed, ${result.postsFailed} failed.`
      );
    } catch (err: any) {
      console.error(`[queue-worker] Error executing job ${jobId}: ${err.message}`);
      localJobQueue.finishJob(jobId, {
        status: 'failed',
        error: err.message,
        failure_reason: 'unknown',
      });
    } finally {
      clearInterval(heartbeatTimer);
    }
  }
}
