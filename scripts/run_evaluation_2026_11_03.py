import os
import sys
import json
import time
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, Any, List, Tuple
from PIL import Image

import torch
from transformers import AutoImageProcessor, AutoModelForImageClassification
from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.linear_model import Ridge
from sklearn.decomposition import PCA
from scipy.stats import spearmanr
import lightgbm as lgb

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_CLEAN_DIR = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean")
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports")
EVAL_RUNS_DIR = os.path.join(STORAGE_DIR, "eval_runs")
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs(EVAL_RUNS_DIR, exist_ok=True)

def compute_spearman(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    if len(y_true) < 2 or np.all(y_true == y_true[0]) or np.all(y_pred == y_pred[0]):
        return 0.0
    corr, _ = spearmanr(y_true, y_pred)
    return 0.0 if np.isnan(corr) else float(corr)

def compute_within_creator_spearman(df: pd.DataFrame, y_true_col: str, y_pred_col: str) -> Tuple[float, List[float]]:
    corrs = []
    for _, group in df.groupby("handle"):
        if len(group) >= 3:
            yt = group[y_true_col].values
            yp = group[y_pred_col].values
            if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                c, _ = spearmanr(yt, yp)
                if not np.isnan(c):
                    corrs.append(float(c))
    return (float(np.mean(corrs)) if corrs else 0.0), corrs

def bootstrap_creator_spearman_ci(df: pd.DataFrame, y_true_col: str, y_pred_col: str, n_boot: int = 1000) -> Tuple[float, float]:
    per_creator_corrs = {}
    for h, group in df.groupby("handle"):
        if len(group) >= 3:
            yt = group[y_true_col].values
            yp = group[y_pred_col].values
            if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                c, _ = spearmanr(yt, yp)
                if not np.isnan(c):
                    per_creator_corrs[h] = float(c)

    eligible_handles = list(per_creator_corrs.keys())
    if not eligible_handles:
        return (0.0, 0.0)

    means = []
    np.random.seed(42)
    for _ in range(n_boot):
        sample_h = np.random.choice(eligible_handles, size=len(eligible_handles), replace=True)
        means.append(np.mean([per_creator_corrs[h] for h in sample_h]))

    return (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))

def bootstrap_mae_delta_ci(df: pd.DataFrame, y_true_col: str, model_pred_col: str, base_pred_col: str, n_boot: int = 1000) -> Tuple[float, float, float]:
    """Computes MAE delta (Base - Model) where > 0 means model is better."""
    handles = df["handle"].unique()
    per_creator_deltas = {}
    for h, group in df.groupby("handle"):
        yt = group[y_true_col].values
        yp_m = group[model_pred_col].values
        yp_b = group[base_pred_col].values
        mae_m = np.mean(np.abs(yt - yp_m))
        mae_b = np.mean(np.abs(yt - yp_b))
        per_creator_deltas[h] = float(mae_b - mae_m)

    all_h = list(per_creator_deltas.keys())
    means = []
    np.random.seed(42)
    for _ in range(n_boot):
        sample_h = np.random.choice(all_h, size=len(all_h), replace=True)
        means.append(np.mean([per_creator_deltas[h] for h in sample_h]))

    mean_delta = float(np.mean(list(per_creator_deltas.values())))
    ci_low = float(np.percentile(means, 2.5))
    ci_high = float(np.percentile(means, 97.5))
    return mean_delta, ci_low, ci_high

def get_follower_bucket(followers: int) -> str:
    if followers < 10000:
        return "under 10K"
    elif followers <= 100000:
        return "10K-100K"
    elif followers <= 1000000:
        return "100K-1M"
    else:
        return "over 1M"

