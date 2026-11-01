-- EntangledEcho Backend Schema Migration
-- Applied to Supabase Postgres

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. accounts
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle TEXT UNIQUE NOT NULL,
    full_name TEXT,
    bio TEXT,
    external_link TEXT,
    avatar_url TEXT,
    is_verified BOOLEAN,
    is_business BOOLEAN,
    category TEXT,
    followers_count BIGINT,
    followers_source TEXT CHECK (followers_source IN ('page_meta', 'dom', 'network_json', NULL)),
    followers_raw_str TEXT,
    followers_precision TEXT,
    following_count BIGINT,
    following_source TEXT CHECK (following_source IN ('page_meta', 'dom', 'network_json', NULL)),
    following_raw_str TEXT,
    following_precision TEXT,
    posts_count BIGINT,
    posts_count_source TEXT CHECK (posts_count_source IN ('page_meta', 'dom', 'network_json', NULL)),
    posts_count_raw_str TEXT,
    posts_count_precision TEXT,
    last_scraped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. account_snapshots (followers/following/post_count over time, one row per scrape)
CREATE TABLE IF NOT EXISTS account_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    followers_count BIGINT,
    followers_source TEXT,
    followers_raw_str TEXT,
    followers_precision TEXT,
    following_count BIGINT,
    following_source TEXT,
    following_raw_str TEXT,
    following_precision TEXT,
    posts_count BIGINT,
    posts_count_source TEXT,
    posts_count_raw_str TEXT,
    posts_count_precision TEXT,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. posts (unique shortcode, FK account)
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    shortcode TEXT UNIQUE NOT NULL,
    url TEXT NOT NULL,
    media_type TEXT,
    media_type_source TEXT,
    caption TEXT,
    caption_source TEXT,
    hashtags TEXT[],
    mentions TEXT[],
    posted_at TIMESTAMPTZ, -- STRICT: NULL if unavailable, never defaulted to now!
    posted_at_source TEXT,
    location_tag TEXT,
    location_tag_source TEXT,
    audio_name TEXT,
    audio_name_source TEXT,
    media_urls TEXT[],
    storage_paths TEXT[],
    carousel_size INT,
    caption_embedding vector(384),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. post_snapshots (likes/comments/views over time, one row per scrape)
CREATE TABLE IF NOT EXISTS post_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    likes_count BIGINT, -- NULL if hidden, 0 if explicitly 0
    likes_source TEXT,
    likes_raw_str TEXT,
    comments_count BIGINT, -- NULL if not parsed, 0 if 0
    comments_source TEXT,
    comments_raw_str TEXT,
    views_count BIGINT, -- NULL if not reel or unavailable
    views_source TEXT,
    views_raw_str TEXT,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. comments (FK post)
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    comment_id TEXT,
    author TEXT,
    text TEXT,
    likes_count BIGINT,
    posted_at TIMESTAMPTZ,
    author_source TEXT,
    text_source TEXT,
    likes_source TEXT,
    posted_at_source TEXT,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. jobs (status queued/running/done/failed/partial/cancelled, progress counts, error, locked_at, heartbeat_at, created/started/finished)
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type TEXT NOT NULL DEFAULT 'profile',
    target_input TEXT NOT NULL,
    normalized_handle TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'partial', 'cancelled')),
    progress_found INT NOT NULL DEFAULT 0,
    progress_detailed INT NOT NULL DEFAULT 0,
    progress_failed INT NOT NULL DEFAULT 0,
    max_posts INT,
    headless BOOLEAN NOT NULL DEFAULT true,
    error TEXT,
    failure_reason TEXT,
    locked_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

-- 7. raw_captures (JSONB, FK job/account/post)
CREATE TABLE IF NOT EXISTS raw_captures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
    capture_type TEXT NOT NULL,
    endpoint_url TEXT,
    payload JSONB NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. models (type global|personal, account FK nullable, version, metrics JSONB, artifact path, row counts, trained_at)
CREATE TABLE IF NOT EXISTS models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_type TEXT NOT NULL CHECK (model_type IN ('global', 'personal')),
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    version TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    metrics JSONB NOT NULL,
    feature_importances JSONB,
    artifact_path TEXT NOT NULL,
    training_rows_count INT NOT NULL,
    trained_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. predictions (logged inputs/outputs)
CREATE TABLE IF NOT EXISTS predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID REFERENCES models(id) ON DELETE SET NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    input_features JSONB NOT NULL,
    predicted_engagement_rate DOUBLE PRECISION NOT NULL,
    model_used TEXT NOT NULL,
    confidence_note TEXT,
    top_features JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes on foreign keys, posted_at, and jobs(status)
CREATE INDEX IF NOT EXISTS idx_accounts_handle ON accounts(handle);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_account_id ON account_snapshots(account_id);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_collected_at ON account_snapshots(collected_at);

CREATE INDEX IF NOT EXISTS idx_posts_account_id ON posts(account_id);
CREATE INDEX IF NOT EXISTS idx_posts_shortcode ON posts(shortcode);
CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(posted_at);

CREATE INDEX IF NOT EXISTS idx_post_snapshots_post_id ON post_snapshots(post_id);
CREATE INDEX IF NOT EXISTS idx_post_snapshots_collected_at ON post_snapshots(collected_at);

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_locked_at ON jobs(locked_at);

CREATE INDEX IF NOT EXISTS idx_raw_captures_job_id ON raw_captures(job_id);
CREATE INDEX IF NOT EXISTS idx_raw_captures_account_id ON raw_captures(account_id);
CREATE INDEX IF NOT EXISTS idx_raw_captures_post_id ON raw_captures(post_id);

CREATE INDEX IF NOT EXISTS idx_models_type ON models(model_type);
CREATE INDEX IF NOT EXISTS idx_models_account_id ON models(account_id);

CREATE INDEX IF NOT EXISTS idx_predictions_model_id ON predictions(model_id);
CREATE INDEX IF NOT EXISTS idx_predictions_account_id ON predictions(account_id);

-- Storage buckets for media and model artifacts
INSERT INTO storage.buckets (id, name, public) 
VALUES ('post-media', 'post-media', false), ('model-artifacts', 'model-artifacts', false) 
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on every table with NO public policies
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;

-- Job queue claim function with SKIP LOCKED
CREATE OR REPLACE FUNCTION claim_next_job(worker_id TEXT DEFAULT 'worker-1', timeout_seconds INT DEFAULT 300)
RETURNS SETOF jobs AS $$
DECLARE
    claimed_job jobs;
BEGIN
    SELECT * INTO claimed_job
    FROM jobs
    WHERE status = 'queued'
       OR (status = 'running' AND heartbeat_at < now() - (timeout_seconds || ' seconds')::interval)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF FOUND THEN
        UPDATE jobs
        SET status = 'running',
            locked_at = now(),
            heartbeat_at = now(),
            started_at = COALESCE(started_at, now()),
            error = NULL
        WHERE id = claimed_job.id;

        RETURN QUERY SELECT * FROM jobs WHERE id = claimed_job.id;
    END IF;
END;
$$ LANGUAGE plpgsql;

