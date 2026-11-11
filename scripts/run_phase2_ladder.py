import os
import json
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Tuple
from sklearn.model_selection import GroupKFold
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from scipy.stats import spearmanr
import statsmodels.api as sm

from scripts.run_part_a_rigorous import load_data, SNAPSHOT_TIME

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
    print("PHASE 2: BASELINE LADDER, ABLATIONS & RIGOROUS MODEL BENCHMARK")
    print("=" * 80)

    # 1. Load data & holdout split
    df = load_data()
    caption_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "caption_minilm_embeddings.npy"))
    
    with open(os.path.join(SPLITS_DIR, "final_holdout_split.json"), "r") as f:
        split = json.load(f)
    train_creators = set(split["train_creators"])
    holdout_creators = set(split["holdout_creators"])
    
    print(f"Total dataset: {len(df)} posts across {df['handle'].nunique()} creators.")
    print(f"Train/Dev tuning partition: {len(train_creators)} creators.")
    print(f"Frozen holdout partition: {len(holdout_creators)} creators (NOT touched during ladder tuning).")

    # Filter to tuning creators only for Phase 2 ladder
    df_tune = df[df["handle"].isin(train_creators)].copy().reset_index(drop=True)
    idx_tune = df_tune.index.values
    tune_embeds = caption_embeds[df["handle"].isin(train_creators).values]

    # Benchmark eligibility: >=8 posts and multi-format (so candidate pools have format diversity)
    c_stats = df_tune.groupby("handle").agg(n_posts=("shortcode", "count"), n_types=("media_type", "nunique"))
    qualifying_creators = c_stats[(c_stats["n_posts"] >= 8) & (c_stats["n_types"] >= 2)].index.tolist()
    print(f"Qualifying tuning creators (>=8 posts, multi-format): {len(qualifying_creators)} creators.")

    # 2. Extract Candidate Pools (last 3 posts per qualifying creator)
    # Historical training posts: 0 .. N-4
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

    # 3. Fit Age Curve Strictly Inside Training Sets
    # Fold setup: GroupKFold over qualifying creators
    gkf = GroupKFold(n_splits=5)
    folds = list(gkf.split(qualifying_creators, groups=qualifying_creators))

    # Evaluate arms across folds
    # Arms:
    # 0. Random Baseline
    # 1. Creator Trailing Mean (prev-3)
    # 2. Creator Trailing Mean (prev-10)
    # 3. Best-Format-for-Creator
    # 4. Format Only (Cohort lookup)
    # 5. Format + Time (Ridge on format + sin/cos hour + weekday)
    # 6. Format + Time + Text Meta (Ridge on format + time + cap_len + hashtags)
    # 7. Full Model (Ridge on format + time + text meta + 8 PCA caption embeddings)
    
    arm_scores = {
        "random": [],
        "prev_3_mean": [],
        "prev_10_mean": [],
        "best_format": [],
        "format_only": [],
        "format_time": [],
        "format_time_meta": [],
        "full_ridge": [],
        "ablation_drop_history": [],
        "ablation_drop_embeddings": [],
        "ablation_drop_time": [],
        "ablation_drop_format": []
    }
    
    # Store per-creator pairwise accuracy and Spearman for key models
    metrics_by_creator = {
        "full_ridge_spearman": [],
        "prev_10_spearman": [],
        "best_format_spearman": [],
        "full_ridge_pairwise": [],
        "best_format_pairwise": []
    }

    test_creators_order = []

    for fold_idx, (train_idx_idx, val_idx_idx) in enumerate(folds):
        train_h = [qualifying_creators[i] for i in train_idx_idx]
        val_h = [qualifying_creators[i] for i in val_idx_idx]

        # Training data for age curve and models
        train_hist_rows = []
        for h in train_h:
            hist_idx = pools[h]["hist_indices"]
            train_hist_rows.extend(hist_idx)
        df_train_hist = df_tune.loc[train_hist_rows].copy()

        # Age curve fit: centered_log_er ~ log(age_at_scrape_days)
        log_age_train = np.log(np.maximum(df_train_hist["age_at_scrape_days"].values, 1.0))
        X_age = sm.add_constant(log_age_train)
        y_train_centered = df_train_hist["centered_log_er"].values
        age_model = sm.OLS(y_train_centered, X_age).fit()

        # PCA fit on training caption embeddings
        pca = PCA(n_components=8, random_state=42)
        train_embs = tune_embeds[train_hist_rows]
        pca.fit(train_embs)

        # Build feature matrices for training models
        # Target: centered_log_er (or residualized)
        format_cols = ["media_image", "media_reel", "media_video", "media_carousel"]
        time_cols = ["hour_sin", "hour_cos", "post_weekday"]
        meta_cols = ["caption_length", "hashtag_count"]

        # 5. Format + Time
        X_train_ft = df_train_hist[format_cols + time_cols].values
        m_ft = Ridge(alpha=100.0, random_state=42).fit(X_train_ft, y_train_centered)

        # 6. Format + Time + Meta
        X_train_ftm = df_train_hist[format_cols + time_cols + meta_cols].values
        m_ftm = Ridge(alpha=100.0, random_state=42).fit(X_train_ftm, y_train_centered)

        # 7. Full Ridge (Format + Time + Meta + PCA)
        train_pca = pca.transform(train_embs)
        X_train_full = np.hstack([X_train_ftm, train_pca])
        m_full = Ridge(alpha=100.0, random_state=42).fit(X_train_full, y_train_centered)

        # Ablations
        # A. Drop embeddings: same as m_ftm
        # B. Drop time: Format + Meta + PCA
        X_train_notime = np.hstack([df_train_hist[format_cols + meta_cols].values, train_pca])
        m_notime = Ridge(alpha=100.0, random_state=42).fit(X_train_notime, y_train_centered)
        # C. Drop format: Time + Meta + PCA
        X_train_noformat = np.hstack([df_train_hist[time_cols + meta_cols].values, train_pca])
        m_noformat = Ridge(alpha=100.0, random_state=42).fit(X_train_noformat, y_train_centered)

        # Cohort format lifts on training set
        cohort_lifts = {}
        for b in ["100K-1M", "over 1M", "under 10K", "10K-100K"]:
            b_df = df_train_hist[df_train_hist["bucket"] == b]
            cohort_lifts[b] = {}
            for m in ["carousel", "image", "video"]:
                m_sub = b_df[b_df["media_type"] == m]
                cohort_lifts[b][m] = m_sub["centered_log_er"].mean() if len(m_sub) > 0 else 0.0

        # Evaluate on validation creators
        for h in val_h:
            test_creators_order.append(h)
            p = pools[h]
            test_df = p["test_df"].copy()
            hist_mean = p["hist_mean_log_er"]

            # Ground truth outcomes: age-residualized log(ER)
            log_age_test = np.log(np.maximum(test_df["age_at_scrape_days"].values, 1.0))
            pred_age_effect = age_model.predict(sm.add_constant(log_age_test, has_constant="add"))
            resid_outcomes = (test_df["log_er"].values - hist_mean) - pred_age_effect
            random_lift = np.mean(resid_outcomes)

            # Arm 0: Random (baseline lift is 0 in paired delta)
            arm_scores["random"].append(random_lift)

            # Arm 1 & 2: Trailing Mean (prev-3 and prev-10)
            # Trailing means predict identical level for all 3 candidates unless updated post-by-post
            # In candidate pool selection, picking by prev_3 or prev_10 is equivalent to chronological
            p3 = test_df["prev_3_mean"].values
            p10 = test_df["prev_10_mean"].values
            
            # If scores identical or NaN, pick first
            idx_p3 = np.nanargmax(p3) if not np.isnan(p3).all() else 0
            idx_p10 = np.nanargmax(p10) if not np.isnan(p10).all() else 0
            arm_scores["prev_3_mean"].append(resid_outcomes[idx_p3])
            arm_scores["prev_10_mean"].append(resid_outcomes[idx_p10])

            # Arm 3: Best format for creator
            hist_df = df_tune.loc[p["hist_indices"]]
            fmt_means = hist_df.groupby("media_type")["log_er"].mean()
            best_fmt = fmt_means.idxmax() if len(fmt_means) > 0 else "image"
            fmt_match = (test_df["media_type"] == best_fmt).values
            idx_bf = np.argmax(fmt_match) if fmt_match.any() else 0
            arm_scores["best_format"].append(resid_outcomes[idx_bf])

            # Arm 4: Format Only (Cohort lookup)
            b = test_df["bucket"].iloc[0]
            scores_fo = [cohort_lifts.get(b, {}).get(m, 0.0) for m in test_df["media_type"].values]
            idx_fo = np.argmax(scores_fo)
            arm_scores["format_only"].append(resid_outcomes[idx_fo])

            # Arm 5: Format + Time
            X_test_ft = test_df[format_cols + time_cols].values
            scores_ft = m_ft.predict(X_test_ft)
            arm_scores["format_time"].append(resid_outcomes[np.argmax(scores_ft)])

            # Arm 6: Format + Time + Meta
            X_test_ftm = test_df[format_cols + time_cols + meta_cols].values
            scores_ftm = m_ftm.predict(X_test_ftm)
            arm_scores["format_time_meta"].append(resid_outcomes[np.argmax(scores_ftm)])

            # Arm 7: Full Ridge
            test_embs = tune_embeds[p["test_indices"]]
            test_pca = pca.transform(test_embs)
            X_test_full = np.hstack([X_test_ftm, test_pca])
            scores_full = m_full.predict(X_test_full)
            arm_scores["full_ridge"].append(resid_outcomes[np.argmax(scores_full)])

            # Ablations
            # Drop embeddings: scores_ftm
            arm_scores["ablation_drop_embeddings"].append(resid_outcomes[np.argmax(scores_ftm)])
            # Drop time:
            X_test_notime = np.hstack([test_df[format_cols + meta_cols].values, test_pca])
            scores_notime = m_notime.predict(X_test_notime)
            arm_scores["ablation_drop_time"].append(resid_outcomes[np.argmax(scores_notime)])
            # Drop format:
            X_test_noformat = np.hstack([test_df[time_cols + meta_cols].values, test_pca])
            scores_noformat = m_noformat.predict(X_test_noformat)
            arm_scores["ablation_drop_format"].append(resid_outcomes[np.argmax(scores_noformat)])
            # Drop history: (Full Ridge already doesn't use trailing history as inputs, it predicts from content+format)
            arm_scores["ablation_drop_history"].append(resid_outcomes[np.argmax(scores_full)])

            # Pairwise accuracy & Spearman
            if len(resid_outcomes) >= 3 and np.std(resid_outcomes) > 0:
                if np.std(scores_full) > 0:
                    sp_full, _ = spearmanr(scores_full, resid_outcomes)
                    metrics_by_creator["full_ridge_spearman"].append(sp_full)
                if np.std(scores_fo) > 0:
                    sp_bf, _ = spearmanr(scores_fo, resid_outcomes)
                    metrics_by_creator["best_format_spearman"].append(sp_bf)
                
                # Pairwise 3 pairs: (0,1), (0,2), (1,2)
                pairs = [(0, 1), (0, 2), (1, 2)]
                acc_full = np.mean([((scores_full[i] > scores_full[j]) == (resid_outcomes[i] > resid_outcomes[j])) for i, j in pairs])
                acc_bf = np.mean([((scores_fo[i] > scores_fo[j]) == (resid_outcomes[i] > resid_outcomes[j])) for i, j in pairs])
                metrics_by_creator["full_ridge_pairwise"].append(acc_full)
                metrics_by_creator["best_format_pairwise"].append(acc_bf)

    # 4. Compute Rigorous Cluster-Bootstrap Statistics (2000 draws)
    n_pools = len(test_creators_order)
    print(f"\nEvaluated {n_pools} creator candidate pools in Benchmark B ladder.")

    print("\n--- BASELINE LADDER RESULTS (2,000 Cluster-Bootstrap Draws) ---")
    results_summary = {}
    for arm_name, lifts in arm_scores.items():
        mean_lift, (ci_low, ci_high) = cluster_bootstrap_ci(lifts, n_boot=2000)
        # Compute paired delta vs random
        delta_vs_random = np.array(lifts) - np.array(arm_scores["random"])
        d_mean, (d_low, d_high) = cluster_bootstrap_ci(delta_vs_random, n_boot=2000)
        
        # Compute paired delta vs best_format
        delta_vs_bf = np.array(lifts) - np.array(arm_scores["best_format"])
        dbf_mean, (dbf_low, dbf_high) = cluster_bootstrap_ci(delta_vs_bf, n_boot=2000)

        results_summary[arm_name] = {
            "mean_lift": mean_lift, "ci_95": [ci_low, ci_high],
            "delta_vs_random": d_mean, "ci_delta_random": [d_low, d_high],
            "delta_vs_best_format": dbf_mean, "ci_delta_best_format": [dbf_low, dbf_high]
        }
        print(f"{arm_name:<25} | Lift: {mean_lift:+.4f} [{ci_low:+.4f}, {ci_high:+.4f}] | Delta vs Random: {d_mean:+.4f} [{d_low:+.4f}, {d_high:+.4f}] | Delta vs Best-Fmt: {dbf_mean:+.4f} [{dbf_low:+.4f}, {dbf_high:+.4f}]")

    # Ablations Table
    print("\n--- ABLATIONS VS FULL MODEL ---")
    full_lifts = np.array(arm_scores["full_ridge"])
    for abl in ["ablation_drop_embeddings", "ablation_drop_time", "ablation_drop_format"]:
        drop_delta = np.array(arm_scores[abl]) - full_lifts
        d_mean, (d_low, d_high) = cluster_bootstrap_ci(drop_delta, n_boot=2000)
        print(f"Effect of {abl:<25}: Drop in Lift = {d_mean:+.4f} [{d_low:+.4f}, {d_high:+.4f}]")

    # Pairwise Accuracy & Spearman
    mean_sp, ci_sp = cluster_bootstrap_ci(metrics_by_creator["full_ridge_spearman"])
    mean_pair, ci_pair = cluster_bootstrap_ci(metrics_by_creator["full_ridge_pairwise"])
    print(f"\nFull Model Ranking Metrics:")
    print(f"  Within-Creator Spearman : {mean_sp:+.4f} [{ci_sp[0]:+.4f}, {ci_sp[1]:+.4f}]")
    print(f"  Pairwise Concordance Acc: {mean_pair*100:.2f}% [{ci_pair[0]*100:.2f}%, {ci_pair[1]*100:.2f}%]")

    # Check primary promotion criterion: does Full Ridge beat Best-Format with CI excluding zero?
    full_vs_bf = results_summary["full_ridge"]["delta_vs_best_format"]
    ci_full_vs_bf = results_summary["full_ridge"]["ci_delta_best_format"]
    beats_bf_clean = ci_full_vs_bf[0] > 0.0

    print("\n" + "=" * 80)
    print("PHASE 2 PROTOCOL VERDICT:")
    print(f"  Full Ridge Delta vs Best-Format: {full_vs_bf:+.4f} [{ci_full_vs_bf[0]:+.4f}, {ci_full_vs_bf[1]:+.4f}]")
    print(f"  Confidence Interval Strictly Above Zero (>0): {beats_bf_clean}")
    if beats_bf_clean:
        print("  -> STATUS: VALIDATED under Phase 2 Protocol.")
    else:
        print("  -> STATUS: NOT VALIDATED (lower CI bound overlaps zero).")
    print("=" * 80)

    # Save artifact
    out_file = os.path.join(REPORTS_DIR, "phase2_baseline_ladder.json")
    with open(out_file, "w") as f:
        json.dump(results_summary, f, indent=2)
    print(f"Saved Phase 2 results to {out_file}")

if __name__ == "__main__":
    main()
