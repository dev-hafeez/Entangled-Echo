import os
import json
import numpy as np
import pandas as pd
from datetime import datetime, timezone
from typing import Dict, Any, List, Tuple
from scipy.stats import spearmanr
from sklearn.model_selection import GroupKFold
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge
import lightgbm as lgb
import statsmodels.api as sm
from sklearn.metrics import mean_absolute_error

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_CLEAN_V2 = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean-v2")
EMBEDDINGS_DIR = os.path.join(STORAGE_DIR, "embeddings")
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports")

SNAPSHOT_TIME = datetime.fromisoformat("2026-11-03T15:41:16.323983+00:00")

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

        with open(os.path.join(posts_dir, pf), "r", encoding="utf-8") as f:
            posts = json.load(f)

        for p in posts:
            l = p.get("likesCount"); c = p.get("commentsCount")
            ts = p.get("postedAt") or p.get("posted_at")
            sc = p.get("shortcode") or p.get("code")
            cap = str(p.get("caption") or "")

            if l is None or c is None: continue
            er = float(l + c) / float(followers)
            log_er = np.log(er) if er > 0 else -10.0
            is_suspect = bool((l <= 5 and l < c) or (er > 1.0))

            post_rows.append({
                "handle": h, "shortcode": sc, "followers": followers,
                "likes": l, "comments": c, "log_er": log_er, "posted_at": ts,
                "caption": cap, "hashtags": p.get("hashtags") or [],
                "media_type": p.get("mediaType") or p.get("media_type") or "image",
                "data_suspect": is_suspect
            })

    df = pd.DataFrame(post_rows)
    df = df[~df["data_suspect"]].copy()
    df["posted_at_dt"] = pd.to_datetime(df["posted_at"], utc=True)
    df = df.sort_values(by=["handle", "posted_at_dt"]).reset_index(drop=True)

    df["age_at_scrape_days"] = (SNAPSHOT_TIME - df["posted_at_dt"]).dt.total_seconds() / 86400.0

    def get_age_bucket(days):
        if days < 14: return "7-14"
        elif days < 30: return "14-30"
        elif days < 90: return "30-90"
        else: return "90+"
    df["age_bucket"] = df["age_at_scrape_days"].apply(get_age_bucket)

    df["post_order_idx"] = df.groupby("handle").cumcount()
    creator_mean_order = df.groupby("handle")["post_order_idx"].transform("mean")
    df["post_order_centered"] = df["post_order_idx"] - creator_mean_order

    def get_bucket(f):
        if f < 10000: return "under 10K"
        elif f <= 100000: return "10K-100K"
        elif f <= 1000000: return "100K-1M"
        else: return "over 1M"
    df["bucket"] = df["followers"].apply(get_bucket)

    df["caption_length"] = df["caption"].apply(lambda c: len(str(c)))
    df["hashtag_count"] = df["hashtags"].apply(lambda h: len(h) if isinstance(h, list) else 0)
    df["post_hour"] = df["posted_at_dt"].dt.hour
    df["post_weekday"] = df["posted_at_dt"].dt.weekday
    df["hour_sin"] = np.sin(2 * np.pi * df["post_hour"] / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * df["post_hour"] / 24.0)

    m_dummies = pd.get_dummies(df["media_type"], prefix="media")
    for col in ["media_image", "media_reel", "media_video", "media_carousel"]:
        if col not in m_dummies.columns: m_dummies[col] = 0
    df = pd.concat([df, m_dummies[["media_image", "media_reel", "media_video", "media_carousel"]]], axis=1)

    creator_mean_log = df.groupby("handle")["log_er"].transform("mean")
    df["centered_log_er"] = df["log_er"] - creator_mean_log

    prev_means, prev_stds, prev3_means, n_priors, days_since = [], [], [], [], []
    for h, grp in df.groupby("handle"):
        logs = grp["log_er"].values
        times = grp["posted_at_dt"].values
        for i in range(len(logs)):
            if i == 0:
                prev_means.append(np.nan); prev_stds.append(np.nan); prev3_means.append(np.nan)
                n_priors.append(0); days_since.append(np.nan)
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

print("Script template ready")
