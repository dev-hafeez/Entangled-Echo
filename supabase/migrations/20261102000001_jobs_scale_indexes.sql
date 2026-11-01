-- Scale indexes for high-volume jobs queue (supporting thousands of enqueued profiles)

CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at ON jobs (status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_target_input ON jobs (target_input);
CREATE INDEX IF NOT EXISTS idx_jobs_normalized_handle ON jobs (normalized_handle);