def load_data():
    profiles_dir = os.path.join(SNAP_CLEAN_DIR, "profiles")
    posts_dir = os.path.join(SNAP_CLEAN_DIR, "posts")

    post_rows = []
    for pf in sorted(os.listdir(posts_dir)):
        if not pf.endswith(".json"):
            continue
        h = pf.replace(".json", "")
        with open(os.path.join(profiles_dir, pf), "r", encoding="utf-8") as f:
            pdata = json.load(f)
        followers = pdata.get("followers_count") or pdata.get("followersCount")
        following = pdata.get("following_count") or 0
        bucket = get_follower_bucket(followers)

        with open(os.path.join(posts_dir, pf), "r", encoding="utf-8") as f:
            posts = json.load(f)

        for p in posts:
            likes = p.get("likesCount") if p.get("likesCount") is not None else p.get("likes_count")
            comments = p.get("commentsCount") if p.get("commentsCount") is not None else p.get("comments_count")
            ts = p.get("postedAt") or p.get("posted_at")
            sc = p.get("shortcode") or p.get("code")
            cap = str(p.get("caption") or "")

            er = float(likes + comments) / float(followers)
            log_er = np.log(er) if er > 0 else -10.0

            # data_suspect flag: likes <= 5 with likes < comments, or ER > 1
            is_suspect = bool((likes <= 5 and likes < comments) or (er > 1.0))

            post_rows.append({
                "handle": h,
                "shortcode": sc,
                "followers_count": followers,
                "following_count": following,
                "follower_bucket": bucket,
                "likes": likes,
                "comments": comments,
                "engagement_rate": er,
                "log_er": log_er,
                "posted_at": ts,
                "caption": cap,
                "hashtags": p.get("hashtags") or [],
                "media_type": p.get("mediaType") or p.get("media_type") or "image",
                "data_suspect": is_suspect
            })

    df = pd.DataFrame(post_rows)
    df["posted_at_dt"] = pd.to_datetime(df["posted_at"], utc=True)
    df = df.sort_values(by=["handle", "posted_at_dt"]).reset_index(drop=True)

    # Compute trailing features strictly from earlier posts
    bucket_means = df.groupby("follower_bucket")["log_er"].mean().to_dict()

    trailing_features = []
    for handle, group in df.groupby("handle", sort=False):
        log_ers = group["log_er"].values
        dts = group["posted_at_dt"].values
        b_mean = bucket_means[group["follower_bucket"].values[0]]
        
        n_posts = len(group)
        for i in range(n_posts):
            prior_log_ers = log_ers[:i]
            prior_dts = dts[:i]
            num_prior = len(prior_log_ers)

            if num_prior >= 3:
                has_history = 1
                prev_10 = prior_log_ers[-10:]
                prev_3 = prior_log_ers[-3:]
                prev_10_mean = float(np.mean(prev_10))
                prev_10_std = float(np.std(prev_10)) if len(prev_10) > 1 else 0.0
                prev_3_mean = float(np.mean(prev_3))
            else:
                has_history = 0
                prev_10_mean = b_mean
                prev_10_std = 0.0
                prev_3_mean = b_mean

            if num_prior >= 1:
                diff_sec = (dts[i] - prior_dts[-1]) / np.timedelta64(1, 's')
                days_since_prev = max(0.0, float(diff_sec) / 86400.0)
            else:
                days_since_prev = 0.0

            trailing_features.append({
                "prev_10_mean": prev_10_mean,
                "prev_10_std": prev_10_std,
                "prev_3_mean": prev_3_mean,
                "num_prior_posts": num_prior,
                "days_since_prev": days_since_prev,
                "has_history": has_history,
                "target_deviation": log_ers[i] - prev_10_mean
            })

    tdf = pd.DataFrame(trailing_features)
    for col in tdf.columns:
        df[col] = tdf[col].values

    # Base features
    df["post_hour"] = df["posted_at_dt"].dt.hour
    df["post_weekday"] = df["posted_at_dt"].dt.weekday
    df["is_weekend"] = df["post_weekday"].apply(lambda w: 1 if w >= 5 else 0)
    df["hour_sin"] = np.sin(2 * np.pi * df["post_hour"] / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * df["post_hour"] / 24.0)

    df["caption_length"] = df["caption"].apply(lambda c: len(str(c)))
    df["hashtag_count"] = df["hashtags"].apply(lambda h: len(h) if isinstance(h, list) else 0)

    media_dummies = pd.get_dummies(df["media_type"], prefix="media")
    for col in ["media_image", "media_reel", "media_video", "media_carousel", "media_story"]:
        if col not in media_dummies.columns:
            media_dummies[col] = 0
    df = pd.concat([df, media_dummies], axis=1)

    return df

