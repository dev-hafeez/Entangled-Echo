# EntangledEcho — System Walkthrough & Demo Script

> **Status**: Verified & Operational  
> **Modes**: Fully functional offline (`DATA_MODE=seed` or `DATA_MODE=mock`); optional authenticated live Meta Graph API (`DATA_MODE=live`).

---

## 1. Quickstart Launch

Start all 3 services (Next.js Web on `:3000`, Express API on `:4000`, Python ML on `:8001`):

```bash
./run.sh
```

Or using Docker:

```bash
docker compose up --build
```

---

## 2. Walkthrough Steps & Expected Outputs

### Step 1: Dashboard (`http://localhost:3000/dashboard`)
* **Mode**: Stored Normalized Data (5,863 real posts across 1,250 creators in `storage/posts/`).
* **Actions**:
  1. Open `http://localhost:3000/dashboard?handle=cristiano`.
  2. View KPI cards (Total Posts: 60, Engagement Rate: 2.76%, Dominant Format: Video/Reel).
  3. Inspect Engagement Heatmap (Day × Hour) and Historical Posts Grid.
  4. Click **Download CSV Export** button.
* **Expected Output**:
  - Browser downloads `cristiano_metrics_export.csv`.
  - Exactly 60 data rows matching stored posts on disk (verified by `scripts/test_csv_export_count.ts`).

---

### Step 2: AI Recommendations & Trend Crossover (`http://localhost:3000/recommendations`)
* **Mode**: Hybrid (Live Google Search Trends RSS + Localized LLM / Deterministic Generator).
* **Actions**:
  1. Navigate to `/recommendations?handle=cristiano`.
  2. View 3 crafted post recommendations bridging live Google Trends with Cristiano's athletic/discipline niche.
  3. Inspect the **Dominant Format Recommendation** card (`reel` / +28.0% lift).
  4. Click **Accept** or **Reject** on a recommendation card.
* **Expected Output**:
  - Feedback dispatched to `POST /api/recommendations/feedback`.
  - Format weights adjust dynamically (e.g. rejecting a reel boosts carousel format weight from 1.0x to 1.35x, verified by `scripts/test_fr24_feedback.ts`).
  - Toast confirmation: *"Feedback recorded: format preference updated"*.

---

### Step 3: Interactive Calendar & Scheduling (`http://localhost:3000/calendar`)
* **Mode**: Fully Functional (`@dnd-kit` Drag-and-Drop + State Machine).
* **Actions**:
  1. Navigate to `/calendar`.
  2. Click any calendar time slot (e.g. Wednesday 18:00) to open **Schedule Post** modal.
  3. Enter caption: *"Training session focus #discipline"*, select media type `image`, click **Schedule Post**.
  4. Drag the post card to Friday 20:00 to reschedule.
* **Expected Output**:
  - Post is created with status `SCHEDULED`.
  - Saved atomically to `storage/scheduled_posts/{userId}.json` via `writeJsonAtomic`.
  - Drag-and-drop updates `scheduledTime` immediately.

---

### Step 4: Automated 60-Second Publishing Tick (`/internal/tick`)
* **Mode**: Mock Provider (Offline) or Live Meta Graph API (when `META_GRAPH_ACCESS_TOKEN` is supplied).
* **Actions**:
  1. Scheduled post due time arrives (or trigger manually via `curl -X POST http://localhost:4000/internal/tick`).
  2. Scheduler processes due posts (`scheduledTime <= now`).
* **Expected Output**:
  - Status transitions: `SCHEDULED` &rarr; `PUBLISHING` &rarr; `PUBLISHED`.
  - Latency verified within 20s of slot time (SLA &le; 60s, verified by `scripts/test_publish_within_60s.ts`).
  - An in-app alert is generated in `storage/notifications/{userId}.json`.

---

### Step 5: Notifications & Alerts (`http://localhost:3000/notifications`)
* **Mode**: In-App Notification Store + SMTP Sink for Weekly Digests.
* **Actions**:
  1. Open `/notifications` to view real-time publishing alerts and AI insights.
  2. Click **Mark as Read**.
* **Expected Output**:
  - Badge count resets to 0.
  - Weekly digest email generation verified against local RFC 5321 SMTP sink (verified by `scripts/test_email_smtp_sink.ts`).

---

### Step 6: Settings & Preferences (`http://localhost:3000/settings`)
* **Mode**: Fully Functional (No fake numbers, only in-scope Instagram/Facebook accounts).
* **Actions**:
  1. Navigate to `/settings`.
  2. Select active timezone (e.g. `America/New_York` or `Asia/Karachi`).
  3. Select default scheduled post status (`SCHEDULED` vs `DRAFT`).
  4. Click **Save Preferences**.
* **Expected Output**:
  - Persisted to browser storage; calendar reference times adjust.
  - Connected account status shows encryption status (`AES-256-GCM`).

---

### Step 7: Administrative Control Panel (`http://localhost:3000/admin`)
* **Mode**: Role-Protected (FR-06).
* **Actions**:
  1. Access `/admin` without credentials &rarr; HTTP 403 Forbidden.
  2. Log in with password `admin123`.
  3. View Scrape Queue, Model Registry, and Account Database.
* **Expected Output**:
  - Role check verified by `scripts/test_admin_auth.ts`.
  - 1,250 tracked creator profiles rendered with real completeness metrics.

---

## 3. Summary of Mock vs. Live Components

| Component | In Mock / Offline Mode | In Live Mode | Evidence Script |
| :--- | :--- | :--- | :--- |
| **Instagram / Facebook Graph API** | Stored profiles & posts (`storage/`) | Meta Graph API v19 container creation | `test_publishing_bench_and_retry.ts` |
| **Token Security** | AES-256-GCM encrypted in `storage/tokens/` | AES-256-GCM encrypted at rest | `test_token_encryption.ts` |
| **Email Digests** | Logged to console / Local SMTP Sink (`net.createServer`) | Resend / SMTP server | `test_email_smtp_sink.ts` |
| **LLM Generations** | Deterministic trend adapter + template generator | Google Gemini API (`AIzaSy...`) | `benchmark_caption_latency.ts` |
| **Scheduler Optimizer** | Simulated Annealing (`dwave-samplers` / `dimod`) | QUBO on quantum annealer hardware | `benchmark_scheduler_runtime.py` |
