import os
import json
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, Any, List, Tuple
from scipy.stats import spearmanr
from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.linear_model import Ridge
import lightgbm as lgb

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_CLEAN_DIR = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean")

def get_follower_bucket(followers: int) -> str:
    if followers < 10000:
        return "under 10K"
    elif followers <= 100000:
        return "10K-100K"
    elif followers <= 1000000:
        return "100K-1M"
    else:
        return "over 1M"

def compute_within_creator_deviation_spearman(df: pd.DataFrame, pred_dev_col: str, actual_dev_col: str = "actual_deviation") -> Tuple[float, List[float]]:
    """Spearman between predicted deviation and actual deviation within each creator."""
    corrs = []
    for _, group in df.groupby("handle"):
        if len(group) >= 3:
            yp = group[pred_dev_col].values
            ya = group[actual_dev_col].values
            if not np.all(yp == yp[0]) and not np.all(ya == ya[0]):
                c, _ = spearmanr(yp, ya)
                if not np.isnan(c):
                    corrs.append(float(c))
    return (float(np.mean(corrs)) if corrs else 0.0), corrs

def bootstrap_deviation_spearman_ci(df: pd.DataFrame, pred_dev_col: str, actual_dev_col: str = "actual_deviation", n_boot: int = 1000) -> Tuple[float, float]:
    per_creator_corrs = {}
    for h, group in df.groupby("handle"):
        if len(group) >= 3:
            yp = group[pred_dev_col].values
            ya = group[actual_dev_col].values
            if not np.all(yp == yp[0]) and not np.all(ya == ya[0]):
                c, _ = spearmanr(yp, ya)
                if not np.isnan(c):
                    per_creator_corrs[h] = float(c)

    eligible = list(per_creator_corrs.keys())
    if not eligible:
        return 0.0, 0.0

    means = []
    np.random.seed(42)
    for _ in range(n_boot):
        sample_h = np.random.choice(eligible, size=len(eligible), replace=True)
        means.append(np.mean([per_creator_corrs[h] for h in sample_h]))

    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))

def load_clean_data(exclude_exact_3_likes: bool = False) -> pd.DataFrame:
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
            l = p.get("likesCount") if p.get("likesCount") is not None else p.get("likes_count")
            c = p.get("commentsCount") if p.get("commentsCount") is not None else p.get("comments_count")
            ts = p.get("postedAt") or p.get("posted_at")
            sc = p.get("shortcode") or p.get("code")
            cap = str(p.get("caption") or "")

            if exclude_exact_3_likes and l == 3:
                continue

            er = float(l + c) / float(followers)
            log_er = np.log(er) if er > 0 else -10.0

            # data_suspect: likes <= 5 with likes < comments, or ER > 1
            is_suspect = bool((l <= 5 and l < c) or (er > 1.0))

            post_rows.append({
                "handle": h,
                "shortcode": sc,
                "followers_count": followers,
                "follower_bucket": bucket,
                "likes": l,
                "comments": c,
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
    # Strict chronological sorting: oldest to newest
    df = df.sort_values(by=["handle", "posted_at_dt"]).reset_index(drop=True)

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
                "actual_deviation": log_ers[i] - prev_10_mean
            })

    tdf = pd.DataFrame(trailing_features)
    for col in tdf.columns:
        df[col] = tdf[col].values

    df["post_hour"] = df["posted_at_dt"].dt.hour
    df["post_weekday"] = df["posted_at_dt"].dt.weekday
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