def run_evaluation_pipeline(df_in: pd.DataFrame, label: str = "all_posts") -> Dict[str, Any]:
    print(f"\n=======================================================")
    print(f"RUNNING EVALUATION PIPELINE: {label} (N = {len(df_in)} posts, {df_in['handle'].nunique()} creators)")
    print(f"=======================================================")

    df = df_in.copy().reset_index(drop=True)
    bucket_means = df.groupby("follower_bucket")["log_er"].mean().to_dict()

    media_time_features = ["media_image", "media_reel", "media_video", "media_carousel", "hour_sin", "hour_cos", "post_weekday"]
    caption_features = ["caption_length"]
    hashtag_features = ["hashtag_count"]
    trailing_history_features = ["prev_10_std", "prev_3_mean", "num_prior_posts", "days_since_prev", "has_history"]

    default_features = media_time_features + caption_features + hashtag_features + trailing_history_features
    ridge_features = [
        "media_reel", "media_carousel", "hour_sin", "hour_cos", "post_weekday",
        "caption_length", "hashtag_count", "prev_10_std", "has_history"
    ]

    gkf = GroupKFold(n_splits=5)
    groups = df["handle"].values

    df["pred_dev_lgb"] = np.nan
    df["pred_dev_ridge"] = np.nan

    for fold, (train_idx, val_idx) in enumerate(gkf.split(df, df["log_er"], groups)):
        train_df = df.iloc[train_idx].copy()
        val_df = df.iloc[val_idx].copy()

        # Winsorize target at 1st and 99th percentile strictly in training folds
        p1 = np.percentile(train_df["target_deviation"], 1.0)
        p99 = np.percentile(train_df["target_deviation"], 99.0)
        train_target_winsorized = np.clip(train_df["target_deviation"], p1, p99)

        # 1. Regularized LightGBM
        m_lgb = lgb.LGBMRegressor(
            n_estimators=60, learning_rate=0.03, max_depth=3, num_leaves=7,
            min_child_samples=25, subsample=0.8, colsample_bytree=0.8,
            reg_alpha=1.0, reg_lambda=5.0, random_state=42 + fold, verbose=-1
        )
        m_lgb.fit(train_df[default_features], train_target_winsorized)
        df.iloc[val_idx, df.columns.get_loc("pred_dev_lgb")] = m_lgb.predict(val_df[default_features])

        # 2. Ridge
        m_ridge = Ridge(alpha=10.0, random_state=42 + fold)
        m_ridge.fit(train_df[ridge_features], train_target_winsorized)
        df.iloc[val_idx, df.columns.get_loc("pred_dev_ridge")] = m_ridge.predict(val_df[ridge_features])

    df["pred_total_lgb"] = df["prev_10_mean"] + df["pred_dev_lgb"]
    df["pred_total_ridge"] = df["prev_10_mean"] + df["pred_dev_ridge"]
    df["pred_baseline_bucket"] = df["follower_bucket"].map(bucket_means).values
    df["pred_baseline_prev10"] = df["prev_10_mean"]

    # Shuffled control (20 repeats)
    print("Computing shuffled-deviation control (20 repeats)...")
    shuffled_spearmans = []
    np.random.seed(42)
    for _ in range(20):
        shuff_devs = []
        for handle, grp in df.groupby("handle", sort=False):
            devs = grp["pred_dev_lgb"].values.copy()
            np.random.shuffle(devs)
            shuff_devs.extend(devs)
        pred_shuff = df["prev_10_mean"].values + np.array(shuff_devs)
        df_shuff = df.copy()
        df_shuff["pred_shuff"] = pred_shuff
        m_sp, _ = compute_within_creator_spearman(df_shuff, "log_er", "pred_shuff")
        shuffled_spearmans.append(m_sp)

    shuffled_floor_mean = float(np.mean(shuffled_spearmans))
    shuffled_floor_95 = float(np.percentile(shuffled_spearmans, 95))
    print(f"Shuffled floor mean: {shuffled_floor_mean:.4f}, 95th: {shuffled_floor_95:.4f}")

    # Metrics evaluation
    models_to_eval = [
        ("Follower-Bucket Mean", "pred_baseline_bucket"),
        ("Previous-10 Mean Alone", "pred_baseline_prev10"),
        ("Regularized LightGBM (Prev-10 + Dev)", "pred_total_lgb"),
        ("Ridge (Prev-10 + Dev)", "pred_total_ridge")
    ]

    metrics_list = []
    for name, pred_col in models_to_eval:
        mae = float(mean_absolute_error(df["log_er"], df[pred_col]))
        r2 = float(r2_score(df["log_er"], df[pred_col]))
        pooled_sp = compute_spearman(df["log_er"].values, df[pred_col].values)
        mean_creator_sp, _ = compute_within_creator_spearman(df, "log_er", pred_col)
        ci_low, ci_high = bootstrap_creator_spearman_ci(df, "log_er", pred_col)

        metrics_list.append({
            "model": name,
            "mae": mae,
            "r2": r2,
            "pooled_spearman": pooled_sp,
            "mean_creator_spearman": mean_creator_sp,
            "spearman_ci_95": [ci_low, ci_high]
        })

    # Permutation feature group importance
    print("Computing feature group importance...")
    feature_groups = {
        "media_time": media_time_features,
        "caption": caption_features,
        "hashtags": hashtag_features,
        "trailing_history": trailing_history_features
    }
    base_sp, _ = compute_within_creator_spearman(df, "log_er", "pred_total_lgb")
    group_importance = {}
    np.random.seed(42)
    for grp_name, grp_cols in feature_groups.items():
        df_perm = df.copy()
        for c in grp_cols:
            df_perm[c] = np.random.permutation(df_perm[c].values)

        perm_preds = np.zeros(len(df))
        for fold, (train_idx, val_idx) in enumerate(gkf.split(df, df["log_er"], groups)):
            train_df = df.iloc[train_idx]
            val_df_perm = df_perm.iloc[val_idx]
            p1 = np.percentile(train_df["target_deviation"], 1.0)
            p99 = np.percentile(train_df["target_deviation"], 99.0)
            train_target_winsorized = np.clip(train_df["target_deviation"], p1, p99)

            m = lgb.LGBMRegressor(
                n_estimators=60, learning_rate=0.03, max_depth=3, num_leaves=7,
                min_child_samples=25, subsample=0.8, colsample_bytree=0.8,
                reg_alpha=1.0, reg_lambda=5.0, random_state=42 + fold, verbose=-1
            )
            m.fit(train_df[default_features], train_target_winsorized)
            perm_preds[val_idx] = val_df_perm["prev_10_mean"].values + m.predict(val_df_perm[default_features])

        df_perm["perm_pred"] = perm_preds
        perm_sp, _ = compute_within_creator_spearman(df_perm, "log_er", "perm_pred")
        drop = base_sp - perm_sp
        group_importance[grp_name] = {
            "within_creator_spearman_after_perm": float(perm_sp),
            "importance_drop": float(drop)
        }
        print(f"Group: {grp_name:18s} | Drop: {drop:+.4f}")

    # Learning curve: 25%, 50%, 75%, 100% of creators
    print("Computing learning curve...")
    learning_curve = []
    unique_creators = df["handle"].unique()
    np.random.seed(42)
    shuffled_creators = np.random.permutation(unique_creators)

    for pct in [0.25, 0.50, 0.75, 1.00]:
        n_c = int(len(unique_creators) * pct)
        subset_creators = set(shuffled_creators[:n_c])
        sub_df = df[df["handle"].isin(subset_creators)].copy().reset_index(drop=True)
        sub_groups = sub_df["handle"].values

        sub_gkf = GroupKFold(n_splits=5)
        sub_preds = np.zeros(len(sub_df))

        for fold, (train_idx, val_idx) in enumerate(sub_gkf.split(sub_df, sub_df["log_er"], sub_groups)):
            train_df = sub_df.iloc[train_idx]
            val_df = sub_df.iloc[val_idx]
            p1 = np.percentile(train_df["target_deviation"], 1.0)
            p99 = np.percentile(train_df["target_deviation"], 99.0)
            train_target_winsorized = np.clip(train_df["target_deviation"], p1, p99)

            m = lgb.LGBMRegressor(
                n_estimators=60, learning_rate=0.03, max_depth=3, num_leaves=7,
                min_child_samples=25, subsample=0.8, colsample_bytree=0.8,
                reg_alpha=1.0, reg_lambda=5.0, random_state=42 + fold, verbose=-1
            )
            m.fit(train_df[default_features], train_target_winsorized)
            sub_preds[val_idx] = val_df["prev_10_mean"].values + m.predict(val_df[default_features])

        sub_df["pred"] = sub_preds
        sub_mae = float(mean_absolute_error(sub_df["log_er"], sub_df["pred"]))
        sub_sp, _ = compute_within_creator_spearman(sub_df, "log_er", "pred")
        learning_curve.append({
            "creator_fraction": pct,
            "creator_count": n_c,
            "post_count": len(sub_df),
            "mae": sub_mae,
            "within_creator_spearman": sub_sp
        })
        print(f"  {int(pct*100)}% creators ({n_c}): MAE={sub_mae:.4f}, Spearman={sub_sp:.4f}")

    # Bootstrap MAE delta vs prev-10
    delta_mean, delta_ci_low, delta_ci_high = bootstrap_mae_delta_ci(
        df, "log_er", "pred_total_lgb", "pred_baseline_prev10"
    )

    # Gate check
    # Gate A: beats previous-10 mean alone on MAE with bootstrap CI excluding zero (> 0)
    gate_a = bool(delta_ci_low > 0.0)
    # Gate B: within-creator Spearman CI lower bound clears the shuffled floor
    lgb_sp_ci = [m for m in metrics_list if "LightGBM" in m["model"]][0]["spearman_ci_95"]
    gate_b = bool(lgb_sp_ci[0] > shuffled_floor_95)

    print(f"\nGATE EVALUATION FOR {label}:")
    print(f"  Gate A (MAE Delta CI excludes 0): {gate_a} (Delta: {delta_mean:+.4f}, 95% CI: [{delta_ci_low:+.4f}, {delta_ci_high:+.4f}])")
    print(f"  Gate B (Within-Creator Spearman CI lower bound > Shuffled floor {shuffled_floor_95:.4f}): {gate_b} (CI Lower: {lgb_sp_ci[0]:+.4f})")
    print(f"  OVERALL GATE PASS: {gate_a and gate_b}")

    return {
        "label": label,
        "n_posts": len(df),
        "n_creators": int(df["handle"].nunique()),
        "metrics": metrics_list,
        "shuffled_control": {
            "mean": shuffled_floor_mean,
            "percentile_95": shuffled_floor_95
        },
        "group_importance": group_importance,
        "learning_curve": learning_curve,
        "mae_delta_vs_prev10": {
            "mean": delta_mean,
            "ci_95": [delta_ci_low, delta_ci_high]
        },
        "gate_a": gate_a,
        "gate_b": gate_b,
        "gate_passed": bool(gate_a and gate_b),
        "default_features": default_features
    }

def main():
    print("Loading data from snapshot 2026-11-03-clean...")
    df = load_data()
    print(f"Loaded {len(df)} posts across {df['handle'].nunique()} creators.")
    print(f"Data suspect count: {df['data_suspect'].sum()} / {len(df)}")

    # 1. Run on All Posts
    res_all = run_evaluation_pipeline(df, label="all_posts")

    # 2. Run without Data-Suspect Posts
    df_clean_only = df[~df["data_suspect"]].copy().reset_index(drop=True)
    res_clean_only = run_evaluation_pipeline(df_clean_only, label="excluding_data_suspect")

    # Save evaluation runs
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    eval_payload = {
        "timestamp": timestamp,
        "snapshot": "2026-11-03-clean",
        "eval_all": res_all,
        "eval_clean_only": res_clean_only
    }
    with open(os.path.join(EVAL_RUNS_DIR, f"eval_2026_11_03_{timestamp}.json"), "w", encoding="utf-8") as f:
        json.dump(eval_payload, f, indent=2)

    print("\nEvaluation runs successfully saved!")

if __name__ == "__main__":
    main()
