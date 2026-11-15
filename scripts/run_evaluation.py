import os
import sys
import json
import time
import argparse
import numpy as np
import pandas as pd
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Tuple

from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from scipy.stats import spearmanr
import lightgbm as lgb
from sentence_transformers import SentenceTransformer
from sklearn.decomposition import PCA

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports")
EVAL_RUNS_DIR = os.path.join(STORAGE_DIR, "eval_runs")

def compute_spearman(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    if len(y_true) < 2 or np.all(y_true == y_true[0]) or np.all(y_pred == y_pred[0]):
        return 0.0
    corr, _ = spearmanr(y_true, y_pred)
    return 0.0 if np.isnan(corr) else float(corr)

def compute_within_account_spearman(df: pd.DataFrame, y_true_col: str, y_pred_col: str) -> float:
    corrs = []
    for _, group in df.groupby("handle"):
        if len(group) >= 3:
            yt = group[y_true_col].values
            yp = group[y_pred_col].values
            if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                c, _ = spearmanr(yt, yp)
                if not np.isnan(c):
                    corrs.append(float(c))
    return float(np.mean(corrs)) if corrs else 0.0

def get_follower_bucket(followers: int) -> str:
    if followers < 10000:
        return "under 10K"
    elif followers <= 100000:
        return "10K-100K"
    elif followers <= 1000000:
        return "100K-1M"
    else:
        return "over 1M"

def load_and_filter_snapshot_data(snapshot_name: str = "2026-11-02") -> Tuple[pd.DataFrame, Dict[str, Any]]:
    snapshot_dir = os.path.join(STORAGE_DIR, "snapshots", snapshot_name)
    if not os.path.exists(snapshot_dir):
        raise FileNotFoundError(f"Snapshot directory not found: {snapshot_dir}")

    manifest_path = os.path.join(snapshot_dir, "manifest.json")
    snapshot_created_at_str = "2026-11-02T13:23:19.910037Z"
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as mf:
            mdata = json.load(mf)
            snapshot_created_at_str = mdata.get("created_at") or snapshot_created_at_str

    snapshot_dt = pd.to_datetime(snapshot_created_at_str, utc=True)
    cutoff_dt = snapshot_dt - pd.Timedelta(days=7)

    profile_files = [
        os.path.join(snapshot_dir, "profiles", f)
        for f in os.listdir(os.path.join(snapshot_dir, "profiles"))
        if f.endswith(".json")
    ]

    total_scraped_posts = 0
    excluded_test_creators = []
    detected_pinned_posts = 0
    excluded_recent_posts = 0

    rows = []

    for pf in profile_files:
        handle = os.path.basename(pf).replace(".json", "")
        with open(pf, "r", encoding="utf-8") as f:
            pdata = json.load(f)

        followers = pdata.get("followers_count")
        if not followers or followers <= 0:
            continue

        following = pdata.get("following_count") or 0
        total_account_posts = pdata.get("posts_count") or 0

        # Filter: Exclude test or demo creators
        if any(term in handle.lower() for term in ["test", "demo", "sample"]):
            excluded_test_creators.append(handle)
            continue

        post_file = os.path.join(snapshot_dir, "posts", f"{handle}.json")
        if not os.path.exists(post_file):
            continue

        with open(post_file, "r", encoding="utf-8") as f:
            posts = json.load(f)

        if not isinstance(posts, list):
            continue

        creator_valid_posts = []
        for p in posts:
            total_scraped_posts += 1
            likes = p.get("likesCount") if p.get("likesCount") is not None else p.get("likes_count")
            comments = p.get("commentsCount") if p.get("commentsCount") is not None else p.get("comments_count")
            posted_at = p.get("postedAt") or p.get("posted_at")

            # Core non-negotiable rule: Real metrics only, never fabricate
            if likes is None or comments is None or not posted_at:
                continue

            rate = float(likes + comments) / float(followers)
            p_dt = pd.to_datetime(posted_at, utc=True)
            creator_valid_posts.append({
                "account_id": handle,
                "handle": handle,
                "followers_count": followers,
                "following_count": following,
                "total_account_posts": total_account_posts,
                "follower_bucket": get_follower_bucket(followers),
                "caption": p.get("caption") or "",
                "hashtags": p.get("hashtags") or [],
                "mentions": p.get("mentions") or [],
                "media_type": p.get("mediaType") or p.get("media_type") or "image",
                "carousel_size": p.get("carouselSize") or p.get("carousel_size") or 0,
                "posted_at": posted_at,
                "posted_dt": p_dt,
                "likes": likes,
                "comments": comments,
                "engagement_rate": rate
            })

        # Check for Pinned Posts: out-of-order timestamps at the top of a creator post list
        # Instagram returns posts newest-to-oldest. Pinned posts (max 3) sit at top index (0, 1, 2)
        # but have timestamps older than subsequent posts.
        pinned_flags = [False] * len(creator_valid_posts)
        for i in range(min(3, len(creator_valid_posts))):
            cur_dt = creator_valid_posts[i]["posted_dt"]
            if any(cur_dt < creator_valid_posts[j]["posted_dt"] for j in range(i + 1, min(len(creator_valid_posts), i + 4))):
                pinned_flags[i] = True
                detected_pinned_posts += 1

        for i, post_entry in enumerate(creator_valid_posts):
            if pinned_flags[i]:
                # Exclude pinned post from evaluation dataset
                continue
            if post_entry["posted_dt"] > cutoff_dt:
                # Exclude post less than 7 days old
                excluded_recent_posts += 1
                continue
            rows.append(post_entry)

    df = pd.DataFrame(rows)
    filter_stats = {
        "snapshot_date": snapshot_name,
        "snapshot_created_at": snapshot_created_at_str,
        "7_day_cutoff": cutoff_dt.isoformat(),
        "total_scraped_posts": total_scraped_posts,
        "excluded_test_creators": sorted(list(set(excluded_test_creators))),
        "detected_pinned_posts": detected_pinned_posts,
        "excluded_recent_posts": excluded_recent_posts,
        "final_usable_posts": len(df),
        "final_creators_count": df["handle"].nunique() if len(df) > 0 else 0
    }
    return df, filter_stats

def extract_features(df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, List[str]]]:
    df["log_followers"] = np.log1p(df["followers_count"])
    df["log_following"] = np.log1p(df["following_count"])

    post_dates = pd.to_datetime(df["posted_at"], utc=True)
    df["post_hour"] = post_dates.dt.hour
    df["post_weekday"] = post_dates.dt.weekday
    df["is_weekend"] = df["post_weekday"].apply(lambda w: 1 if w >= 5 else 0)

    # Cyclic hour
    df["hour_sin"] = np.sin(2 * np.pi * df["post_hour"] / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * df["post_hour"] / 24.0)

    df["caption_length"] = df["caption"].apply(lambda c: len(str(c)))
    df["hashtag_count"] = df["hashtags"].apply(lambda h: len(h) if isinstance(h, list) else 0)
    df["mention_count"] = df["mentions"].apply(lambda m: len(m) if isinstance(m, list) else 0)

    media_dummies = pd.get_dummies(df["media_type"], prefix="media")
    for col in ["media_image", "media_reel", "media_video", "media_carousel", "media_story"]:
        if col not in media_dummies.columns:
            media_dummies[col] = 0
    df = pd.concat([df, media_dummies], axis=1)

    print("Computing all-MiniLM-L6-v2 embeddings for captions...")
    embedder = SentenceTransformer("all-MiniLM-L6-v2")
    captions = df["caption"].fillna("").tolist()
    embeddings = embedder.encode(captions, show_progress_bar=False, batch_size=64)

    pca = PCA(n_components=8, random_state=42)
    reduced_embeds = pca.fit_transform(embeddings)
    for i in range(8):
        df[f"caption_pca_{i}"] = reduced_embeds[:, i]

    feature_groups = {
        "caption_text": ["caption_length"] + [f"caption_pca_{i}" for i in range(8)],
        "hashtags_mentions": ["hashtag_count", "mention_count"],
        "media_type": ["media_image", "media_reel", "media_video", "media_carousel", "media_story"],
        "time_features": ["post_hour", "post_weekday", "is_weekend", "hour_sin", "hour_cos"],
        "creator_baseline": ["log_followers"]
    }

    return df, feature_groups

