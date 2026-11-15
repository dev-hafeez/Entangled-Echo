import os
import json
import joblib
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Tuple
from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error
from sklearn.linear_model import Ridge
import lightgbm as lgb
from scipy.stats import spearmanr

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_CLEAN_V2 = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean-v2")

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
    profiles_dir = os.path.join(SNAP_CLEAN_V2, "profiles")
    posts_dir = os.path.join(SNAP_CLEAN_V2, "posts")

    post_rows = []
    for pf in sorted(os.listdir(posts_dir)):
        if not pf.endswith(".json"): continue
        h = pf.replace(".json", "")
        with open(os.path.join(profiles_dir, pf), "r", encoding="utf-8") as f:
            pdata = json.load(f)
        followers = pdata.get("followers_count") or pdata.get("followersCount")
        bucket = get_follower_bucket(followers)

        with open(os.path.join(posts_dir, pf), "r", encoding="utf-8") as f:
            posts = json.load(f)

        for p in posts:
            l = p.get("likesCount")
            c = p.get("commentsCount")
            ts = p.get("postedAt") or p.get("posted_at")
            sc = p.get("shortcode") or p.get("code")
            cap = str(p.get("caption") or "")

            if l is None or c is None:
                continue

            er = float(l + c) / float(followers)
            log_er = np.log(er) if er > 0 else -10.0
            is_suspect = bool((l <= 5 and l < c) or (er > 1.0))

            post_rows.append({
                "handle": h,
                "shortcode": sc,
                "followers": followers,
                "bucket": bucket,
                "likes": l,
                "comments": c,
                "log_er": log_er,
                "posted_at": ts,
                "caption": cap,
                "hashtags": p.get("hashtags") or [],
                "media_type": p.get("mediaType") or p.get("media_type") or "image",
                "data_suspect": is_suspect
            })

    df = pd.DataFrame(post_rows)
    df = df[~df["data_suspect"]].copy()
    df["posted_at_dt"] = pd.to_datetime(df["posted_at"], utc=True)
    df = df.sort_values(by=["handle", "posted_at_dt"]).reset_index(drop=True)

    # Basic features
    df["post_hour"] = df["posted_at_dt"].dt.hour
    df["post_weekday"] = df["posted_at_dt"].dt.weekday
    df["hour_sin"] = np.sin(2 * np.pi * df["post_hour"] / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * df["post_hour"] / 24.0)
    df["caption_length"] = df["caption"].apply(lambda c: len(str(c)))
    df["hashtag_count"] = df["hashtags"].apply(lambda h: len(h) if isinstance(h, list) else 0)

    # Media dummies
    m_dummies = pd.get_dummies(df["media_type"], prefix="media")
    for col in ["media_image", "media_reel", "media_video", "media_carousel"]:
        if col not in m_dummies.columns:
            m_dummies[col] = 0
    df = pd.concat([df, m_dummies[["media_image", "media_reel", "media_video", "media_carousel"]]], axis=1)

    # Strictly prior history calculation
    prev_means, prev_stds, prev3_means, n_priors, days_since = [], [], [], [], []
    for h, grp in df.groupby("handle"):
        logs = grp["log_er"].values
        times = grp["posted_at_dt"].values
        for i in range(len(logs)):
            if i == 0:
                prev_means.append(np.nan)
                prev_stds.append(np.nan)
                prev3_means.append(np.nan)
                n_priors.append(0)
                days_since.append(np.nan)
            else:
                w10 = logs[max(0, i-10):i]
                w3 = logs[max(0, i-3):i]
                prev_means.append(float(np.mean(w10)))
                prev_stds.append(float(np.std(w10)) if len(w10) > 1 else 0.0)
                prev3_means.append(float(np.mean(w3)))
                n_priors.append(len(w10))
                dt_days = (times[i] - times[i-1]).astype("timedelta64[s]").astype(float) / 86400.0
                days_since.append(dt_days)

    df["prev_10_mean"] = prev_means
    df["prev_10_std"] = prev_stds
    df["prev_3_mean"] = prev3_means
    df["n_priors"] = n_priors
    df["days_since_prev"] = days_since

    return df

