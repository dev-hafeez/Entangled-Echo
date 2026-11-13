import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';

export interface LocalJob {
  id: string;
  target_type: 'handle' | 'profile_url' | 'post_url';
  target_input: string;
  normalized_handle: string;
  max_posts: number | null;
  headless: boolean;
  status: 'queued' | 'running' | 'done' | 'failed' | 'partial' | 'cancelled';
  claimed_by: string | null;
  claimed_at: string | null;
  heartbeat_at: string | null;
  progress_found: number | null;
  progress_detailed: number | null;
  progress_failed: number | null;
  failure_reason: string | null;
  error: string | null;
  session_authenticated?: boolean;
  scraper_version?: string;
  created_at: string;
  finished_at: string | null;
}

class LocalJobQueue {
  private jobs: LocalJob[] = [];
  private filePath: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isPaused: boolean = false; // RESUMED by default for active live scraping

  constructor() {
    this.filePath = path.join(config.localStorageDir, 'jobs.json');
    this.load();
  }

  public setPaused(paused: boolean) {
    this.isPaused = paused;
    console.log(`[local-queue] Queue active state set to: ${paused ? 'PAUSED' : 'RESUMED'}`);
  }

  public getPaused(): boolean {
    return this.isPaused;
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.jobs = parsed;
          console.log(`[local-queue] Loaded ${this.jobs.length} jobs from ${this.filePath}`);
          return;
        }
      }
    } catch (e: any) {
      console.warn(`[local-queue] Warning reading ${this.filePath}:`, e.message);
    }
    this.jobs = [];
  }

  private persist() {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      try {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(this.jobs, null, 2));
      } catch (e: any) {
        console.error(`[local-queue] Failed to save jobs to disk:`, e.message);
      }
    }, 100);
  }

  private persistSync() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.jobs, null, 2));
    } catch (e: any) {
      console.error(`[local-queue] Failed to save jobs to disk:`, e.message);
    }
  }

  public enqueue(
    inputs: Array<{
      target_type: 'handle' | 'profile_url' | 'post_url';
      target_input: string;
      normalized_handle: string;
      max_posts?: number | null;
      headless?: boolean;
    }>
  ): LocalJob[] {
    const now = new Date().toISOString();
    const newJobs: LocalJob[] = inputs.map((item) => ({
      id: crypto.randomUUID(),
      target_type: item.target_type,
      target_input: item.target_input,
      normalized_handle: item.normalized_handle,
      max_posts: item.max_posts ?? 36,
      headless: item.headless ?? true,
      status: 'queued',
      claimed_by: null,
      claimed_at: null,
      heartbeat_at: null,
      progress_found: 0,
      progress_detailed: 0,
      progress_failed: 0,
      failure_reason: null,
      error: null,
      created_at: now,
      finished_at: null,
    }));

    // Prepend new jobs so they appear at top of list
    this.jobs = [...newJobs, ...this.jobs];
    this.persistSync();
    console.log(`[local-queue] Enqueued ${newJobs.length} jobs. Total queue size: ${this.jobs.length}`);
    return newJobs;
  }

  public claimNext(workerId: string): LocalJob | null {
    if (this.isPaused) {
      return null;
    }
    const now = new Date();
    // 1. Find oldest queued job
    // Also re-claim jobs stuck in 'running' whose heartbeat is older than 5 minutes
    const staleThreshold = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const j = this.jobs[i];
      const isQueued = j.status === 'queued';
      const isStale = j.status === 'running' && (!j.heartbeat_at || j.heartbeat_at < staleThreshold);

      if (isQueued || isStale) {
        j.status = 'running';
        j.claimed_by = workerId;
        j.claimed_at = now.toISOString();
        j.heartbeat_at = now.toISOString();
        this.persist();
        return j;
      }
    }
    return null;
  }

  public updateHeartbeat(jobId: string) {
    const j = this.jobs.find((job) => job.id === jobId);
    if (j) {
      j.heartbeat_at = new Date().toISOString();
      this.persist();
    }
  }

  public updateProgress(
    jobId: string,
    progress: { found?: number; detailed?: number; failed?: number }
  ) {
    const j = this.jobs.find((job) => job.id === jobId);
    if (j) {
      if (progress.found !== undefined) j.progress_found = progress.found;
      if (progress.detailed !== undefined) j.progress_detailed = progress.detailed;
      if (progress.failed !== undefined) j.progress_failed = progress.failed;
      j.heartbeat_at = new Date().toISOString();
      this.persist();
    }
  }

  public finishJob(
    jobId: string,
    result: {
      status: 'done' | 'failed' | 'partial';
      normalized_handle?: string;
      progress_found?: number;
      progress_detailed?: number;
      progress_failed?: number;
      failure_reason?: string | null;
      error?: string | null;
      session_authenticated?: boolean;
      scraper_version?: string;
    }
  ) {
    const j = this.jobs.find((job) => job.id === jobId);
    if (j) {
      j.status = result.status;
      if (result.normalized_handle) j.normalized_handle = result.normalized_handle;
      if (result.progress_found !== undefined) j.progress_found = result.progress_found;
      if (result.progress_detailed !== undefined) j.progress_detailed = result.progress_detailed;
      if (result.progress_failed !== undefined) j.progress_failed = result.progress_failed;
      if (result.failure_reason !== undefined) j.failure_reason = result.failure_reason;
      if (result.error !== undefined) j.error = result.error;
      if (result.session_authenticated !== undefined) j.session_authenticated = result.session_authenticated;
      if (result.scraper_version !== undefined) j.scraper_version = result.scraper_version;
      j.finished_at = new Date().toISOString();
      this.persistSync();
    }
  }

  public retryJob(id: string): boolean {
    const j = this.jobs.find((job) => job.id === id);
    if (j) {
      j.status = 'queued';
      j.claimed_by = null;
      j.claimed_at = null;
      j.heartbeat_at = null;
      j.progress_found = 0;
      j.progress_detailed = 0;
      j.progress_failed = 0;
      j.failure_reason = null;
      j.error = null;
      j.finished_at = null;
      this.persistSync();
      return true;
    }
    return false;
  }

  public cancelJob(id: string): boolean {
    const j = this.jobs.find((job) => job.id === id);
    if (j) {
      j.status = 'cancelled';
      j.finished_at = new Date().toISOString();
      this.persistSync();
      return true;
    }
    return false;
  }

  public deleteJob(id: string): boolean {
    const initialLen = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.id !== id);
    if (this.jobs.length !== initialLen) {
      this.persistSync();
      return true;
    }
    return false;
  }

  public clearJobs(type: 'completed' | 'queued' | 'all'): number {
    const initialLen = this.jobs.length;
    if (type === 'all') {
      this.jobs = [];
    } else if (type === 'completed') {
      this.jobs = this.jobs.filter((j) => j.status !== 'done' && j.status !== 'failed' && j.status !== 'partial' && j.status !== 'cancelled');
    } else if (type === 'queued') {
      this.jobs = this.jobs.filter((j) => j.status !== 'queued');
    }
    const removed = initialLen - this.jobs.length;
    this.persistSync();
    return removed;
  }

  public queryJobs(params: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { status = 'all', search = '', page = 1, limit = 100 } = params;

    // Summary counts
    const summary = {
      total: this.jobs.length,
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const j of this.jobs) {
      if (j.status === 'queued') summary.queued++;
      else if (j.status === 'running') summary.running++;
      else if (j.status === 'done') summary.done++;
      else if (j.status === 'failed' || j.status === 'partial') summary.failed++;
      else if (j.status === 'cancelled') summary.cancelled++;
    }

    // Filter
    let filtered = this.jobs;
    if (status && status !== 'all') {
      if (status === 'failed') {
        filtered = filtered.filter((j) => j.status === 'failed' || j.status === 'partial');
      } else {
        filtered = filtered.filter((j) => j.status === status);
      }
    }

    if (search && search.trim().length > 0) {
      const term = search.trim().toLowerCase();
      filtered = filtered.filter(
        (j) =>
          j.target_input.toLowerCase().includes(term) ||
          j.normalized_handle.toLowerCase().includes(term)
      );
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const pagedJobs = filtered.slice(offset, offset + limit);

    return {
      jobs: pagedJobs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      summary,
    };
  }
}

export const localJobQueue = new LocalJobQueue();
