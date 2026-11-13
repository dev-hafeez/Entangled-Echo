# EntangledEcho — Technical Deviations & Empirical Harmonization Log

**Document Version:** 3.0.0  
**Effective Date:** 2026-11-13  
**Scope:** Canonical record of deviations from the initial conceptual specification (`srdsfyp.pdf`), empirical audits, and statistical guardrails.

---

## 1. Structural Architecture & System Deviations

| ID | SRDS Proposal | Implementation | Scientific / Engineering Rationale |
|:---|:---|:---|:---|
| **D1** | Custom bcrypt auth & manual JWT handlers | Clerk / Supabase Auth (`@supabase/ssr`) with server BFF wrappers & 403 RBAC | Managed cryptographic password hashing, session tokens, and CSRF protection; eliminates custom auth security vulnerabilities. |
| **D2** | Serverless functions for ML optimization | Long-running containerized FastAPI (`services/ml`) on port 8001 | Machine learning embeddings, Ridge pipelines, and QUBO combinatorial optimization require stable memory and exceed serverless execution limits. |
| **D3** | Random slot swapping heuristic (Alg. 1) | QUBO formulation solved via Simulated Annealing (`dwave-samplers`) | Mathematically defensible quadratic formulation minimizing energy subject to interacting constraints (spacing, format limits, diversity). Native format for quantum annealers. |
| **D4** | Competitor private reach metrics via `/user/{handle}/media` | Public engagement only via Business Discovery (followers, media count, public likes/comments) | Meta Graph API strictly restricts impressions, reach, and non-public insights to authorized account owners. Competitor reach is unavailable from official APIs without account ownership. |
| **D5** | Custom raw WebSockets | Progressive live polling + streaming worker flush | Avoids fragile stateful socket server overhead; yields immediate UI access while background archiving continues. |
| **D6** | PostgreSQL / Supabase Database | Local Normalized JSON Storage with POSIX atomic renames (`writeJsonAtomic`) and mutex lock (`withFileLock`) | Supports 100% offline self-contained development, local reproducibility, and avoids network latency/credential barriers. Tested with 50 parallel writes with zero lost updates. |
| **D7** | Pure OAuth Ingestion Only | Hybrid: Dual Playwright scraper engine + Official Meta Graph API v19 client | Enables immediate research, demo, and evaluation on real creator profiles (1,250 accounts, 5,863 posts) without requiring Meta App Review or creator login credentials. |
| **D8** | Engagement formula $w_{l}L + w_{c}C + w_{sh}Sh + w_{sv}Sv$ (FR-16) | Target variable in ML models: $\text{log\_ER} = \ln((\text{likes} + \text{comments}) / \text{followers})$ | Shares and saves are private metrics unavailable in public Instagram web data. Including zero for missing shares/saves would artificially penalize posts. SRDS formula is supported only where Graph API insights data exists. |
| **D9** | Competitor Analysis "without scraping" (FR-32) | Meta Graph API Business Discovery or reading pre-normalized profiles from disk | Live mode uses official `business_discovery.username(handle)` API node; offline/seed mode reads already normalized snapshots from `storage/profiles/` and `storage/posts/`, requiring zero scraping at runtime. |
| **D10** | Online ML Model Retraining on Feedback (FR-24) | Per-Account Dynamic Preference Re-ranking (`formatWeights`, `likedTopics`, `dislikedTopics`) | Full gradient retraining or refitting of Ridge models on individual accept/reject actions causes catastrophic forgetting and high latency. Preference weighting dynamically boosts accepted formats (+0.35x) and downranks rejected formats (-0.40x) with zero latency. |

---

## 2. Empirical Findings & Statistical Disclaimers

### A. Non-Causal Association Wording
- **Statistical Fact**: All measured lifts (e.g., carousel lift vs. single images) represent **observational associations within historical posting sequences**, NOT proven causal mechanisms.
- **Confounders**:
  1. *Selective Format Effort*: Creators often invest significantly more production time, graphic design, and promotional budget into multi-slide carousels than spontaneous single-photo posts.
  2. *Age at Scrape (Post Maturation)*: Engagement accumulates over time; while carousel associations survive in mature posts ($\ge 30$ days), raw performance correlates with post age.
  3. *Audience Size Thresholds*: For accounts under 100K followers, sample sizes and statistical power are insufficient to confirm format associations ($p > 0.05$). All outputs for $<100\text{K}$ creators are marked `"not validated"`.

### B. Timing Signal Reality (Generic Timing Prior)
- **Empirical Finding**: Real publish timestamps are present in $100.0\%$ of clean posts. However, in strictly out-of-fold leave-creator-out cross-validation, timing features (`hour_sin`, `hour_cos`, `post_weekday`) yield **zero detectable predictive gain** ($\Delta\text{MAE} = -0.00054$).
- **Scheduler Enforcement**: The scheduler does NOT claim to possess proprietary timing intelligence. Candidate generation and schedule slot scores draw upon an explicitly labeled **generic prior distribution** rather than claiming personalized predictive timing.

### C. Within-Creator Model Validation Status
- **Empirical Benchmark B Outcome**: Full regularized Ridge models incorporating text embeddings achieve a positive point lift ($+0.0918$), but when evaluated on the rigorous tuning partition with 2,000 cluster-bootstrap draws, the 95% confidence interval is **$[-0.0196, +0.2072]$** (lower bound crosses zero).
- **Official Model Status**: The ranking model is classified as **`experimental / provisional`** in `storage/models.json`. Production candidate generation defaults to the validated format-effects association model, and single-format creators receive an explicit notice that format levers cannot be adjusted.
