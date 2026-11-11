import os
import json
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Tuple
from sklearn.model_selection import GroupKFold
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge
import statsmodels.api as sm
from scipy.stats import spearmanr

from scripts.run_part_a_rigorous import load_data

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
EMBEDDINGS_DIR = os.path.join(STORAGE_DIR, "embeddings")
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports")
SPLITS_DIR = os.path.join(STORAGE_DIR, "splits")

def cluster_bootstrap_ci(arr, n_boot=2000, seed=42):
    arr = np.array(arr)
    arr = arr[~np.isnan(arr)]
    if len(arr) == 0:
        return np.nan, (np.nan, np.nan)
    rng = np.random.default_rng(seed)
    indices = rng.integers(0, len(arr), size=(n_boot, len(arr)))
    boot_means = np.mean(arr[indices], axis=1)
    return float(np.mean(arr)), (float(np.percentile(boot_means, 2.5)), float(np.percentile(boot_means, 97.5)))

def main():
    print("=" * 80)
    print("TASK 1 & 2: TRAILING-MEAN DIAGNOSTICS & RELATIVE TIMING EXPLORATION")
    print("=" * 80)

    # 1. Load data
    df = load_data()
    caption_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "caption_minilm_embeddings.npy"))

    with open(os.path.join(SPLITS_DIR, "final_holdout_split.json"), "r") as f:
        split = json.load(f)
    train_creators = set(split["train_creators"])
    df_tune = df[df["handle"].isin(train_creators)].copy().reset_index(drop=True)
    tune_embeds = caption_embeds[df["handle"].isin(train_creators).values]

    c_stats = df_tune.groupby("handle").agg(n_posts=("shortcode", "count"), n_types=("media_type", "nunique"))
    qualifying_creators = c_stats[(c_stats["n_posts"] >= 8) & (c_stats["n_types"] >= 2)].index.tolist()
    print(f"Qualifying tuning creators (>=8 posts, multi-format): {len(qualifying_creators)} creators.")

    # -------------------------------------------------------------------------
    # PART 1D: Mean Reversion Test
    # -------------------------------------------------------------------------
    mean_reversion_corrs = []
    for h in qualifying_creators:
        c_df = df_tune[df_tune["handle"] == h].sort_values("posted_at_dt")
        h_mean = c_df["log_er"].mean()
        residuals = c_df["log_er"].values - h_mean
        p3 = c_df["prev_3_mean"].values
        valid = ~np.isnan(p3)
        if np.sum(valid) >= 4 and np.std(p3[valid]) > 0 and np.std(residuals[valid]) > 0:
            r, _ = spearmanr(p3[valid], residuals[valid])
            if not np.isnan(r):
                mean_reversion_corrs.append(r)

    mr_mean, mr_ci = cluster_bootstrap_ci(mean_reversion_corrs)
    mr_neg_pct = float(np.mean(np.array(mean_reversion_corrs) < 0) * 100)
    print(f"\n[Part 1d] Mean Reversion Diagnostics:")
    print(f"  Correlation of Trailing Mean with Current Post Residual: {mr_mean:+.4f} [{mr_ci[0]:+.4f}, {mr_ci[1]:+.4f}]")
    print(f"  Percentage of creators showing negative correlation (mean reversion): {mr_neg_pct:.1f}%")

    # -------------------------------------------------------------------------
    # PART 1A, 1B, 1C: Baseline Ladder with Oracle, Anti-Oracle, Synthetic Injection, and Sign Convention
    # -------------------------------------------------------------------------
    pools = {}
    for h in qualifying_creators:
        c_df = df_tune[df_tune["handle"] == h].sort_values("posted_at_dt")
        hist = c_df.iloc[:-3]
        test = c_df.iloc[-3:]
        hist_mean_log_er = hist["log_er"].mean()
        pools[h] = {
            "hist_indices": hist.index.tolist(),
            "test_indices": test.index.tolist(),
            "hist_mean_log_er": hist_mean_log_er,
            "test_df": test.copy()
        }

    # Add Relative Timing Features (relative to creator's historical median posting hour)
    creator_med_hours = {}
    for h in qualifying_creators:
        hist_df = df_tune.loc[pools[h]["hist_indices"]]
        creator_med_hours[h] = float(hist_df["post_hour"].median()) if len(hist_df) > 0 else 12.0

    # Inject synthetic known format effect (+0.50 on carousel) into a copy of data to verify recovery (1b)
    df_tune_synth = df_tune.copy()
    synthetic_injection_boost = 0.50
    df_tune_synth.loc[df_tune_synth["media_carousel"] == 1, "log_er"] += synthetic_injection_boost

    gkf = GroupKFold(n_splits=5)
    folds = list(gkf.split(qualifying_creators, groups=qualifying_creators))

    arm_lifts = {
        "oracle_best_possible": [],
        "anti_oracle_worst": [],
        "random": [],
        "best_format": [],
        "format_only": [],
        "format_time_relative": [],
        "format_time_meta": [],
        "full_ridge": [],
        "synthetic_recovery_check": []
    }

    format_cols = ["media_image", "media_reel", "media_video", "media_carousel"]
    meta_cols = ["caption_length", "hashtag_count"]

    for fold_idx, (train_idx_idx, val_idx_idx) in enumerate(folds):
        train_h = [qualifying_creators[i] for i in train_idx_idx]
        val_h = [qualifying_creators[i] for i in val_idx_idx]

        train_hist_rows = []
        for h in train_h:
            train_hist_rows.extend(pools[h]["hist_indices"])
        df_train_hist = df_tune.loc[train_hist_rows].copy()

        # Age curve fit
        log_age_train = np.log(np.maximum(df_train_hist["age_at_scrape_days"].values, 1.0))
        X_age = sm.add_constant(log_age_train)
        y_train_centered = df_train_hist["centered_log_er"].values
        age_model = sm.OLS(y_train_centered, X_age).fit()

        pca = PCA(n_components=8, random_state=42)
        train_embs = tune_embeds[train_hist_rows]
        pca.fit(train_embs)

        # Build relative timing columns for train
        rel_hours_train = []
        for _, r in df_train_hist.iterrows():
            med_h = creator_med_hours.get(r["handle"], 12.0)
            diff = (r["post_hour"] - med_h + 12) % 24 - 12
            rel_hours_train.append(diff)
        rel_hours_train = np.array(rel_hours_train)
        rel_sin_train = np.sin(2 * np.pi * rel_hours_train / 24.0)
        rel_cos_train = np.cos(2 * np.pi * rel_hours_train / 24.0)
        X_rel_time_train = np.column_stack([rel_sin_train, rel_cos_train, df_train_hist["post_weekday"].values])

        # Train models
        # A. Format + Relative Time
        X_train_frt = np.hstack([df_train_hist[format_cols].values, X_rel_time_train])
        m_frt = Ridge(alpha=100.0, random_state=42).fit(X_train_frt, y_train_centered)

        # B. Format + Relative Time + Meta
        X_train_frtm = np.hstack([X_train_frt, df_train_hist[meta_cols].values])
        m_frtm = Ridge(alpha=100.0, random_state=42).fit(X_train_frtm, y_train_centered)

        # C. Full Ridge (Format + Relative Time + Meta + PCA)
        train_pca = pca.transform(train_embs)
        X_train_full = np.hstack([X_train_frtm, train_pca])
        m_full = Ridge(alpha=100.0, random_state=42).fit(X_train_full, y_train_centered)

        # D. Synthetic Pipeline Recovery Model (fitted on synthetic boost data)
        df_train_synth = df_tune_synth.loc[train_hist_rows].copy()
        y_train_synth = df_train_synth["log_er"].values - df_train_synth.groupby("handle")["log_er"].transform("mean").values
        m_synth = Ridge(alpha=100.0, random_state=42).fit(X_train_full, y_train_synth)

        # Cohort format lifts
        cohort_lifts = {}
        for b in ["100K-1M", "over 1M", "under 10K", "10K-100K"]:
            b_df = df_train_hist[df_train_hist["bucket"] == b]
            cohort_lifts[b] = {}
            for m in ["carousel", "image", "video"]:
                m_sub = b_df[b_df["media_type"] == m]
                cohort_lifts[b][m] = m_sub["centered_log_er"].mean() if len(m_sub) > 0 else 0.0

        for h in val_h:
            p = pools[h]
            test_df = p["test_df"].copy()
            hist_mean = p["hist_mean_log_er"]

            log_age_test = np.log(np.maximum(test_df["age_at_scrape_days"].values, 1.0))
            pred_age_effect = age_model.predict(sm.add_constant(log_age_test, has_constant="add"))
            resid_outcomes = (test_df["log_er"].values - hist_mean) - pred_age_effect

            # Oracle & Anti-Oracle (Part 1a)
            arm_lifts["oracle_best_possible"].append(np.max(resid_outcomes))
            arm_lifts["anti_oracle_worst"].append(np.min(resid_outcomes))

            # Random baseline
            arm_lifts["random"].append(np.mean(resid_outcomes))

            # Best format for creator
            hist_df = df_tune.loc[p["hist_indices"]]
            fmt_means = hist_df.groupby("media_type")["log_er"].mean()
            best_fmt = fmt_means.idxmax() if len(fmt_means) > 0 else "image"
            fmt_match = (test_df["media_type"] == best_fmt).values
            idx_bf = np.argmax(fmt_match) if fmt_match.any() else 0
            arm_lifts["best_format"].append(resid_outcomes[idx_bf])

            # Format only (cohort lookup)
            b = test_df["bucket"].iloc[0]
            scores_fo = [cohort_lifts.get(b, {}).get(m, 0.0) for m in test_df["media_type"].values]
            arm_lifts["format_only"].append(resid_outcomes[np.argmax(scores_fo)])

            # Relative timing features for test
            med_h = creator_med_hours.get(h, 12.0)
            rel_h_test = np.array([(ph - med_h + 12) % 24 - 12 for ph in test_df["post_hour"].values])
            rel_sin_test = np.sin(2 * np.pi * rel_h_test / 24.0)
            rel_cos_test = np.cos(2 * np.pi * rel_h_test / 24.0)
            X_rel_time_test = np.column_stack([rel_sin_test, rel_cos_test, test_df["post_weekday"].values])

            # Format + Relative Time
            X_test_frt = np.hstack([test_df[format_cols].values, X_rel_time_test])
            scores_frt = m_frt.predict(X_test_frt)
            arm_lifts["format_time_relative"].append(resid_outcomes[np.argmax(scores_frt)])

            # Format + Relative Time + Meta
            X_test_frtm = np.hstack([X_test_frt, test_df[meta_cols].values])
            scores_frtm = m_frtm.predict(X_test_frtm)
            arm_lifts["format_time_meta"].append(resid_outcomes[np.argmax(scores_frtm)])

            # Full Ridge
            test_embs = tune_embeds[p["test_indices"]]
            test_pca = pca.transform(test_embs)
            X_test_full = np.hstack([X_test_frtm, test_pca])
            scores_full = m_full.predict(X_test_full)
            arm_lifts["full_ridge"].append(resid_outcomes[np.argmax(scores_full)])

            # Synthetic pipeline recovery (1b)
            scores_synth = m_synth.predict(X_test_full)
            arm_lifts["synthetic_recovery_check"].append(resid_outcomes[np.argmax(scores_synth)])

    # Output Ladder Table
    print("\n--- CORRECTED BASELINE LADDER & BOUNDING ARMS (2,000 Cluster-Bootstrap Draws) ---")
    results = {}
    for arm, vals in arm_lifts.items():
        m, (lo, hi) = cluster_bootstrap_ci(vals)
        d_rand, (d_lo, d_hi) = cluster_bootstrap_ci(np.array(vals) - np.array(arm_lifts["random"]))
        d_bf, (dbf_lo, dbf_hi) = cluster_bootstrap_ci(np.array(vals) - np.array(arm_lifts["best_format"]))
        results[arm] = {
            "lift": m, "ci_lift": [lo, hi],
            "delta_vs_random": d_rand, "ci_delta_random": [d_lo, d_hi],
            "delta_vs_best_format": d_bf, "ci_delta_best_format": [dbf_lo, dbf_hi]
        }
        print(f"{arm:<26} | Lift: {m:+.4f} [{lo:+.4f}, {hi:+.4f}] | vs Random: {d_rand:+.4f} [{d_lo:+.4f}, {d_hi:+.4f}] | vs Best-Fmt: {d_bf:+.4f} [{dbf_lo:+.4f}, {dbf_hi:+.4f}]")

    # Save to reports
    out_file = os.path.join(REPORTS_DIR, "task1_trailing_diagnostics_and_ladder.json")
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved Task 1 & 2 results to {out_file}")

if __name__ == "__main__":
    main()
