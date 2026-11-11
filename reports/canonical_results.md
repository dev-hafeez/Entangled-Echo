# Canonical Empirical Results & Benchmark Source of Truth

> **Status**: AUTHORITATIVE SOURCE OF TRUTH (Post-Audit 2026-11-11)
> **Protocol Reference**: [`docs/EVAL_PROTOCOL.md`](../docs/EVAL_PROTOCOL.md)
> **Precedence Note**: All prior claims (e.g. uncalibrated lift claims `+0.0774`, unadjusted carousel margins `+0.62–0.73`, or unvalidated global timing claims) are strictly superseded by this document.

---

## 1. Primary Estimand & Metric Conventions
- **Estimand**: Within-creator pairwise ranking and Top-1 lift under leave-creator-out nested cross-validation.
- **Evaluation Metric**: Candidate pool normalized Top-1 residual lift ($E[\text{residual}(\text{selected})] - E[\text{residual}(\text{random})]$) computed over 3-candidate candidate sets.
- **Inference**: Creator-clustered 2,000-draw non-parametric bootstrap confidence intervals (95% CI).
- **Holdout Status**: 20% creator holdout split frozen in `storage/splits/final_holdout_split.json` (`c324a3ffab0890eb2518aeaaf940ca46ae88896d`), untouched during model iteration.

---

## 2. Corrected Phase 2 Baseline Ladder & Trailing-Mean Diagnostics

### Trailing-Mean Pathology Diagnosis
The trailing-mean baselines (`prev_3`, `prev_10`) previously exhibited negative scores due to two empirical facts:
1. **Intra-Creator Mean Reversion**: Successive posts within creators show statistically significant negative autocorrelation ($\text{mean Spearman } \rho = -0.1428$ [95% CI: -0.1841, -0.1024]; 66.1% of creators exhibit negative correlation).
2. **Pool Position Skew**: In test pools ordered chronologically, selecting by trailing mean over-indexed on recent, un-matured items, inducing an artificial penalty.
3. **Synthetic Recovery**: Injected $+0.50$ synthetic format boost was recovered by the pipeline with $+0.2818$ delta over random.

### Bounding Arms & Ladder Table
| Model / Arm | Top-1 Lift (vs Pool Mean) [95% CI] | Lift vs Random [95% CI] | Status |
| :--- | :--- | :--- | :--- |
| **Oracle Best (Upper Bound)** | **+0.5734** [+0.4592, +0.6802] | **+0.7896** [+0.6698, +0.9061] | Theoretical Max |
| **Anti-Oracle Worst (Lower Bound)** | **-0.9945** [-1.1069, -0.8838] | **-0.7783** [-0.9008, -0.6558] | Theoretical Min |
| **Random Baseline** | **-0.2162** [-0.3129, -0.1226] | **0.0000** [0.0000, 0.0000] | Benchmark Reference |
| **Best-Format-for-Creator** | **-0.0806** [-0.2009, +0.0308] | **+0.1356** [+0.0210, +0.2443] | Validated Baseline |
| **Format + Relative Time (Circ)** | **-0.0462** [-0.1746, +0.0782] | **+0.1700** [+0.0526, +0.2810] | Exploratory (CI overlaps format) |
| **Format + RelTime + Meta (Cap Len/Tags)** | **-0.0074** [-0.1388, +0.1140] | **+0.2088** [+0.0898, +0.3207] | Exploratory |
| **Full Regularized Ridge** | **+0.0331** [-0.0998, +0.1550] | **+0.2493** [+0.1345, +0.3582] | Validated Ranking Model |

- **Marginal Lift of Full Ridge vs Best-Format**: $+0.1137$ [95% CI: $+0.0008, +0.2278$]. Marginally exceeds best format at $\alpha=0.05$, but format remains the dominant observable signal.

---

## 3. Timing Sensitivity (Relative Hour & Day-of-Week)
- **Hypothesis**: Post timing relative to the creator's own median posting hour exhibits actionable lift.
- **Finding**: While circular relative hour $(h - h_{\text{med}})_{\text{circ}}$ improves lift from $-0.0939$ to $-0.0462$, the incremental lift over the static Best-Format baseline is $+0.0345$ [95% CI: $-0.0815, +0.1542$] (includes zero).
- **Verdict**: Timing signal is **statistically null** after creator and format conditioning. Production scheduler strictly uses `timing_status: generic_prior`.

---

## 4. Scraper Author Detection & Snapshot Integrity
- **Snapshot Audit**: 5,758 / 5,863 posts (98.21%) strictly match storage author handle; 0 author mismatches detected; 105 unknown/unparseable (1.79%).
- **Coauthors/Collabs**: 362 posts contain author handle in post mentions (self-tags or collaboration tags).
- **Leakage Audit**: All trailing features strictly adhere to $t_{\text{prev}} < t_{\text{curr}}$.

---

## 5. Post Age Sensitivity & Format Effect Robustness
- **Window Restriction**: Evaluated on mature posts aged 30–180 days at scrape ($N=1,898$ posts across 373 creators with $\ge 100\text{K}$ followers).
- **Multivariate OLS ($\log(\text{ER}) \sim \text{Format} + \log(\text{Age})$)**:
  - Carousel coefficient: **+0.1247** ($p=0.074$)
  - Video/Reel coefficient: **-0.2911** ($p=2.6 \times 10^{-5}$)
  - Controlled Carousel vs. Video gap: **+0.4158**
  - $\log(\text{Age in days})$ covariate: **+0.1077** ($p=0.015$)
- **Intra-Creator Paired Gap (Creators with both formats in 30–180d window, $N=191$)**:
  - Carousel vs Video Mean Difference: **+0.6457** [95% Creator-Clustered Bootstrap CI: **+0.4900, +0.8086**].
- **Conclusion**: The format effect (Carousel > Video) is genuine, highly statistically significant, and robust to post age maturation.

---

## 6. Uncertainty Calibration & Plain-Language Translation
- **Log Residual Margin**: Calibrated empirical 80% conformal interval half-width is $q_{0.80} = 1.15$ log-points ($\pm 1.15$).
- **Multiplicative Margin**:
  $$\exp(\pm 1.15) \approx [0.32\times, 3.16\times]$$
- **Plain-Language Phrasing**:
  > *"A typical post's performance varies about 3x either way (80% confidence interval: [0.3x, 3.2x])."*
- **Status Gate**: Creators under 100K followers or $<10$ historical posts receive `status: unvalidated / low_data`.

---

## 7. Scheduler Benchmark (Simulated Annealing vs Greedy vs Exact)
Benchmarked over 25 realistic candidate instances ($N=14$ candidates, $K=4$ slots, min gap = 18h):
- **Exact Brute-Force Match**: Simulated Annealing (SA) achieved a **0.0000** optimality gap across all 25 instances [95% CI: 0.0000, 0.0000].
- **SA vs Greedy**:
  - SA Better than Greedy: **13 / 25 instances (52.0%)**
  - SA Tied with Greedy: **12 / 25 instances (48.0%)**
  - SA Worse than Greedy: **0 / 25 instances (0.0%)**
  - Mean Objective Improvement (SA vs Greedy): **-0.9558** [95% CI: -1.6944, -0.2970].
  - Greedy Optimality Gap vs Exact: **0.9558** [95% CI: 0.2970, 1.6944].
- **Execution Latencies**:
  - Simulated Annealing: $61.0\text{ ms}$
  - Greedy: $7.1\text{ ms}$
- **Conclusion**: Simulated Annealing provides concrete value by avoiding local spacing and format conflict traps where greedy heuristic gets blocked.
