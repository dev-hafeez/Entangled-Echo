import { getSupabaseAdmin } from './supabase.js';
import { InstagramScraper } from '../scraper/instagram.js';
import { persistScrapeData } from './db-store.js';

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
          // No job available, sleep 5 seconds
          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch (err: any) {
        console.error(`[queue-worker] Worker loop error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  public stop(): void {
    this.isRunning = false;
    console.log(`[queue-worker] Stopping worker ${this.workerId}...`);
  }

  private async claimNextJob(): Promise<any | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('claim_next_job', {
      worker_id: this.workerId,
      timeout_seconds: 300,
    });

    if (error) {
      console.warn(`[queue-worker] Error claiming job: ${error.message}`);
      return null;
    }

    if (Array.isArray(data) && data.length > 0) {
      return data[0];
    }
    return null;
  }

  private async processJob(job: any): Promise<void> {
    const supabase = getSupabaseAdmin();
    const jobId = job.id;

    // Heartbeat timer every 20s
    const heartbeatTimer = setInterval(async () => {
      try {
        await supabase
          .from('jobs')
          .update({ heartbeat_at: new Date().toISOString() })
          .eq('id', jobId);
      } catch {}
    }, 20000);

    try {
      const scraper = new InstagramScraper({ headless: job.headless ?? true });
      const { result, rawCaptures } = await scraper.scrape(job.target_input, {
        maxPosts: job.max_posts,
        onProgress: async (p) => {
          try {
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
      });

      if (!result.success || !result.profile) {
        await supabase
          .from('jobs')
          .update({
            status: 'failed',
            failure_reason: result.failureReason || 'unknown',
            error: result.error || 'Failed to scrape profile',
            finished_at: new Date().toISOString(),
          })
          .eq('id', jobId);
        return;
      }

      // Persist to database
      await persistScrapeData({
        jobId,
        profile: result.profile,
        posts: result.posts,
        rawCaptures,
      });

      // Determine final status (partial if some posts failed, else done)
      const finalStatus =
        result.postsFailed > 0 && result.postsDetailed > 0 ? 'partial' : 'done';

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

      console.log(
        `[queue-worker] Job ${jobId} finished with status '${finalStatus}': ${result.postsDetailed} posts detailed, ${result.postsFailed} failed.`
      );
    } catch (err: any) {
      console.error(`[queue-worker] Error executing job ${jobId}: ${err.message}`);
      await supabase
        .from('jobs')
        .update({
          status: 'failed',
          error: err.message,
          failure_reason: 'unknown',
          finished_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    } finally {
      clearInterval(heartbeatTimer);
    }
  }
}
