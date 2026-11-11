# EntangledEcho — Rigorous Evaluation Protocol

**Document Version:** 1.0.0  
**Effective Date:** 2026-11-11  
**Scope:** Formal statistical protocol for all model benchmarking, candidate ranking, and claim verification in EntangledEcho.

---

## 1. Primary Estimand & Metric Specifications

The central function of EntangledEcho is **within-creator candidate post ranking**: given a creator and a set of candidate post options (varying by media format, timing, caption length, semantic topics), select the post that maximizes relative engagement.

### Core Estimands:
1. **Top-1 Residualized Lift vs. Random**:
   $$\text{Lift}_{\text{resid}} = \tilde{y}_{\text{selected}} - \frac{1}{|P|} \sum_{p \in P} \tilde{y}_p$$
   where $\tilde{y}$ is the age-residualized log-engagement-rate outcome ($\log(\text{ER}) - \hat{f}(\text{age})$) demeaned by the creator's historical training baseline, and $P$ is the candidate pool (e.g. chronological holdout posts).
2. **Pairwise Accuracy**:
   $$\text{Acc}_{\text{pairwise}} = \frac{1}{\sum_{i < j} 1} \sum_{i < j} \mathbb{I}\left( (\hat{s}_i > \hat{s}_j) == (y_i > y_j) \right)$$
   evaluating whether relative score order agrees with relative empirical engagement.
3. **Within-Creator Spearman Rank Correlation**:
   $$\rho_{\text{creator}} = \text{Spearman}(\hat{s}, y)$$
   averaged across creators with variance in outcomes.

### Resampling & Inference:
- All confidence intervals are computed via **Cluster-Bootstrap over Creators** with **2,000 draws** (resampling entire creator trajectories with replacement to respect intra-creator correlation).
- Paired differences ($\Delta = \text{Metric}_{\text{model}} - \text{Metric}_{\text{baseline}}$) are computed on identical bootstrap resamples.

---

## 2. Pre-Specified Hypotheses & Baselines

All hypotheses are specified in advance. Confirmatory testing uses the **Holm-Bonferroni step-down procedure** across the confirmatory family to strictly control Family-Wise Error Rate (FWER) at $\alpha = 0.05$.

### Confirmatory Family ($m = 3$):
- **H1 (Format Hierarchy)**: In creators with $>100\text{K}$ followers, Carousel lift is strictly greater than zero and Video/Reel lift is strictly less than zero under creator fixed-effects OLS.
- **H2 (Content/Caption Signal)**: Within fixed format-time cells, semantic caption embeddings and text features predict relative lift with mean within-cell Spearman $> 0$.
- **H3 (Model Value-Add)**: The full ranking model beats the best-format-for-creator heuristic on age-residualized Top-1 lift with the lower bound of the 95% bootstrap CI strictly excluding zero ($\Delta > 0$).

### Baseline Ladder (Evaluated on Identical Folds):
1. **Arm 0: Random Selection** (expected mean across candidate pool)
2. **Arm 1: Creator Trailing Mean** (prev-3 and prev-10 historical anchor)
3. **Arm 2: Best-Format-for-Creator** (mode / highest historical mean format for that account)
4. **Arm 3: Format Effects Only** (cohort lookup table by follower tier)
5. **Arm 4: Format + Time** (restricted to real-timestamp observations)
6. **Arm 5: Format + Time + Caption Length / Hashtags**
7. **Arm 6: Full Regularized Model** (+ MiniLM text embeddings)

---

## 3. Power Analysis & Minimum Posts per Creator Cutoff

- **Empirical Variance**: In Snapshot `2026-11-03-clean-v2`, the within-creator standard deviation of $\log(\text{engagement})$ is $\sigma \approx 0.94 - 0.99$.
- **Candidate Pool**: 3 held-out chronological test posts per creator ($N_{\text{test}} = 3$).
- **History Requirement**: Fitting trailing history anchors and creator baseline requires at least 4 historical posts ($N_{\text{train}} \ge 4$).
- **Minimal Detectable Effect (MDE)**:
  - For $N = 390$ creators ($\ge 8$ posts), with $\alpha = 0.05$ (two-tailed) and power $1 - \beta = 0.80$, the MDE for a paired delta in Top-1 lift is:
    $$\text{MDE} = (z_{0.975} + z_{0.80}) \frac{\sigma_{\Delta}}{\sqrt{N}} = (1.96 + 0.84) \frac{0.50}{\sqrt{390}} \approx 0.071$$
- **Protocol Cutoff Rule**:
  - Minimum posts per creator for Benchmark B ranking is **$\ge 8$ posts** ($N_{\text{train}} \ge 5$, $N_{\text{test}} = 3$).
  - For general sequence modeling, minimum cutoff is **$\ge 5$ posts**. Creators with $<5$ posts trigger the `"unvalidated / low data"` flag and fall back to cohort priors.

---

## 4. Holdout & Tuning Protocol

- **Final Holdout Freeze**: A seeded random sample of **20% of creators (156 creators, seed 42)** is frozen in `storage/splits/final_holdout_split.json`.
- **Zero Peeking Guarantee**: The holdout set is touched strictly ONCE at the end of the evaluation.
- **Cross-Validation**: All model tuning, hyperparameter search, and ablation benchmarking are performed strictly on the remaining 80% (622 creators) using **5-Fold GroupKFold** grouped by creator.
- **Model Selection Rule**: Compare a heavily regularized Ridge model first against non-linear models. If the 95% bootstrap CIs overlap, the simpler, more regularized model is selected.
