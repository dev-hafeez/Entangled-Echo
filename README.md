# EntangledEcho — Quantum-Inspired Social Optimization & Publishing Platform

EntangledEcho is an AI-driven social media management and optimization platform tailored for creators and small businesses. It connects Instagram and Facebook accounts, ingests and normalizes engagement data, provides QUBO-based quantum-inspired post schedule optimization via simulated annealing, generates trend-aligned content recommendations, schedules and auto-publishes posts, and delivers audience analytics and alerts.

---

## 1. System Architecture

The platform is structured as an integrated monorepo:
* **Web Frontend** (`apps/web`): Next.js 14 App Router, TypeScript, Tailwind CSS, `@dnd-kit` Drag-and-Drop Calendar, Recharts analytics, Clerk authentication.
* **API Service** (`apps/api`): Node.js / Express, Playwright scraper, AES-256-GCM token encryption, 60s background publishing cron tick, local atomic JSON storage with mutual exclusion.
* **ML / Optimizer Service** (`services/ml`): Python 3.10+, FastAPI, `dimod` and `dwave-samplers` for QUBO-based simulated annealing scheduling, scikit-learn, VADER sentiment, format-effect calibration.

---

## 2. Quickstart & Setup

### Prerequisites
* **Node.js**: v20+
* **pnpm**: v12.9+
* **Python**: v3.10+ (with `pip`)
* **Operating System**: Linux / macOS recommended

### Installation & Run

1. **Clone and Install Dependencies**:
   ```bash
   pnpm install
   pip install -r services/ml/requirements.txt
   ```

2. **Configure Environment**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

3. **Start All Services**:
   ```bash
   ./run.sh
   ```
   Or using Docker Compose:
   ```bash
   docker compose up --build
   ```