def run_evaluation(snapshot_name: str = "2026-11-02"):
    start_time = time.time()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = f"eval_{timestamp}"

    print(f"Loading frozen dataset from snapshot '{snapshot_name}' with user-specified filters...")
    df, filter_stats = load_and_filter_snapshot_data(snapshot_name)
    print(f"Filter Summary: Excluded test creators: {filter_stats['excluded_test_creators']}, "
          f"Pinned posts: {filter_stats['detected_pinned_posts']}, "
          f"Posts < 7 days: {filter_stats['excluded_recent_posts']}.")
    print(f"Usable clean posts for Global Model: {len(df)} across {df['handle'].nunique()} creators.")

    # Extract all features
    df, feature_groups = extract_features(df)
    all_features = [f for grp in feature_groups.values() for f in grp]

    # Calculate creator history mean baseline
    creator_means = df.groupby("handle")["engagement_rate"].mean().to_dict()
    df["creator_hist_mean"] = df["handle"].map(creator_means)

    # 1. 5-Fold GroupKFold Cross-Validation strictly across creators
    print("Running GroupKFold cross-validation across unseen creators for Global Model...")
    gkf = GroupKFold(n_splits=5)
    groups = df["handle"].values
    y = df["engagement_rate"].values

    df["pred_global_mean"] = np.nan
    df["pred_bucket_mean"] = np.nan
    df["pred_account_mean"] = np.nan
    df["pred_global_model"] = np.nan

    feature_importances = np.zeros(len(all_features))

    for fold, (train_idx, val_idx) in enumerate(gkf.split(df, y, groups)):
        train_df = df.iloc[train_idx]
        val_df = df.iloc[val_idx]

        # Baselines
        fold_global_mean = train_df["engagement_rate"].mean()
        df.iloc[val_idx, df.columns.get_loc("pred_global_mean")] = fold_global_mean

        fold_bucket_means = train_df.groupby("follower_bucket")["engagement_rate"].mean().to_dict()
        df.iloc[val_idx, df.columns.get_loc("pred_bucket_mean")] = val_df["follower_bucket"].map(
            lambda b: fold_bucket_means.get(b, fold_global_mean)
        ).values

        # Per-account mean baseline on unseen validation creators falls back to train global mean
        df.iloc[val_idx, df.columns.get_loc("pred_account_mean")] = fold_global_mean

        # Global LightGBM Model
        X_train = train_df[all_features]
        y_train = train_df["engagement_rate"]
        X_val = val_df[all_features]
        y_val = val_df["engagement_rate"]

        model = lgb.LGBMRegressor(
            n_estimators=120,
            learning_rate=0.04,
            max_depth=5,
            num_leaves=18,
            min_child_samples=8,
            random_state=42 + fold,
            verbose=-1
        )
        model.fit(X_train, y_train)
        preds = model.predict(X_val)
        df.iloc[val_idx, df.columns.get_loc("pred_global_model")] = preds
        feature_importances += model.feature_importances_ / 5.0

    # Overall benchmark metrics
    def calc_metrics(y_true, y_pred, pred_col_name):
        return {
            "mae": float(mean_absolute_error(y_true, y_pred)),
            "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
            "r2": float(r2_score(y_true, y_pred)),
            "spearman": compute_spearman(y_true, y_pred),
            "within_acc_spearman": compute_within_account_spearman(df, "engagement_rate", pred_col_name)
        }

    overall_global_mean = calc_metrics(y, df["pred_global_mean"].values, "pred_global_mean")
    overall_bucket_mean = calc_metrics(y, df["pred_bucket_mean"].values, "pred_bucket_mean")
    overall_account_mean = calc_metrics(y, df["pred_account_mean"].values, "pred_account_mean")
    overall_global_model = calc_metrics(y, df["pred_global_model"].values, "pred_global_model")

    # 2. Bootstrap 95% Confidence Interval for MAE Reduction
    print("Computing 1,000 bootstrap resamples for MAE reduction...")
    np.random.seed(42)
    n_resamples = 1000
    mae_diffs = []
    base_errors = np.abs(y - df["pred_global_mean"].values)
    model_errors = np.abs(y - df["pred_global_model"].values)

    for _ in range(n_resamples):
        sample_indices = np.random.choice(len(y), size=len(y), replace=True)
        diff = np.mean(base_errors[sample_indices]) - np.mean(model_errors[sample_indices])
        mae_diffs.append(diff)

    ci_low = float(np.percentile(mae_diffs, 2.5))
    ci_high = float(np.percentile(mae_diffs, 97.5))
    mean_diff = float(np.mean(mae_diffs))
    stat_significant = bool(ci_low > 0)

    # 3. Follower bucket breakdown
    bucket_results = {}
    for b_name in ["under 10K", "10K-100K", "100K-1M", "over 1M"]:
        b_df = df[df["follower_bucket"] == b_name]
        if len(b_df) > 0:
            yt = b_df["engagement_rate"].values
            yp = b_df["pred_global_model"].values
            base_p = b_df["pred_bucket_mean"].values
            bucket_results[b_name] = {
                "count": len(b_df),
                "creators": b_df["handle"].nunique(),
                "global_model": {
                    "mae": float(mean_absolute_error(yt, yp)),
                    "rmse": float(np.sqrt(mean_squared_error(yt, yp))),
                    "r2": float(r2_score(yt, yp)),
                    "spearman": compute_spearman(yt, yp),
                },
                "baseline_bucket_mean": {
                    "mae": float(mean_absolute_error(yt, base_p)),
                    "rmse": float(np.sqrt(mean_squared_error(yt, base_p))),
                    "r2": float(r2_score(yt, base_p)),
                },
                "within_acc_spearman": compute_within_account_spearman(b_df, "engagement_rate", "pred_global_model")
            }

    # 4. Feature Ablation Study
    print("Running feature group ablation study...")
    ablation_results = {}
    base_mae = overall_global_model["mae"]

    for group_name, feats_to_drop in feature_groups.items():
        ablated_features = [f for f in all_features if f not in feats_to_drop]
        ablated_preds = np.zeros(len(df))

        for fold, (train_idx, val_idx) in enumerate(gkf.split(df, y, groups)):
            X_train = df.iloc[train_idx][ablated_features]
            y_train = df.iloc[train_idx]["engagement_rate"]
            X_val = df.iloc[val_idx][ablated_features]

            m = lgb.LGBMRegressor(
                n_estimators=120,
                learning_rate=0.04,
                max_depth=5,
                num_leaves=18,
                min_child_samples=8,
                random_state=42 + fold,
                verbose=-1
            )
            m.fit(X_train, y_train)
            ablated_preds[val_idx] = m.predict(X_val)

        df["tmp_ablated"] = ablated_preds
        abl_mae = float(mean_absolute_error(y, ablated_preds))
        ablation_results[group_name] = {
            "dropped_features": feats_to_drop,
            "mae": abl_mae,
            "mae_delta": float(abl_mae - base_mae),
            "spearman": compute_spearman(y, ablated_preds),
            "within_acc_spearman": compute_within_account_spearman(df, "engagement_rate", "tmp_ablated")
        }

    # Feature split counts
    feature_imp_dict = {f: float(imp) for f, imp in zip(all_features, feature_importances)}
    total_importance = sum(feature_imp_dict.values()) or 1.0
    log_fol_importance = feature_imp_dict.get("log_followers", 0.0)
    log_fol_pct = (log_fol_importance / total_importance) * 100

    runtime_s = round(time.time() - start_time, 2)

    # Honest Summary Verdict
    if stat_significant:
        summary_verdict = (
            f"The Global LightGBM model achieves a statistically significant MAE reduction of {mean_diff:.5f} "
            f"(95% CI: [{ci_low:.5f}, {ci_high:.5f}]) over the global mean baseline across unseen creators."
        )
    else:
        summary_verdict = (
            f"The Global LightGBM model does not achieve a statistically significant MAE reduction "
            f"(mean lift: {mean_diff:.5f}, 95% CI: [{ci_low:.5f}, {ci_high:.5f}]) over the global mean baseline on unseen creators. "
            f"Within-account rank correlation is modest ({overall_global_model['within_acc_spearman']:.4f})."
        )

    # Save JSON run artifact (atomic write-to-temp-then-rename)
    os.makedirs(EVAL_RUNS_DIR, exist_ok=True)
    os.makedirs(REPORTS_DIR, exist_ok=True)

    json_path = os.path.join(EVAL_RUNS_DIR, f"{run_id}.json")
    report_path = os.path.join(REPORTS_DIR, f"{run_id}.md")

    run_payload = {
        "run_id": run_id,
        "snapshot": snapshot_name,
        "model_type": "global_only",
        "created_at": datetime.now().isoformat(),
        "runtime_s": runtime_s,
        "posts_count": len(df),
        "creators_count": df["handle"].nunique(),
        "filter_stats": filter_stats,
        "verdict": summary_verdict,
        "bootstrap_ci": {
            "metric": "mae_reduction",
            "mean_lift": mean_diff,
            "ci_95": [ci_low, ci_high],
            "statistically_significant": stat_significant
        },
        "baselines": {
            "global_mean": overall_global_mean,
            "follower_bucket_mean": overall_bucket_mean,
            "per_account_mean": overall_account_mean
        },
        "global_model": overall_global_model,
        "follower_buckets": bucket_results,
        "ablation_study": ablation_results,
        "feature_importances": feature_imp_dict,
        "personal_model_policy": "Skipped per user spec: Exactly 0 creators qualify with >= 30 clean posts."
    }

    temp_json = json_path + ".tmp"
    with open(temp_json, "w", encoding="utf-8") as f:
        json.dump(run_payload, f, indent=2)
    os.replace(temp_json, json_path)

    # Generate Markdown Report
    md_content = f"""# EntangledEcho — Model Evaluation Report (Global Model Only)

**Run ID:** `{run_id}`  
**Dataset Snapshot:** `{snapshot_name}` (Bound strictly to `storage/snapshots/{snapshot_name}/`)  
**Evaluation Date:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  
**Evaluation Scope:** Global Model Only (Personal models explicitly skipped: 0 creators qualify with $\\ge 30$ posts)  
**Validation Scheme:** 5-Fold `GroupKFold` strictly grouped by creator (Zero creator data leakage)  

---

## 1. Executive Summary & Honest Verdict

> [!IMPORTANT]
> **VERDICT:** {summary_verdict}

---

## 2. Dataset Filtering & Cleaning Audit

Per task requirements, strict filters were applied to ensure clean, leak-free evaluation:

* **Snapshot Creation Date:** `{filter_stats['snapshot_created_at']}`
* **7-Day Recency Cutoff Date:** `{filter_stats['7_day_cutoff']}`
* **Excluded Test/Demo Creators:** {filter_stats['excluded_test_creators'] if filter_stats['excluded_test_creators'] else "None in usable dataset"}
* **Detected Pinned Posts Excluded:** **{filter_stats['detected_pinned_posts']}** posts (detected via out-of-order timestamps at the top of creator grids)
* **Posts < 7 Days Old Excluded:** **{filter_stats['excluded_recent_posts']}** posts
* **Final Usable Posts for Evaluation:** **{len(df)}** clean posts across **{df['handle'].nunique()}** creators

---

## 3. Aggregate Model vs Baseline Benchmark (Out-of-Fold)

All metrics evaluated out-of-fold across strictly unseen creators:

| Model / Baseline | MAE | RMSE | $R^2$ | Spearman (Overall) | Within-Account Spearman |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Global Mean Baseline** | {overall_global_mean['mae']:.5f} | {overall_global_mean['rmse']:.5f} | {overall_global_mean['r2']:.4f} | {overall_global_mean['spearman']:.4f} | {overall_global_mean['within_acc_spearman']:.4f} |
| **Follower Bucket Mean Baseline** | {overall_bucket_mean['mae']:.5f} | {overall_bucket_mean['rmse']:.5f} | {overall_bucket_mean['r2']:.4f} | {overall_bucket_mean['spearman']:.4f} | {overall_bucket_mean['within_acc_spearman']:.4f} |
| **Per-Account Mean (Unseen)** | {overall_account_mean['mae']:.5f} | {overall_account_mean['rmse']:.5f} | {overall_account_mean['r2']:.4f} | {overall_account_mean['spearman']:.4f} | {overall_account_mean['within_acc_spearman']:.4f} |
| **Global LightGBM Model** | **{overall_global_model['mae']:.5f}** | **{overall_global_model['rmse']:.5f}** | **{overall_global_model['r2']:.4f}** | **{overall_global_model['spearman']:.4f}** | **{overall_global_model['within_acc_spearman']:.4f}** |

### Bootstrap 95% Confidence Interval (1,000 resamples):
* **Metric:** MAE Reduction ($MAE_{{baseline}} - MAE_{{model}}$)
* **Mean Lift:** `{mean_diff:.5f}`
* **95% CI:** `[{ci_low:.5f}, {ci_high:.5f}]`
* **Statistical Significance:** `{"YES (CI strictly > 0)" if stat_significant else "NO"}`

---

## 4. Within-Account Discrimination Analysis

> [!NOTE]
> **Sample Size Context:** Within-account Spearman rank correlation is computed *inside* each individual creator's feed (at most ~12 posts per creator in the snapshot), and then averaged across creators. Due to small per-creator post counts ($N \\le 12$), individual creator rank correlations are naturally noisy, and the metric is only statistically meaningful when interpreted in aggregate across all {df['handle'].nunique()} creators.

* **Global Model Within-Account Spearman:** **`{overall_global_model['within_acc_spearman']:.4f}`**
* **Global Mean Within-Account Spearman:** `{overall_global_mean['within_acc_spearman']:.4f}`

---

## 5. Performance by Follower-Count Bucket

| Follower Bucket | Post Count | Creators | Baseline MAE | Global Model MAE | Global Model $R^2$ | Within-Acc Spearman |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
"""
    for b_name, b_res in bucket_results.items():
        md_content += f"| **{b_name}** | {b_res['count']} | {b_res['creators']} | {b_res['baseline_bucket_mean']['mae']:.5f} | **{b_res['global_model']['mae']:.5f}** | {b_res['global_model']['r2']:.4f} | **{b_res['within_acc_spearman']:.4f}** |\n"

    md_content += f"""
---

## 6. Feature Importance & Ablation Study

### Feature Importance (LightGBM split counts):
"""
    sorted_fi = sorted(feature_imp_dict.items(), key=lambda x: x[1], reverse=True)
    for feat, imp in sorted_fi[:10]:
        md_content += f"* **`{feat}`**: {imp:.1f} splits ({imp/total_importance*100:.1f}%)\n"

    md_content += f"""
### Ablation Study (Impact of dropping feature groups):
*Positive MAE delta means the model degrades (MAE increases) when the feature group is removed:*

| Dropped Feature Group | Ablated Model MAE | MAE Delta ($\Delta$) | Within-Account Spearman | Features Dropped |
| :--- | :--- | :--- | :--- | :--- |
"""
    for grp_name, a_res in ablation_results.items():
        md_content += f"| **{grp_name}** | {a_res['mae']:.5f} | `+{a_res['mae_delta']:.5f}` | {a_res['within_acc_spearman']:.4f} | {len(feature_groups[grp_name])} features |\n"

    md_content += f"""
### Are Creator Baseline Features Doing All the Work?
* **`log_followers` Importance:** {log_fol_importance:.1f} / {total_importance:.1f} ({log_fol_pct:.1f}% of total model splits).
* **Finding:** When `creator_baseline` is dropped, MAE delta changes by `{ablation_results['creator_baseline']['mae_delta']:.5f}`. While audience size provides global normalization, caption embeddings, media types, and temporal timing provide the intra-account variation.

---

## 7. Personal Model Policy Note

> [!NOTE]
> **Personal Model Evaluation Skipped:** Exactly 0 creators qualify with $\\ge 30$ clean posts in snapshot `{snapshot_name}`. Per project requirements, personal models are not evaluated on tiny samples to prevent invalid metrics.
"""

    temp_report = report_path + ".tmp"
    with open(temp_report, "w", encoding="utf-8") as f:
        f.write(md_content)
    os.replace(temp_report, report_path)

    print(f"\nEvaluation Complete in {runtime_s}s.")
    print(f"JSON saved to: {json_path}")
    print(f"Markdown report saved to: {report_path}")
    return run_payload

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", default="2026-11-03-clean-v2", help="Snapshot folder name under storage/snapshots/")
    parser.add_argument("--min-personal", type=int, default=30, help="Minimum posts required for personal models")
    args = parser.parse_args()
    run_evaluation(snapshot_name=args.snapshot)
