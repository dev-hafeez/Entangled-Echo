import os
import json
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.model_selection import GroupKFold
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_CLEAN_V2 = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean-v2")
EMBEDDINGS_DIR = os.path.join(STORAGE_DIR, "embeddings")

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

            thumb_path = os.path.join(STORAGE_DIR, "post-media", h, sc, "0.jpg")
            has_thumb = os.path.exists(thumb_path)

            post_rows.append({
                "handle": h, "shortcode": sc, "followers": followers,
                "likes": l, "comments": c, "log_er": log_er, "posted_at": ts,
                "caption": cap, "hashtags": p.get("hashtags") or [],
                "media_type": p.get("mediaType") or p.get("media_type") or "image",
                "data_suspect": is_suspect, "has_thumb": has_thumb
            })

    df = pd.DataFrame(post_rows)
    df = df[~df["data_suspect"]].copy()
    df["posted_at_dt"] = pd.to_datetime(df["posted_at"], utc=True)
    df = df.sort_values(by=["handle", "posted_at_dt"]).reset_index(drop=True)

    # Basic features
    df["post_hour"] = df["posted_at_dt"].dt.hour
    df["post_weekday"] = df["posted_at_dt"].dt.weekday
    df["is_weekend"] = df["post_weekday"].isin([5, 6]).astype(int)
    df["hour_block"] = (df["post_hour"] // 4).astype(int)
    df["hour_sin"] = np.sin(2 * np.pi * df["post_hour"] / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * df["post_hour"] / 24.0)
    df["caption_length"] = df["caption"].apply(lambda c: len(str(c)))
    df["hashtag_count"] = df["hashtags"].apply(lambda h: len(h) if isinstance(h, list) else 0)

    # Media dummies
    m_dummies = pd.get_dummies(df["media_type"], prefix="media")
    for col in ["media_image", "media_reel", "media_video", "media_carousel"]:
        if col not in m_dummies.columns: m_dummies[col] = 0
    df = pd.concat([df, m_dummies[["media_image", "media_reel", "media_video", "media_carousel"]]], axis=1)

    # 4-hour blocks
    b_dummies = pd.get_dummies(df["hour_block"], prefix="hblock")
    for b in range(6):
        col = f"hblock_{b}"
        if col not in b_dummies.columns: b_dummies[col] = 0
    df = pd.concat([df, b_dummies[[f"hblock_{b}" for b in range(6)]]], axis=1)

    # Trailing history
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

print("Loading data...")
df = load_data()
print("Posts:", len(df), "Creators:", df["handle"].nunique())

# Check how many creators have defined correlations for each ladder step
caption_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "caption_minilm_embeddings.npy"))

gkf = GroupKFold(n_splits=5)
groups = df["handle"].values
media_feats = ["media_image", "media_reel", "media_video", "media_carousel"]
len_hash_feats = ["caption_length", "hashtag_count"]

for c in ["pred_a", "pred_b", "pred_c", "pred_d"]:
    df[c] = np.nan

for fold, (train_idx, val_idx) in enumerate(gkf.split(df, groups=groups)):
    train_df = df.iloc[train_idx]
    val_df = df.iloc[val_idx]
    train_creator_means = train_df.groupby("handle")["log_er"].mean().to_dict()
    y_train = train_df["log_er"].values - train_df["handle"].map(train_creator_means).values

    pca_text = PCA(n_components=8, random_state=42)
    train_text_pca = pca_text.fit_transform(caption_embeds[train_idx])
    val_text_pca = pca_text.transform(caption_embeds[val_idx])

    # a
    ma = Ridge(alpha=10.0, random_state=42+fold).fit(train_df[media_feats], y_train)
    df.iloc[val_idx, df.columns.get_loc("pred_a")] = ma.predict(val_df[media_feats])

    # b
    mb = Ridge(alpha=10.0, random_state=42+fold).fit(train_df[media_feats + len_hash_feats], y_train)
    df.iloc[val_idx, df.columns.get_loc("pred_b")] = mb.predict(val_df[media_feats + len_hash_feats])

    # c
    mc = Ridge(alpha=10.0, random_state=42+fold).fit(np.hstack([train_df[media_feats].values, train_text_pca]), y_train)
    df.iloc[val_idx, df.columns.get_loc("pred_c")] = mc.predict(np.hstack([val_df[media_feats].values, val_text_pca]))

    # d
    md = Ridge(alpha=10.0, random_state=42+fold).fit(np.hstack([train_df[media_feats + len_hash_feats].values, train_text_pca]), y_train)
    df.iloc[val_idx, df.columns.get_loc("pred_d")] = md.predict(np.hstack([val_df[media_feats + len_hash_feats].values, val_text_pca]))

def get_corrs(pred_col):
    corrs = {}
    for h, grp in df.groupby("handle"):
        if len(grp) >= 3:
            yt = grp["log_er"].values
            yp = grp[pred_col].values
            if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                c, _ = spearmanr(yt, yp)
                if not np.isnan(c): corrs[h] = float(c)
    return corrs

ca = get_corrs("pred_a")
cb = get_corrs("pred_b")
cc = get_corrs("pred_c")
cd = get_corrs("pred_d")

print("\n--- ITEM 1 RECONCILIATION ---")
for name, cdict in [("a (media only)", ca), ("b (media+len/hash)", cb), ("c (media+pca)", cc), ("d (media+len/hash+pca)", cd)]:
    print(f"Model {name}: {len(cdict)} creators with defined Spearman | Mean = {np.mean(list(cdict.values())):.4f}")

# Paired deltas over INTERSECTION
for name, cdict in [("b", cb), ("c", cc), ("d", cd)]:
    common = [h for h in cdict if h in ca]
    deltas = [cdict[h] - ca[h] for h in common]
    print(f"Paired Delta {name} vs a: Over {len(common)} common creators | Mean Delta = {np.mean(deltas):+.4f} | Diff of Reported Means = {np.mean(list(cdict.values())) - np.mean(list(ca.values())):+.4f}")

