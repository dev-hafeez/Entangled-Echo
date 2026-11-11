# EntangledEcho — Technical Deviations & Empirical Harmonization Log

**Document Version:** 2.0.0  
**Effective Date:** 2026-11-11  
**Scope:** Canonical record of deviations from the initial conceptual specification (`srdsfyp.pdf`), empirical audits, and statistical guardrails.

---

## 1. Structural Architecture Deviations

| ID | Initial Proposal | Implementation | Scientific / Engineering Rationale |
|:---|:---|:---|:---|
| **D1** | Custom bcrypt auth & manual JWT handlers | Clerk / Supabase Auth (`@supabase/ssr`) with server BFF wrappers | Managed cryptographic password hashing, session tokens, and CSRF protection; avoids custom crypto implementation flaws. |
| **D2** | Serverless functions for ML optimization | Long-running containerized FastAPI (`services/ml`) on port 8001 | Machine learning embeddings (MiniLM), Ridge pipelines, and QUBO combinatorial optimization require stable memory and exceed serverless execution limits. |
| **D3** | Random slot swapping heuristic | QUBO formulation solved via Simulated Annealing (`dwave-samplers`) | Mathematically defensible quadratic formulation minimizing energy subject to interacting constraints (spacing, format limits, diversity). |
| **D4** | Competitor private reach metrics | Public engagement only (likes, comments, video view counts) | Meta Graph API restricts impressions and non-public metrics to authorized account owners. Scraped public data cannot access internal reach. |
| **D5** | Custom raw WebSockets | Progressive live polling + streaming worker flush | Avoids fragile stateful socket server overhead; yields immediate UI access while background archiving continues. |

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
