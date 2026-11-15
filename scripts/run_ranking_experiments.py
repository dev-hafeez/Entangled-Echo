import os
import json
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, Any, List, Tuple
from PIL import Image

import torch
from transformers import AutoImageProcessor, AutoModelForImageClassification
from sentence_transformers import SentenceTransformer
from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge
import lightgbm as lgb
from scipy.stats import spearmanr

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_CLEAN_V2 = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean-v2")
MODEL_ARTIFACTS_DIR = os.path.join(STORAGE_DIR, "model-artifacts")
MODELS_JSON = os.path.join(STORAGE_DIR, "models.json")
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports")

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
        if not pf.endswith(".json"):
            continue
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

            # Check thumbnail on disk
            thumb_path = os.path.join(STORAGE_DIR, "post-media", h, sc, "0.jpg")
            has_thumb = os.path.exists(thumb_path)

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
                "data_suspect": is_suspect,
                "has_thumb": has_thumb,
                "thumb_path": thumb_path if has_thumb else None
            })

    df = pd.DataFrame(post_rows)
    df["posted_at_dt"] = pd.to_datetime(df["posted_at"], utc=True)
    df = df.sort_values(by=["handle", "posted_at_dt"]).reset_index(drop=True)

    # Basic features
    df["post_hour"] = df["posted_at_dt"].dt.hour
    df["post_weekday"] = df["posted_at_dt"].dt.weekday
    df["hour_sin"] = np.sin(2 * np.pi * df["post_hour"] / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * df["post_hour"] / 24.0)
    df["caption_length"] = df["caption"].apply(lambda c: len(str(c)))
    df["hashtag_count"] = df["hashtags"].apply(lambda h: len(h) if isinstance(h, list) else 0)

    # Media type dummies
    m_dummies = pd.get_dummies(df["media_type"], prefix="media")
    for col in ["media_image", "media_reel", "media_video", "media_carousel"]:
        if col not in m_dummies.columns:
            m_dummies[col] = 0
    df = pd.concat([df, m_dummies[["media_image", "media_reel", "media_video", "media_carousel"]]], axis=1)

    return df

def compute_per_creator_spearman(df: pd.DataFrame, pred_col: str, actual_col: str = "log_er") -> Dict[str, float]:
    corrs = {}
    for h, grp in df.groupby("handle"):
        if len(grp) >= 3:
            yt = grp[actual_col].values
            yp = grp[pred_col].values
            if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                c, _ = spearmanr(yt, yp)
                if not np.isnan(c):
                    corrs[h] = float(c)
    return corrs

def bootstrap_ladder_ci(corrs_dict: Dict[str, float], n_boot: int = 1000) -> Tuple[float, Tuple[float, float]]:
    eligible = list(corrs_dict.keys())
    means = []
    np.random.seed(42)
    for _ in range(n_boot):
        sample_h = np.random.choice(eligible, size=len(eligible), replace=True)
        means.append(np.mean([corrs_dict[h] for h in sample_h]))
    mean_val = float(np.mean(list(corrs_dict.values())))
    ci = (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))
    return mean_val, ci

def bootstrap_paired_delta_ci(corrs_prev: Dict[str, float], corrs_next: Dict[str, float], n_boot: int = 1000) -> Tuple[float, Tuple[float, float]]:
    common_h = [h for h in corrs_next.keys() if h in corrs_prev]
    deltas = {h: corrs_next[h] - corrs_prev[h] for h in common_h}
    means = []
    np.random.seed(42)
    for _ in range(n_boot):
        sample_h = np.random.choice(common_h, size=len(common_h), replace=True)
        means.append(np.mean([deltas[h] for h in sample_h]))
    mean_delta = float(np.mean(list(deltas.values())))
    ci = (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))
    return mean_delta, ci