def run_all():
    df = load_data()
    print(f"Total usable posts: {len(df)} across {df['handle'].nunique()} creators")

    # ----------------------------------------------------
    # TASK 2: SHRINKAGE BASELINE FOR LEVEL PREDICTION
    # ----------------------------------------------------
    # Evaluate on posts that have at least 1 prior post so prev_10_mean is well-defined
    df_eval = df[df["n_priors"] >= 1].copy().reset_index(drop=True)
    
    # Bucket mean for shrinkage
    b_means = df.groupby("bucket")["log_er"].mean().to_dict()
    df_eval["bucket_mean"] = df_eval["bucket"].map(b_means)

    # 5-fold CV to pick k and evaluate LightGBM deviation model
    gkf = GroupKFold(n_splits=5)
    groups = df_eval["handle"].values

    # Find optimal k on CV
    best_k = 1
    best_k_score = 999.0
    for k_cand in range(1, 21):
        fold_maes = []
        for train_idx, val_idx in gkf.split(df_eval, groups=groups):
            val_sub = df_eval.iloc[val_idx]
            w = val_sub["n_priors"] / (val_sub["n_priors"] + k_cand)
            pred = w * val_sub["prev_10_mean"] + (1 - w) * val_sub["bucket_mean"]
            fold_maes.append(mean_absolute_error(val_sub["log_er"], pred))
        if np.mean(fold_maes) < best_k_score:
            best_k_score = np.mean(fold_maes)
            best_k = k_cand

    print(f"\nOptimal shrinkage k chosen by CV: {best_k} (CV MAE: {best_k_score:.4f})")

    # Predictions storage
    df_eval["pred_prev10"] = df_eval["prev_10_mean"]
    w = df_eval["n_priors"] / (df_eval["n_priors"] + best_k)
    df_eval["pred_shrunk"] = w * df_eval["prev_10_mean"] + (1 - w) * df_eval["bucket_mean"]
    df_eval["pred_lgb"] = np.nan

    # Fit LightGBM deviation model on GroupKFold
    features_lgb = [
        "media_image", "media_reel", "media_video", "media_carousel",
        "hour_sin", "hour_cos", "post_weekday",
        "caption_length", "hashtag_count",
        "prev_10_std", "prev_3_mean", "n_priors", "days_since_prev"
    ]

    for fold, (train_idx, val_idx) in enumerate(gkf.split(df_eval, groups=groups)):
        train_sub = df_eval.iloc[train_idx]
        val_sub = df_eval.iloc[val_idx]

        # Target = log_er - prev_10_mean
        y_dev_train = train_sub["log_er"].values - train_sub["prev_10_mean"].values
        # Winsorize target at 1st and 99th percentile on training fold only
        p1, p99 = np.percentile(y_dev_train, [1, 99])
        y_dev_train_win = np.clip(y_dev_train, p1, p99)

        train_data = lgb.Dataset(train_sub[features_lgb], label=y_dev_train_win)
        params = {
            "objective": "regression",
            "metric": "mae",
            "learning_rate": 0.05,
            "num_leaves": 15,
            "min_data_in_leaf": 20,
            "reg_alpha": 1.0,
            "reg_lambda": 1.0,
            "verbose": -1,
            "seed": 42 + fold
        }
        gbm = lgb.train(params, train_data, num_boost_round=100)
        pred_dev = gbm.predict(val_sub[features_lgb])
        # Level prediction = prev_10_mean + pred_dev
        df_eval.iloc[val_idx, df_eval.columns.get_loc("pred_lgb")] = val_sub["prev_10_mean"].values + pred_dev

    # Evaluate MAE per creator
    mae_prev10_dict, mae_shrunk_dict, mae_lgb_dict = {}, {}, {}
    for h, grp in df_eval.groupby("handle"):
        mae_prev10_dict[h] = mean_absolute_error(grp["log_er"], grp["pred_prev10"])
        mae_shrunk_dict[h] = mean_absolute_error(grp["log_er"], grp["pred_shrunk"])
        mae_lgb_dict[h] = mean_absolute_error(grp["log_er"], grp["pred_lgb"])

    # Bootstrap CIs of MAE and paired differences over creators
    creators = list(mae_prev10_dict.keys())
    np.random.seed(42)
    boot_prev10, boot_shrunk, boot_lgb = [], [], []
    boot_delta_shrunk_vs_prev = []
    boot_delta_lgb_vs_shrunk = []
    boot_delta_lgb_vs_prev = []

    for _ in range(1000):
        s_c = np.random.choice(creators, size=len(creators), replace=True)
        m_p = np.mean([mae_prev10_dict[c] for c in s_c])
        m_s = np.mean([mae_shrunk_dict[c] for c in s_c])
        m_l = np.mean([mae_lgb_dict[c] for c in s_c])
        boot_prev10.append(m_p)
        boot_shrunk.append(m_s)
        boot_lgb.append(m_l)
        boot_delta_shrunk_vs_prev.append(m_s - m_p)
        boot_delta_lgb_vs_shrunk.append(m_l - m_s)
        boot_delta_lgb_vs_prev.append(m_l - m_p)

    print("\n--- 2. LEVEL PREDICTION & SHRINKAGE BASELINE (OVER CREATORS) ---")
    print(f"1) Previous-10 Mean Alone: MAE = {np.mean(list(mae_prev10_dict.values())):.4f} [95% CI: {np.percentile(boot_prev10, 2.5):.4f}, {np.percentile(boot_prev10, 97.5):.4f}]")
    print(f"2) Shrunk Baseline (k={best_k})  : MAE = {np.mean(list(mae_shrunk_dict.values())):.4f} [95% CI: {np.percentile(boot_shrunk, 2.5):.4f}, {np.percentile(boot_shrunk, 97.5):.4f}]")
    print(f"   Paired Delta (Shrunk - Prev10): {np.mean(boot_delta_shrunk_vs_prev):.4f} [95% CI: {np.percentile(boot_delta_shrunk_vs_prev, 2.5):.4f}, {np.percentile(boot_delta_shrunk_vs_prev, 97.5):.4f}]")
    print(f"3) LightGBM Deviation    : MAE = {np.mean(list(mae_lgb_dict.values())):.4f} [95% CI: {np.percentile(boot_lgb, 2.5):.4f}, {np.percentile(boot_lgb, 97.5):.4f}]")
    print(f"   Paired Delta (LGB - Shrunk)   : {np.mean(boot_delta_lgb_vs_shrunk):.4f} [95% CI: {np.percentile(boot_delta_lgb_vs_shrunk, 2.5):.4f}, {np.percentile(boot_delta_lgb_vs_shrunk, 97.5):.4f}]")
    print(f"   Paired Delta (LGB - Prev10)   : {np.mean(boot_delta_lgb_vs_prev):.4f} [95% CI: {np.percentile(boot_delta_lgb_vs_prev, 2.5):.4f}, {np.percentile(boot_delta_lgb_vs_prev, 97.5):.4f}]")

    # ----------------------------------------------------
    # TASK 3: UNDER-100K CREATOR RANKING EVALUATION
    # ----------------------------------------------------
    # Evaluate winning ranking model:
    # Selected features based on ladder: Media Type + (Caption Length, Hashtags, Caption PCA, Thumbnail PCA)
    # Media type alone had 0.2325, adding (c)+(d)+(e) reached 0.2464.
    # We evaluate ranking performance specifically on under-100K creators (76 creators in dataset)
    under100k_handles = set(df[df["followers"] < 100000]["handle"].unique())
    print(f"\n--- 3. RANKING ON UNDER-100K CREATORS ({len(under100k_handles)} creators) ---")

    # A) Global ranking model (evaluated on under-100k creators)
    # Using media type only (or media + content)
    feat_ranking = ["media_image", "media_reel", "media_video", "media_carousel"]

    df["pred_rank_global"] = np.nan
    gkf_all = GroupKFold(n_splits=5)
    for fold, (train_idx, val_idx) in enumerate(gkf_all.split(df, groups=df["handle"])):
        train_df = df.iloc[train_idx]
        val_df = df.iloc[val_idx]
        train_creator_means = train_df.groupby("handle")["log_er"].mean().to_dict()
        y_train = train_df["log_er"].values - train_df["handle"].map(train_creator_means).values
        m = Ridge(alpha=10.0, random_state=42 + fold)
        m.fit(train_df[feat_ranking], y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_rank_global")] = m.predict(val_df[feat_ranking])

    # B) Local under-100k-only ranking model (trained strictly on under-100k creators)
    df_under = df[df["handle"].isin(under100k_handles)].copy().reset_index(drop=True)
    df_under["pred_rank_under"] = np.nan
    gkf_under = GroupKFold(n_splits=5)
    for fold, (train_idx, val_idx) in enumerate(gkf_under.split(df_under, groups=df_under["handle"])):
        train_df = df_under.iloc[train_idx]
        val_df = df_under.iloc[val_idx]
        train_creator_means = train_df.groupby("handle")["log_er"].mean().to_dict()
        y_train = train_df["log_er"].values - train_df["handle"].map(train_creator_means).values
        m = Ridge(alpha=10.0, random_state=42 + fold)
        m.fit(train_df[feat_ranking], y_train)
        df_under.iloc[val_idx, df_under.columns.get_loc("pred_rank_under")] = m.predict(val_df[feat_ranking])

    # Evaluate within-creator Spearman on under-100K creators
    corrs_global = {}
    corrs_under = {}
    corrs_shuff = []

    for h in under100k_handles:
        grp_glob = df[df["handle"] == h]
        grp_und = df_under[df_under["handle"] == h]
        if len(grp_glob) >= 3:
            yt = grp_glob["log_er"].values
            yp_g = grp_glob["pred_rank_global"].values
            if not np.all(yt == yt[0]) and not np.all(yp_g == yp_g[0]):
                c_g, _ = spearmanr(yt, yp_g)
                if not np.isnan(c_g):
                    corrs_global[h] = float(c_g)
        if len(grp_und) >= 3:
            yt = grp_und["log_er"].values
            yp_u = grp_und["pred_rank_under"].values
            if not np.all(yt == yt[0]) and not np.all(yp_u == yp_u[0]):
                c_u, _ = spearmanr(yt, yp_u)
                if not np.isnan(c_u):
                    corrs_under[h] = float(c_u)

    # Shuffled floor for under-100k creators
    shuff_means = []
    np.random.seed(42)
    for _ in range(20):
        s_c = []
        for h in under100k_handles:
            grp = df[df["handle"] == h]
            if len(grp) >= 3:
                yt = grp["log_er"].values
                yp = np.random.permutation(grp["pred_rank_global"].values)
                if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                    c, _ = spearmanr(yt, yp)
                    if not np.isnan(c):
                        s_c.append(float(c))
        if s_c:
            shuff_means.append(np.mean(s_c))
    shuff_under_floor = float(np.percentile(shuff_means, 95))

    # Bootstrap CIs for under-100k
    def boot_ci(d):
        keys = list(d.keys())
        means = []
        for _ in range(1000):
            sample = np.random.choice(keys, size=len(keys), replace=True)
            means.append(np.mean([d[k] for k in sample]))
        return float(np.mean(list(d.values()))), (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))

    m_g, ci_g = boot_ci(corrs_global)
    m_u, ci_u = boot_ci(corrs_under)

    print(f"Shuffled-Within-Creator Floor (95th%): {shuff_under_floor:+.4f}")
    print(f"Global Model on Under-100K Creators  : Spearman = {m_g:+.4f} [95% CI: {ci_g[0]:+.4f}, {ci_g[1]:+.4f}] (N={len(corrs_global)} eligible)")
    print(f"Under-100K-Only Trained Model        : Spearman = {m_u:+.4f} [95% CI: {ci_u[0]:+.4f}, {ci_u[1]:+.4f}] (N={len(corrs_under)} eligible)")
    print(f"Does Global beat floor? {ci_g[0] > shuff_under_floor}")
    print(f"Does Under-100K-only beat floor? {ci_u[0] > shuff_under_floor}")

if __name__ == "__main__":
    run_all()