def run_experiment(df_in: pd.DataFrame, label: str):
    print(f"\n=======================================================")
    print(f"RUNNING EXPERIMENT: {label} (N = {len(df_in)} posts, {df_in['handle'].nunique()} creators)")
    print(f"=======================================================")

    df = df_in.copy().reset_index(drop=True)
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

        p1 = np.percentile(train_df["actual_deviation"], 1.0)
        p99 = np.percentile(train_df["actual_deviation"], 99.0)
        train_dev_winsorized = np.clip(train_df["actual_deviation"], p1, p99)

        m_lgb = lgb.LGBMRegressor(
            n_estimators=60, learning_rate=0.03, max_depth=3, num_leaves=7,
            min_child_samples=25, subsample=0.8, colsample_bytree=0.8,
            reg_alpha=1.0, reg_lambda=5.0, random_state=42 + fold, verbose=-1
        )
        m_lgb.fit(train_df[default_features], train_dev_winsorized)
        df.iloc[val_idx, df.columns.get_loc("pred_dev_lgb")] = m_lgb.predict(val_df[default_features])

        m_ridge = Ridge(alpha=10.0, random_state=42 + fold)
        m_ridge.fit(train_df[ridge_features], train_dev_winsorized)
        df.iloc[val_idx, df.columns.get_loc("pred_dev_ridge")] = m_ridge.predict(val_df[ridge_features])

    # 1. Correct Within-Creator Deviation Spearman
    sp_lgb_mean, _ = compute_within_creator_deviation_spearman(df, "pred_dev_lgb", "actual_deviation")
    sp_lgb_ci = bootstrap_deviation_spearman_ci(df, "pred_dev_lgb", "actual_deviation")

    sp_ridge_mean, _ = compute_within_creator_deviation_spearman(df, "pred_dev_ridge", "actual_deviation")
    sp_ridge_ci = bootstrap_deviation_spearman_ci(df, "pred_dev_ridge", "actual_deviation")

    # 2. Shuffled Deviation Floor (20 repeats)
    # When predicted deviations are shuffled within each creator, expected Spearman against actual deviation is ~0.0
    shuff_corrs = []
    np.random.seed(42)
    for _ in range(20):
        df_shuff = df.copy()
        shuff_devs = []
        for h, grp in df.groupby("handle", sort=False):
            devs = grp["pred_dev_lgb"].values.copy()
            np.random.shuffle(devs)
            shuff_devs.extend(devs)
        df_shuff["pred_shuff_dev"] = shuff_devs
        m_sp, _ = compute_within_creator_deviation_spearman(df_shuff, "pred_shuff_dev", "actual_deviation")
        shuff_corrs.append(m_sp)

    shuff_floor_mean = float(np.mean(shuff_corrs))
    shuff_floor_95 = float(np.percentile(shuff_corrs, 95))

    print(f"Corrected Deviation Spearman (LightGBM): {sp_lgb_mean:.4f} [95% CI: {sp_lgb_ci[0]:.4f}, {sp_lgb_ci[1]:.4f}]")
    print(f"Corrected Deviation Spearman (Ridge):    {sp_ridge_mean:.4f} [95% CI: {sp_ridge_ci[0]:.4f}, {sp_ridge_ci[1]:.4f}]")
    print(f"Shuffled-Deviation Noise Floor: Mean = {shuff_floor_mean:.4f}, 95th Percentile = {shuff_floor_95:.4f}")
    print(f"Exceeds Floor? LightGBM Lower CI ({sp_lgb_ci[0]:.4f}) > Floor ({shuff_floor_95:.4f}): {sp_lgb_ci[0] > shuff_floor_95}")

    # Total Predictions for MAE
    df["pred_total_lgb"] = df["prev_10_mean"] + df["pred_dev_lgb"]
    mae_lgb = float(mean_absolute_error(df["log_er"], df["pred_total_lgb"]))
    mae_prev10 = float(mean_absolute_error(df["log_er"], df["prev_10_mean"]))

    print(f"MAE Total: LightGBM = {mae_lgb:.4f} vs Previous-10 = {mae_prev10:.4f}")

    # 3. Per-Follower-Bucket Results
    print("\n--- Per-Follower-Bucket Results (Final Model vs Prev-10 Baseline) ---")
    bucket_results = []
    for b in ["under 10K", "10K-100K", "100K-1M", "over 1M"]:
        b_df = df[df["follower_bucket"] == b].copy()
        n_creators = b_df["handle"].nunique()
        n_posts = len(b_df)
        unreliable = n_creators < 50

        b_mae_lgb = float(mean_absolute_error(b_df["log_er"], b_df["pred_total_lgb"]))
        b_mae_prev10 = float(mean_absolute_error(b_df["log_er"], b_df["prev_10_mean"]))
        
        b_sp, _ = compute_within_creator_deviation_spearman(b_df, "pred_dev_lgb", "actual_deviation")
        b_ci = bootstrap_deviation_spearman_ci(b_df, "pred_dev_lgb", "actual_deviation")

        bucket_results.append({
            "bucket": b,
            "creators": n_creators,
            "posts": n_posts,
            "unreliable_flag": unreliable,
            "mae_lgb": b_mae_lgb,
            "mae_prev10": b_mae_prev10,
            "deviation_spearman": b_sp,
            "deviation_spearman_ci_95": b_ci
        })
        flag_str = " [FLAGGED UNRELIABLE: < 50 creators]" if unreliable else ""
        print(f"  Bucket: {b:10s} | Creators: {n_creators:3d} | Posts: {n_posts:4d}{flag_str}")
        print(f"    MAE: LightGBM={b_mae_lgb:.4f} vs Prev10={b_mae_prev10:.4f} | Dev Spearman: {b_sp:.4f} [{b_ci[0]:.4f}, {b_ci[1]:.4f}]")

    return {
        "label": label,
        "n_posts": len(df),
        "n_creators": int(df["handle"].nunique()),
        "mae_lgb": mae_lgb,
        "mae_prev10": mae_prev10,
        "sp_lgb_mean": sp_lgb_mean,
        "sp_lgb_ci": sp_lgb_ci,
        "sp_ridge_mean": sp_ridge_mean,
        "sp_ridge_ci": sp_ridge_ci,
        "shuff_floor_mean": shuff_floor_mean,
        "shuff_floor_95": shuff_floor_95,
        "bucket_results": bucket_results,
        "df": df
    }

if __name__ == "__main__":
    # Run 1: On all clean data (excluding data_suspect)
    df_clean = load_clean_data(exclude_exact_3_likes=False)
    df_clean_no_suspect = df_clean[~df_clean["data_suspect"]].copy()
    res1 = run_experiment(df_clean_no_suspect, "regime_1_baseline_clean")

    # Run 2: Sensitivity run excluding all posts with exactly 3 likes
    df_no_3 = load_clean_data(exclude_exact_3_likes=True)
    df_no_3_no_suspect = df_no_3[~df_no_3["data_suspect"]].copy()
    res2 = run_experiment(df_no_3_no_suspect, "regime_2_sensitivity_exclude_exact_3_likes")