Services will be accessible at:
* **Web Application**: [http://localhost:3000](http://localhost:3000)
* **Admin Control Panel**: [http://localhost:3000/admin](http://localhost:3000/admin) (Default password: `admin123`)
* **API Backend**: [http://localhost:4000](http://localhost:4000)
* **ML Optimizer**: [http://localhost:8001](http://localhost:8001)

---

## 3. Data Modes (`DATA_MODE`)

The data layer supports three distinct operating modes configured via the `DATA_MODE` environment variable:

1. **`DATA_MODE=seed` (Default / Development / Demo)**:
   * Uses real, pre-scraped and normalized creator profiles and posts stored locally in `storage/profiles/` and `storage/posts/` (1,250 creators, 5,863 posts).
   * Fully offline: Requires zero external Meta Graph API tokens or scraping during runtime.
2. **`DATA_MODE=mock`**:
   * Uses static in-memory fixtures and simulated network delays for fast, deterministic unit and integration testing.
3. **`DATA_MODE=live`**:
   * Calls the official Meta Graph API v19 for authenticated Instagram Business / Creator accounts and Facebook Pages.
   * Fetches real user insights (`reach`, `impressions`, `shares`, `saved`), audience demographics (`audience_gender_age`, `audience_country`), and publishes media via the container creation flow.

---

## 4. Environment Variables (`.env.example`)

```ini
# Operating Mode
DATA_MODE=seed                    # live | seed | mock

# Security & Secrets
ADMIN_PASSWORD=admin123
TOKEN_ENC_KEY=                    # 32 random bytes, base64 or hex (used for AES-256-GCM token encryption at rest)
INTERNAL_TICK_SECRET=             # Shared secret for /internal/tick

# Services
PORT=4000
NEXT_PUBLIC_API_URL=http://localhost:4000
AI_SERVICE_URL=http://localhost:8001

# Meta Graph API (Optional for live mode)
META_APP_ID=
META_APP_SECRET=
META_GRAPH_ACCESS_TOKEN=
META_IG_ACCOUNT_ID=
META_GRAPH_VERSION=v19.0

# LLM Recommendation Provider
LLM_PROVIDER=mock                 # gemini | mock
GEMINI_API_KEY=                   # Google Gemini API Key (starts with AIzaSy...)

# Email Provider
EMAIL_PROVIDER=mock               # smtp | mock
SMTP_HOST=127.0.0.1
SMTP_PORT=10255
EMAIL_FROM=notifications@entangled-echo.internal

# Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
```

---

## 5. Verification & Benchmark Test Suite

All claims, requirements, and NFRs are validated by standalone test scripts in `scripts/`:

```bash
# Security & RBAC Tests
./apps/api/node_modules/.bin/tsx scripts/test_path_traversal.ts           # Path traversal & handle regex
./apps/api/node_modules/.bin/tsx scripts/test_upload_security.ts          # Magic bytes, size limit, Sharp re-encode
./apps/api/node_modules/.bin/tsx scripts/test_security_headers.ts         # Next.js security headers
./apps/api/node_modules/.bin/tsx scripts/test_token_encryption.ts         # AES-256-GCM encryption at rest (FR-08)
./apps/api/node_modules/.bin/tsx scripts/test_admin_auth.ts               # Admin role 403 checks (FR-06)
python scripts/scan_secrets.py                                            # Git history & code secret scan

# Functional Requirements (FR) Verification
./apps/api/node_modules/.bin/tsx scripts/test_fr24_feedback.ts            # FR-24 Accept/Reject learning loop
./apps/api/node_modules/.bin/tsx scripts/test_publishing_bench_and_retry.ts # FR-26/27/28 Publish bench & retry backoff
./apps/api/node_modules/.bin/tsx scripts/test_csv_export_count.ts         # FR-31 CSV export row count match
./apps/api/node_modules/.bin/tsx scripts/test_email_smtp_sink.ts          # FR-34 Live RFC 5321 SMTP email sink

# Non-Functional Requirements (NFR) Benchmarks
python scripts/benchmark_scheduler_runtime.py                             # NFR 4.1.3 Scheduler 30d/5-account (<10s)
./apps/api/node_modules/.bin/tsx scripts/test_concurrent_storage_writes.ts # JSON concurrent-write integrity (50 writes)
./apps/api/node_modules/.bin/tsx scripts/benchmark_caption_latency.ts     # NFR 4.1.4 Cold-cache caption latency (<5s)
./apps/api/node_modules/.bin/tsx scripts/test_publish_within_60s.ts       # NFR 4.1.5 Publishing within 60s
./apps/api/node_modules/.bin/tsx scripts/test_500_post_sync.ts            # NFR 4.1.6 500-post sync timing (<5 min)
./apps/api/node_modules/.bin/tsx scripts/benchmark_100_vus_crud.ts        # NFR 4.1.2 100 concurrent VUs CRUD test
./apps/api/node_modules/.bin/tsx scripts/benchmark_dashboard_load.ts      # NFR 4.1.1 Dashboard load latency
```

---

## 6. Known Limitations & Deviations

1. **Shares & Saves in Public Data (FR-16)**:
   * Instagram does not expose private metrics (`shares`, `saved`, `reach`) in public DOM or unauthenticated endpoints. These fields are strictly `null` for public scraped profiles and only populated when an account connects via Meta Graph API with `instagram_manage_insights`.
   * The ML models use log-engagement rate $\ln((\text{likes} + \text{comments}) / \text{followers})$ as the target.
2. **Competitor Reach & Demographics (FR-30, FR-32)**:
   * Meta Graph API enforces strict privacy boundaries: Competitor `reach`, `impressions`, and `demographics` cannot be queried for accounts you do not own. Competitor analysis uses Meta Business Discovery (public metrics: followers, media count, public likes/comments) or normalized local profiles.
3. **Cold-Cache Dashboard Load (NFR 4.1.1)**:
   * Cold-cache dashboard load averages 5.68 s (exceeding the 3.0 s target) due to initial SSR bundle evaluation and Clerk auth handshake redirect overhead. Warm cached page loads average 715 ms (passing SLA).
4. **Quantum-Inspired Solver (FR-17)**:
   * The scheduler formulates post assignment as a Quadratic Unconstrained Binary Optimization (QUBO) problem solved classically with D-Wave's Simulated Annealing Sampler (`dwave-samplers`). It is "quantum-inspired" and does not require quantum hardware.
