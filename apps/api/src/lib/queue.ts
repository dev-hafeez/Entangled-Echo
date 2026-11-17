import { getSupabaseAdmin } from './supabase.js';
import { InstagramScraper } from '../scraper/instagram.js';
import { persistScrapeData } from './db-store.js';
import { localJobQueue } from './local-queue.js';

export class JobWorker {
  private isRunning: boolean = false;
  private workerId: string;
  private scraper: InstagramScraper;

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
          // No job available, sleep 3 seconds
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (err: any) {
        console.error(`[queue-worker] Worker loop error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  public stop(): void {
    this.isRunning = false;
    console.log(`[queue-worker] Stopping worker ${this.workerId}...`);
  }

  private async claimNextJob(): Promise<any | null> {
    // 1. Try local queue first (guaranteed offline / disk backed)
    const localJob = localJobQueue.claimNext(this.workerId);
    if (localJob) {
      return localJob;
    }

    // 2. Fall back to Supabase if local queue is empty
    try {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase.rpc('claim_next_job', {
        worker_id: this.workerId,
        timeout_seconds: 300,
      });

      if (error) {
        return null;
      }

      if (Array.isArray(data) && data.length > 0) {
        return data[0];
      }
    } catch {}

    return null;
  }

  private async processJob(job: any): Promise<void> {
    const jobId = job.id;

    // Heartbeat timer every 15s
    const heartbeatTimer = setInterval(async () => {
      try {
        localJobQueue.updateHeartbeat(jobId);
        const supabase = getSupabaseAdmin();
        await supabase
          .from('jobs')
          .update({ heartbeat_at: new Date().toISOString() })
          .eq('id', jobId);
      } catch {}
    }, 15000);

    try {
      const scraper = new InstagramScraper({ headless: job.headless ?? true });
      const { result, rawCaptures } = await scraper.scrape(job.target_input, {
        maxPosts: job.max_posts,
        onProgress: async (p) => {
          localJobQueue.updateProgress(jobId, p);
          try {
            const supabase = getSupabaseAdmin();
            await supabase
              .from('jobs')
              .update({
                progress_found: p.found,
                progress_detailed: p.detailed,
                progress_failed: p.failed,
                heartbeat_at: new Date().toISOString(),
              })
              .eq('id', jobId);
          } catch {}
        },
        onPostScraped: async (post, profile, count) => {
          try {
            // Progressive persistence: save post & profile immediately to local disk
            // so dashboard can unlock instantly once minimum posts are captured
            await persistScrapeData({
              jobId,
              profile,
              posts: [post],
              rawCaptures: [],
            });
          } catch (persistErr: any) {
            console.warn(`[queue-worker] onPostScraped error: ${persistErr.message}`);
          }
        },
      });

      if (!result.success || !result.profile) {
        localJobQueue.finishJob(jobId, {
          status: 'failed',
          failure_reason: result.failureReason || 'unknown',
          error: result.error || 'Failed to scrape profile',
        });
        try {
          const supabase = getSupabaseAdmin();
          await supabase
            .from('jobs')
            .update({
              status: 'failed',
              failure_reason: result.failureReason || 'unknown',
              error: result.error || 'Failed to scrape profile',
              finished_at: new Date().toISOString(),
            })
            .eq('id', jobId);
        } catch {}
        return;
      }

      // Persist all posts to local database & disk
      await persistScrapeData({
        jobId,
        profile: result.profile,
        posts: result.posts,
        rawCaptures,
      });

      // Determine final status (partial if some posts failed, else done)
      const finalStatus =
        result.postsFailed > 0 && result.postsDetailed > 0 ? 'partial' : 'done';

      localJobQueue.finishJob(jobId, {
        status: finalStatus,
        normalized_handle: result.profile.handle,
        progress_found: result.postsFound,
        progress_detailed: result.postsDetailed,
        progress_failed: result.postsFailed,
        error: result.error || null,
      });

      try {
        const supabase = getSupabaseAdmin();
        await supabase
          .from('jobs')
          .update({
            status: finalStatus,
            normalized_handle: result.profile.handle,
            progress_found: result.postsFound,
            progress_detailed: result.postsDetailed,
            progress_failed: result.postsFailed,
            finished_at: new Date().toISOString(),
            error: result.error || null,
          })
          .eq('id', jobId);
      } catch {}

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
      try {
        const supabase = getSupabaseAdmin();
        await supabase
          .from('jobs')
          .update({
            status: 'failed',
            error: err.message,
            failure_reason: 'unknown',
            finished_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      } catch {}
    } finally {
      clearInterval(heartbeatTimer);
    }
  }
}