def run_ladder():
    print("Loading clean-v2 data...")
    df_all = load_data()
    # Filter to posts that have thumbnails and not data_suspect, so all ladder steps evaluate on the exact same dataset
    df = df_all[(df_all["has_thumb"]) & (~df_all["data_suspect"])].copy().reset_index(drop=True)
    n_posts = len(df)
    n_creators = df["handle"].nunique()
    print(f"Ranking Ladder Dataset: {n_posts} posts across {n_creators} creators (100% thumbnail coverage on this set).")

    # Precompute Caption Embeddings (SentenceTransformer MiniLM)
    print("Computing caption embeddings (all-MiniLM-L6-v2, 384 dims)...")
    text_model = SentenceTransformer("all-MiniLM-L6-v2")
    captions = df["caption"].fillna("").tolist()
    text_embeds = text_model.encode(captions, show_progress_bar=False, batch_size=64)

    # Precompute Thumbnail Image Embeddings (MobileNetV2 Vision Backbone)
    print("Computing thumbnail vision embeddings (MobileNetV2, 112 dims)...")
    vision_model_dir = os.path.join(STORAGE_DIR, "models", "mobilenet_v2_0.35_96")
    processor = AutoImageProcessor.from_pretrained(vision_model_dir)
    vision_model = AutoModelForImageClassification.from_pretrained(vision_model_dir)
    vision_model.eval()

    image_embeds = []
    for _, row in df.iterrows():
        try:
            img = Image.open(row["thumb_path"]).convert("RGB")
            inputs = processor(images=img, return_tensors="pt")
            with torch.no_grad():
                outputs = vision_model(**inputs, output_hidden_states=True)
                emb = outputs.hidden_states[-1].mean(dim=[2, 3]).squeeze(0).numpy()
        except:
            emb = np.zeros(112, dtype=np.float32)
        image_embeds.append(emb)
    image_embeds = np.array(image_embeds, dtype=np.float32)

    # GroupKFold by creator
    gkf = GroupKFold(n_splits=5)
    groups = df["handle"].values

    # Step (a): Media type only
    feat_a = ["media_image", "media_reel", "media_video", "media_carousel"]
    # Step (b): + hour sin/cos and weekday
    feat_b = feat_a + ["hour_sin", "hour_cos", "post_weekday"]
    # Step (c): + caption length and hashtag count
    feat_c = feat_b + ["caption_length", "hashtag_count"]

    # Target: log(ER) minus creator's mean log(ER) computed ON TRAINING-FOLD ROWS ONLY
    pred_cols = ["pred_a", "pred_b", "pred_c", "pred_d", "pred_e"]
    for c in pred_cols:
        df[c] = np.nan

    for fold, (train_idx, val_idx) in enumerate(gkf.split(df, df["log_er"], groups)):
        train_df = df.iloc[train_idx]
        val_df = df.iloc[val_idx]

        # Creator mean log(ER) strictly on training-fold rows
        train_creator_means = train_df.groupby("handle")["log_er"].mean().to_dict()
        global_train_mean = float(train_df["log_er"].mean())

        # Target deviation strictly from training fold creator mean
        y_train = train_df["log_er"].values - train_df["handle"].map(train_creator_means).values

        # Model A
        m_a = Ridge(alpha=10.0, random_state=42 + fold)
        m_a.fit(train_df[feat_a], y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_a")] = m_a.predict(val_df[feat_a])

        # Model B
        m_b = Ridge(alpha=10.0, random_state=42 + fold)
        m_b.fit(train_df[feat_b], y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_b")] = m_b.predict(val_df[feat_b])

        # Model C
        m_c = Ridge(alpha=10.0, random_state=42 + fold)
        m_c.fit(train_df[feat_c], y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_c")] = m_c.predict(val_df[feat_c])

        # Step (d): Caption PCA fit in training folds only (8 components)
        pca_text = PCA(n_components=8, random_state=42)
        train_text_pca = pca_text.fit_transform(text_embeds[train_idx])
        val_text_pca = pca_text.transform(text_embeds[val_idx])

        X_train_d = np.hstack([train_df[feat_c].values, train_text_pca])
        X_val_d = np.hstack([val_df[feat_c].values, val_text_pca])

        m_d = Ridge(alpha=10.0, random_state=42 + fold)
        m_d.fit(X_train_d, y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_d")] = m_d.predict(X_val_d)

        # Step (e): Thumbnail Image PCA fit in training folds only (8 components)
        pca_img = PCA(n_components=8, random_state=42)
        train_img_pca = pca_img.fit_transform(image_embeds[train_idx])
        val_img_pca = pca_img.transform(image_embeds[val_idx])

        X_train_e = np.hstack([X_train_d, train_img_pca])
        X_val_e = np.hstack([X_val_d, val_img_pca])

        m_e = Ridge(alpha=10.0, random_state=42 + fold)
        m_e.fit(X_train_e, y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_e")] = m_e.predict(X_val_e)

    # Evaluate ladder steps
    corrs_a = compute_per_creator_spearman(df, "pred_a", "log_er")
    corrs_b = compute_per_creator_spearman(df, "pred_b", "log_er")
    corrs_c = compute_per_creator_spearman(df, "pred_c", "log_er")
    corrs_d = compute_per_creator_spearman(df, "pred_d", "log_er")
    corrs_e = compute_per_creator_spearman(df, "pred_e", "log_er")

    mean_a, ci_a = bootstrap_ladder_ci(corrs_a)
    mean_b, ci_b = bootstrap_ladder_ci(corrs_b)
    mean_c, ci_c = bootstrap_ladder_ci(corrs_c)
    mean_d, ci_d = bootstrap_ladder_ci(corrs_d)
    mean_e, ci_e = bootstrap_ladder_ci(corrs_e)

    # Paired deltas over previous step
    d_ba, ci_ba = bootstrap_paired_delta_ci(corrs_a, corrs_b)
    d_cb, ci_cb = bootstrap_paired_delta_ci(corrs_b, corrs_c)
    d_dc, ci_dc = bootstrap_paired_delta_ci(corrs_c, corrs_d)
    d_ed, ci_ed = bootstrap_paired_delta_ci(corrs_d, corrs_e)

    # Shuffled floor for Step A
    shuff_means = []
    np.random.seed(42)
    for _ in range(20):
        shuff_c = []
        for h, grp in df.groupby("handle"):
            if len(grp) >= 3:
                yt = grp["log_er"].values
                yp = np.random.permutation(grp["pred_a"].values)
                if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                    c, _ = spearmanr(yt, yp)
                    if not np.isnan(c):
                        shuff_c.append(float(c))
        if shuff_c:
            shuff_means.append(np.mean(shuff_c))
    shuff_floor_95 = float(np.percentile(shuff_means, 95))

    print("\n--- 1. RANKING-FEATURE LADDER RESULTS ---")
    print(f"Shuffled-Within-Creator Floor (95th%): {shuff_floor_95:+.4f}")
    print(f"(a) Media Type Only         : Spearman = {mean_a:+.4f} [95% CI: {ci_a[0]:+.4f}, {ci_a[1]:+.4f}]")
    print(f"(b) + Timing (Hour, Weekday): Spearman = {mean_b:+.4f} [95% CI: {ci_b[0]:+.4f}, {ci_b[1]:+.4f}] | Paired Delta vs (a) = {d_ba:+.4f} [{ci_ba[0]:+.4f}, {ci_ba[1]:+.4f}] -> Keep? {ci_ba[0] > 0}")
    print(f"(c) + Caption Len, Hashtags : Spearman = {mean_c:+.4f} [95% CI: {ci_c[0]:+.4f}, {ci_c[1]:+.4f}] | Paired Delta vs (b) = {d_cb:+.4f} [{ci_cb[0]:+.4f}, {ci_cb[1]:+.4f}] -> Keep? {ci_cb[0] > 0}")
    print(f"(d) + Caption PCA (8-dim)   : Spearman = {mean_d:+.4f} [95% CI: {ci_d[0]:+.4f}, {ci_d[1]:+.4f}] | Paired Delta vs (c) = {d_dc:+.4f} [{ci_dc[0]:+.4f}, {ci_dc[1]:+.4f}] -> Keep? {ci_dc[0] > 0}")
    print(f"(e) + Thumbnail PCA (8-dim) : Spearman = {mean_e:+.4f} [95% CI: {ci_e[0]:+.4f}, {ci_e[1]:+.4f}] | Paired Delta vs (d) = {d_ed:+.4f} [{ci_ed[0]:+.4f}, {ci_ed[1]:+.4f}] -> Keep? {ci_ed[0] > 0}")

    ladder_summary = {
        "shuff_floor_95": shuff_floor_95,
        "step_a": {"name": "Media Type Only", "spearman": mean_a, "ci": ci_a, "delta_ci": None, "keep": True},
        "step_b": {"name": "+ Timing (Hour, Weekday)", "spearman": mean_b, "ci": ci_b, "delta": d_ba, "delta_ci": ci_ba, "keep": bool(ci_ba[0] > 0)},
        "step_c": {"name": "+ Caption Length & Hashtag Count", "spearman": mean_c, "ci": ci_c, "delta": d_cb, "delta_ci": ci_cb, "keep": bool(ci_cb[0] > 0)},
        "step_d": {"name": "+ Caption Embedding PCA (8-dim)", "spearman": mean_d, "ci": ci_d, "delta": d_dc, "delta_ci": ci_dc, "keep": bool(ci_dc[0] > 0)},
        "step_e": {"name": "+ Thumbnail Image PCA (8-dim)", "spearman": mean_e, "ci": ci_e, "delta": d_ed, "delta_ci": ci_ed, "keep": bool(ci_ed[0] > 0)},
    }

    return df_all, df, ladder_summary

if __name__ == "__main__":
    run_ladder()
