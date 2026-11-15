import os
import json
import joblib
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Tuple
from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge
import lightgbm as lgb
from scipy.stats import spearmanr

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_CLEAN_V2 = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean-v2")
EMBEDDINGS_DIR = os.path.join(STORAGE_DIR, "embeddings")
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports")

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

    # Follower bucket
    def get_bucket(f):
        if f < 10000: return "under 10K"
        elif f <= 100000: return "10K-100K"
        elif f <= 1000000: return "100K-1M"
        else: return "over 1M"
    df["bucket"] = df["followers"].apply(get_bucket)

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

def bootstrap_ci_over_creators(corrs_dict: Dict[str, float], n_boot: int = 1000) -> Tuple[float, Tuple[float, float]]:
    creators = list(corrs_dict.keys())
    means = []
    np.random.seed(42)
    for _ in range(n_boot):
        sample_h = np.random.choice(creators, size=len(creators), replace=True)
        means.append(np.mean([corrs_dict[h] for h in sample_h]))
    mean_val = float(np.mean(list(corrs_dict.values())))
    ci = (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))
    return mean_val, ci

def bootstrap_paired_delta_ci_over_creators(corrs_base: Dict[str, float], corrs_cand: Dict[str, float], n_boot: int = 1000) -> Tuple[float, Tuple[float, float]]:
    common_h = [h for h in corrs_cand.keys() if h in corrs_base]
    deltas = {h: corrs_cand[h] - corrs_base[h] for h in common_h}
    means = []
    np.random.seed(42)
    for _ in range(n_boot):
        sample_h = np.random.choice(common_h, size=len(common_h), replace=True)
        means.append(np.mean([deltas[h] for h in sample_h]))
    mean_delta = float(np.mean(list(deltas.values())))
    ci = (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))
    return mean_delta, ci

def main():
    print("Loading data and embeddings...")
    df = load_data()
    caption_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "caption_minilm_embeddings.npy"))
    thumb_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "thumbnail_mobilenet_embeddings.npy"))

    # Identify Fixed Creator Set: creators with >= 3 posts and >= 2 media types
    creator_stats = df.groupby("handle").agg(
        n_posts=("shortcode", "count"),
        n_types=("media_type", "nunique")
    )
    fixed_creators = sorted(creator_stats[(creator_stats["n_posts"] >= 3) & (creator_stats["n_types"] >= 2)].index.tolist())
    fixed_creators_set = set(fixed_creators)

    df_fixed = df[df["handle"].isin(fixed_creators_set)].copy().reset_index(drop=True)
    fixed_indices = df_fixed.index.tolist()
    # Map to original indices
    orig_indices = df[df["handle"].isin(fixed_creators_set)].index.values
    caption_embeds_fixed = caption_embeds[orig_indices]
    thumb_embeds_fixed = thumb_embeds[orig_indices]

    n_fixed_c = len(fixed_creators)
    n_fixed_p = len(df_fixed)
    print(f"Fixed Creator Set: {n_fixed_c} creators, {n_fixed_p} posts.")

    # ----------------------------------------------------
    # ITEM 2: DEPLOYABLE LADDER ON FIXED CREATOR SET
    # ----------------------------------------------------
    gkf = GroupKFold(n_splits=5)
    groups = df_fixed["handle"].values
    media_feats = ["media_image", "media_reel", "media_video", "media_carousel"]
    len_hash_feats = ["caption_length", "hashtag_count"]

    cols_deploy = ["pred_a", "pred_b", "pred_c", "pred_d", "pred_thumb_on_fixed", "pred_d_plus_thumb_fixed"]
    for c in cols_deploy: df_fixed[c] = np.nan

    # Also timing columns on fixed set
    timing_tags = ["sin_cos", "circ_dist", "weekend", "blocks", "gap_ratio"]
    for t in timing_tags:
        df_fixed[f"pred_ridge_{t}"] = np.nan
        df_fixed[f"pred_lgb_{t}"] = np.nan

    for fold, (train_idx, val_idx) in enumerate(gkf.split(df_fixed, groups=groups)):
        train_df = df_fixed.iloc[train_idx]
        val_df = df_fixed.iloc[val_idx]

        train_c_means = train_df.groupby("handle")["log_er"].mean().to_dict()
        y_train = train_df["log_er"].values - train_df["handle"].map(train_c_means).values

        pca_text = PCA(n_components=8, random_state=42)
        train_text_pca = pca_text.fit_transform(caption_embeds_fixed[train_idx])
        val_text_pca = pca_text.transform(caption_embeds_fixed[val_idx])

        pca_img = PCA(n_components=8, random_state=42)
        train_img_pca = pca_img.fit_transform(thumb_embeds_fixed[train_idx])
        val_img_pca = pca_img.transform(thumb_embeds_fixed[val_idx])

        # Model a: media only
        ma = Ridge(alpha=10.0, random_state=42+fold).fit(train_df[media_feats], y_train)
        df_fixed.iloc[val_idx, df_fixed.columns.get_loc("pred_a")] = ma.predict(val_df[media_feats])

        # Model b: a + length/hashtags
        mb = Ridge(alpha=10.0, random_state=42+fold).fit(train_df[media_feats + len_hash_feats], y_train)
        df_fixed.iloc[val_idx, df_fixed.columns.get_loc("pred_b")] = mb.predict(val_df[media_feats + len_hash_feats])

        # Model c: a + caption PCA
        mc = Ridge(alpha=10.0, random_state=42+fold).fit(np.hstack([train_df[media_feats].values, train_text_pca]), y_train)
        df_fixed.iloc[val_idx, df_fixed.columns.get_loc("pred_c")] = mc.predict(np.hstack([val_df[media_feats].values, val_text_pca]))

        # Model d: a + length/hashtags + caption PCA
        md = Ridge(alpha=10.0, random_state=42+fold).fit(np.hstack([train_df[media_feats + len_hash_feats].values, train_text_pca]), y_train)
        df_fixed.iloc[val_idx, df_fixed.columns.get_loc("pred_d")] = md.predict(np.hstack([val_df[media_feats + len_hash_feats].values, val_text_pca]))

        # Thumbnail models on fixed set
        # Thumb alone with media
        m_thumb = Ridge(alpha=10.0, random_state=42+fold).fit(np.hstack([train_df[media_feats].values, train_img_pca]), y_train)
        df_fixed.iloc[val_idx, df_fixed.columns.get_loc("pred_thumb_on_fixed")] = m_thumb.predict(np.hstack([val_df[media_feats].values, val_img_pca]))

        # d + thumb
        m_d_thumb = Ridge(alpha=10.0, random_state=42+fold).fit(np.hstack([train_df[media_feats + len_hash_feats].values, train_text_pca, train_img_pca]), y_train)
        df_fixed.iloc[val_idx, df_fixed.columns.get_loc("pred_d_plus_thumb_fixed")] = m_d_thumb.predict(np.hstack([val_df[media_feats + len_hash_feats].values, val_text_pca, val_img_pca]))

        # Timing variants on fixed set
        # (ii) Circular median hour
        creator_median_hours = train_df.groupby("handle")["post_hour"].median().to_dict()
        global_med_h = float(train_df["post_hour"].median())
        def circ_d(hours, handles):
            return np.array([min(abs(h - creator_median_hours.get(hand, global_med_h)), 24 - abs(h - creator_median_hours.get(hand, global_med_h))) for h, hand in zip(hours, handles)])

        train_circ = circ_d(train_df["post_hour"], train_df["handle"])
        val_circ = circ_d(val_df["post_hour"], val_df["handle"])

        # (v) Relative gap
        creator_median_gaps = train_df.groupby("handle")["days_since_prev"].median().to_dict()
        global_med_g = float(train_df["days_since_prev"].median())
        def gap_r(gaps, handles):
            res = []
            for g, hand in zip(gaps, handles):
                mg = creator_median_gaps.get(hand, global_med_g)
                if np.isnan(g) or np.isnan(mg) or mg <= 0: res.append(1.0)
                else: res.append(min(g / mg, 10.0))
            return np.array(res)

        train_gap_r = gap_r(train_df["days_since_prev"], train_df["handle"])
        val_gap_r = gap_r(val_df["days_since_prev"], val_df["handle"])

        train_df_t = train_df.copy(); train_df_t["circ_dist"] = train_circ; train_df_t["gap_ratio"] = train_gap_r
        val_df_t = val_df.copy(); val_df_t["circ_dist"] = val_circ; val_df_t["gap_ratio"] = val_gap_r

        variants = [
            ("sin_cos", ["hour_sin", "hour_cos"]),
            ("circ_dist", ["circ_dist"]),
            ("weekend", ["is_weekend"]),
            ("blocks", [f"hblock_{b}" for b in range(6)]),
            ("gap_ratio", ["gap_ratio"])
        ]
        for tag, f_t in variants:
            feats = media_feats + f_t
            # Ridge
            m_tr = Ridge(alpha=10.0, random_state=42+fold).fit(train_df_t[feats], y_train)
            df_fixed.iloc[val_idx, df_fixed.columns.get_loc(f"pred_ridge_{tag}")] = m_tr.predict(val_df_t[feats])
            # LightGBM
            tr_lgb = lgb.Dataset(train_df_t[feats], label=y_train)
            params = {"objective": "regression", "metric": "l2", "learning_rate": 0.05, "num_leaves": 7, "min_child_samples": 50, "reg_alpha": 2.0, "reg_lambda": 2.0, "verbose": -1, "seed": 42+fold}
            m_lgb = lgb.train(params, tr_lgb, num_boost_round=40)
            df_fixed.iloc[val_idx, df_fixed.columns.get_loc(f"pred_lgb_{tag}")] = m_lgb.predict(val_df_t[feats])

    # Evaluate within-creator correlations on fixed set
    def eval_fixed(pred_col):
        c = {}
        for h, grp in df_fixed.groupby("handle"):
            yt = grp["log_er"].values
            yp = grp[pred_col].values
            if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                val, _ = spearmanr(yt, yp)
                if not np.isnan(val): c[h] = float(val)
        return c

    ca = eval_fixed("pred_a")
    cb = eval_fixed("pred_b")
    cc = eval_fixed("pred_c")
    cd = eval_fixed("pred_d")

    assert len(ca) == n_fixed_c
    assert len(cb) == n_fixed_c
    assert len(cc) == n_fixed_c
    assert len(cd) == n_fixed_c

    ma, ci_a = bootstrap_ci_over_creators(ca)
    mb, ci_b = bootstrap_ci_over_creators(cb)
    mc, ci_c = bootstrap_ci_over_creators(cc)
    md, ci_d = bootstrap_ci_over_creators(cd)

    d_ba, ci_ba = bootstrap_paired_delta_ci_over_creators(ca, cb)
    d_ca, ci_ca = bootstrap_paired_delta_ci_over_creators(ca, cc)
    d_da, ci_da = bootstrap_paired_delta_ci_over_creators(ca, cd)

    # Shuffled floor for fixed set
    shuff_means = []
    np.random.seed(42)
    for _ in range(20):
        s_c = []
        for h, grp in df_fixed.groupby("handle"):
            yt = grp["log_er"].values
            yp = np.random.permutation(grp["pred_a"].values)
            if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                val, _ = spearmanr(yt, yp)
                if not np.isnan(val): s_c.append(float(val))
        if s_c: shuff_means.append(np.mean(s_c))
    shuff_floor_fixed_95 = float(np.percentile(shuff_means, 95))

    print("\n--- ITEM 2: DEPLOYABLE LADDER ON FIXED CREATOR SET ---")
    print(f"Fixed Creators: {n_fixed_c} (100% defined on all models) | Posts: {n_fixed_p}")
    print(f"Shuffled-Within-Creator Floor (95th%): {shuff_floor_fixed_95:+.4f}")
    print(f"(a) Media Only                  : Spearman = {ma:+.4f} [{ci_a[0]:+.4f}, {ci_a[1]:+.4f}]")
    print(f"(b) Media + Length/Hashtags     : Spearman = {mb:+.4f} [{ci_b[0]:+.4f}, {ci_b[1]:+.4f}] | Paired Delta vs (a) = {d_ba:+.4f} [{ci_ba[0]:+.4f}, {ci_ba[1]:+.4f}] -> Beats (a)? {ci_ba[0] > 0}")
    print(f"(c) Media + Caption PCA (8-dim) : Spearman = {mc:+.4f} [{ci_c[0]:+.4f}, {ci_c[1]:+.4f}] | Paired Delta vs (a) = {d_ca:+.4f} [{ci_ca[0]:+.4f}, {ci_ca[1]:+.4f}] -> Beats (a)? {ci_ca[0] > 0}")
    print(f"(d) Media + Len/Hash + Capt PCA : Spearman = {md:+.4f} [{ci_d[0]:+.4f}, {ci_d[1]:+.4f}] | Paired Delta vs (a) = {d_da:+.4f} [{ci_da[0]:+.4f}, {ci_da[1]:+.4f}] -> Beats (a)? {ci_da[0] > 0}")

    # ----------------------------------------------------
    # ITEM 3: CAPTION SIGNAL ISOLATED FROM FORMAT
    # Within each creator x media_type cell with >=3 posts
    # Target = log(ER) - training-fold cell mean
    # ----------------------------------------------------
    # Identify qualifying cells (handle, media_type) with >= 3 posts in df_fixed
    cell_counts = df_fixed.groupby(["handle", "media_type"])["shortcode"].count()
    qual_cells_idx = cell_counts[cell_counts >= 3].index.tolist()
    qual_cells_set = set(qual_cells_idx)

    df_cells = df_fixed[df_fixed.set_index(["handle", "media_type"]).index.isin(qual_cells_set)].copy().reset_index(drop=True)
    orig_cell_indices = df_fixed[df_fixed.set_index(["handle", "media_type"]).index.isin(qual_cells_set)].index.values
    caption_embeds_cells = caption_embeds_fixed[orig_cell_indices]

    n_cells = len(qual_cells_idx)
    n_creators_cells = df_cells["handle"].nunique()
    n_posts_cells = len(df_cells)
    print(f"\n--- ITEM 3: CAPTION SIGNAL ISOLATED FROM FORMAT ---")
    print(f"Qualifying Cells: {n_cells} cells across {n_creators_cells} creators | Total Posts: {n_posts_cells}")

    # 5-fold CV GroupKFold grouped by creator
    gkf_cell = GroupKFold(n_splits=5)
    groups_cell = df_cells["handle"].values

    for c in ["pred_cell_len_hash", "pred_cell_capt_pca", "pred_cell_both"]:
        df_cells[c] = np.nan

    for fold, (train_idx, val_idx) in enumerate(gkf_cell.split(df_cells, groups=groups_cell)):
        train_df = df_cells.iloc[train_idx]
        val_df = df_cells.iloc[val_idx]

        # Cell mean on training folds only
        train_cell_means = train_df.groupby(["handle", "media_type"])["log_er"].mean().to_dict()
        global_train_mean = float(train_df["log_er"].mean())

        # Training target: log_er - training cell mean
        y_train_cell = []
        for _, row in train_df.iterrows():
            m_val = train_cell_means.get((row["handle"], row["media_type"]), global_train_mean)
            y_train_cell.append(row["log_er"] - m_val)
        y_train_cell = np.array(y_train_cell, dtype=float)

        # PCA fit on training folds only
        pca_text_cell = PCA(n_components=8, random_state=42)
        train_pca = pca_text_cell.fit_transform(caption_embeds_cells[train_idx])
        val_pca = pca_text_cell.transform(caption_embeds_cells[val_idx])

        # Model 1: length + hashtags
        m1 = Ridge(alpha=10.0, random_state=42+fold).fit(train_df[len_hash_feats], y_train_cell)
        df_cells.iloc[val_idx, df_cells.columns.get_loc("pred_cell_len_hash")] = m1.predict(val_df[len_hash_feats])

        # Model 2: caption PCA
        m2 = Ridge(alpha=10.0, random_state=42+fold).fit(train_pca, y_train_cell)
        df_cells.iloc[val_idx, df_cells.columns.get_loc("pred_cell_capt_pca")] = m2.predict(val_pca)

        # Model 3: both
        X_tr3 = np.hstack([train_df[len_hash_feats].values, train_pca])
        X_va3 = np.hstack([val_df[len_hash_feats].values, val_pca])
        m3 = Ridge(alpha=10.0, random_state=42+fold).fit(X_tr3, y_train_cell)
        df_cells.iloc[val_idx, df_cells.columns.get_loc("pred_cell_both")] = m3.predict(X_va3)

    # Metric: Spearman within cells averaged over cells (also weighted by cell size)
    # Shuffled within cell floor
    shuff_cell_means = []
    np.random.seed(42)
    for _ in range(20):
        s_cell = []
        for (h, mt), grp in df_cells.groupby(["handle", "media_type"]):
            yt = grp["log_er"].values
            yp = np.random.permutation(grp["pred_cell_both"].values)
            if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                val, _ = spearmanr(yt, yp)
                if not np.isnan(val): s_cell.append(float(val))
        if s_cell: shuff_cell_means.append(np.mean(s_cell))
    shuff_floor_cell_95 = float(np.percentile(shuff_cell_means, 95))

    def eval_cells(pred_col):
        cell_corrs = {}
        cell_weights = {}
        creator_cells = {}
        for (h, mt), grp in df_cells.groupby(["handle", "media_type"]):
            yt = grp["log_er"].values
            yp = grp[pred_col].values
            if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                val, _ = spearmanr(yt, yp)
                if not np.isnan(val):
                    cell_corrs[(h, mt)] = float(val)
                    cell_weights[(h, mt)] = len(grp)
                    if h not in creator_cells: creator_cells[h] = []
                    creator_cells[h].append((h, mt))
        return cell_corrs, cell_weights, creator_cells

    c_cells_1, w1, cc1 = eval_cells("pred_cell_len_hash")
    c_cells_2, w2, cc2 = eval_cells("pred_cell_capt_pca")
    c_cells_3, w3, cc3 = eval_cells("pred_cell_both")

    # Bootstrap resampled over CREATORS
    def boot_cell_ci(cell_corrs, cell_weights, creator_cells, weighted=False, n_boot=1000):
        creators = list(creator_cells.keys())
        means = []
        np.random.seed(42)
        for _ in range(n_boot):
            s_c = np.random.choice(creators, size=len(creators), replace=True)
            sampled_corrs = []
            sampled_weights = []
            for c in s_c:
                for k in creator_cells[c]:
                    if k in cell_corrs:
                        sampled_corrs.append(cell_corrs[k])
                        sampled_weights.append(cell_weights[k])
            if weighted:
                means.append(np.average(sampled_corrs, weights=sampled_weights))
            else:
                means.append(np.mean(sampled_corrs))
        if weighted:
            vals = [cell_corrs[k] for k in cell_corrs]
            wgts = [cell_weights[k] for k in cell_corrs]
            mean_v = float(np.average(vals, weights=wgts))
        else:
            mean_v = float(np.mean(list(cell_corrs.values())))
        ci = (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))
        return mean_v, ci

    m1_u, ci1_u = boot_cell_ci(c_cells_1, w1, cc1, weighted=False)
    m1_w, ci1_w = boot_cell_ci(c_cells_1, w1, cc1, weighted=True)
    m2_u, ci2_u = boot_cell_ci(c_cells_2, w2, cc2, weighted=False)
    m2_w, ci2_w = boot_cell_ci(c_cells_2, w2, cc2, weighted=True)
    m3_u, ci3_u = boot_cell_ci(c_cells_3, w3, cc3, weighted=False)
    m3_w, ci3_w = boot_cell_ci(c_cells_3, w3, cc3, weighted=True)

    print(f"Shuffled-Within-Cell Floor (95th%): {shuff_floor_cell_95:+.4f}")
    print(f"1) Length + Hashtags alone : Unweighted Spearman = {m1_u:+.4f} [{ci1_u[0]:+.4f}, {ci1_u[1]:+.4f}] | Weighted = {m1_w:+.4f} [{ci1_w[0]:+.4f}, {ci1_w[1]:+.4f}]")
    print(f"2) Caption PCA (8-dim) alone: Unweighted Spearman = {m2_u:+.4f} [{ci2_u[0]:+.4f}, {ci2_u[1]:+.4f}] | Weighted = {m2_w:+.4f} [{ci2_w[0]:+.4f}, {ci2_w[1]:+.4f}]")
    print(f"3) Both (Len/Hash + Capt PCA): Unweighted Spearman = {m3_u:+.4f} [{ci3_u[0]:+.4f}, {ci3_u[1]:+.4f}] | Weighted = {m3_w:+.4f} [{ci3_w[0]:+.4f}, {ci3_w[1]:+.4f}]")

    # ----------------------------------------------------
    # ITEM 4: TIMING ON FIXED SET AND CELL-CENTERED TASK
    # ----------------------------------------------------
    print("\n--- ITEM 4: TIMING EXPERIMENTS REDONE ---")
    print("A) On Fixed Creator Set (Task 2, compared paired vs Media-Only ca):")
    timing_fixed_res = {}
    for tag, label in [
        ("sin_cos", "Hour Sin/Cos"),
        ("circ_dist", "Rel Hour to Median (Circ Dist)"),
        ("weekend", "Weekend Flag"),
        ("blocks", "4-Hour Blocks"),
        ("gap_ratio", "Post Gap Rel to Median")
    ]:
        cr = eval_fixed(f"pred_ridge_{tag}")
        mr, cir = bootstrap_ci_over_creators(cr)
        dr, c_dr = bootstrap_paired_delta_ci_over_creators(ca, cr)

        cl = eval_fixed(f"pred_lgb_{tag}")
        ml, cil = bootstrap_ci_over_creators(cl)
        dl, c_dl = bootstrap_paired_delta_ci_over_creators(ca, cl)
        timing_fixed_res[tag] = {
            "label": label, "mr": mr, "cir": cir, "dr": dr, "c_dr": c_dr,
            "ml": ml, "cil": cil, "dl": dl, "c_dl": c_dl
        }
        print(f"  {label:<30}:")
        print(f"    Ridge:    Spearman = {mr:+.4f} [{cir[0]:+.4f}, {cir[1]:+.4f}] | Delta vs (a) = {dr:+.4f} [{c_dr[0]:+.4f}, {c_dr[1]:+.4f}]")
        print(f"    LightGBM: Spearman = {ml:+.4f} [{cil[0]:+.4f}, {cil[1]:+.4f}] | Delta vs (a) = {dl:+.4f} [{c_dl[0]:+.4f}, {c_dl[1]:+.4f}]")

    # Timing on Cell-Centered Task (Item 3)
    # Add timing features to cell-centered prediction (compared against no-timing base m3_u)
    for t in timing_tags: df_cells[f"pred_cell_timing_{t}"] = np.nan

    for fold, (train_idx, val_idx) in enumerate(gkf_cell.split(df_cells, groups=groups_cell)):
        train_df = df_cells.iloc[train_idx]
        val_df = df_cells.iloc[val_idx]

        train_cell_means = train_df.groupby(["handle", "media_type"])["log_er"].mean().to_dict()
        global_train_mean = float(train_df["log_er"].mean())

        y_train_cell = np.array([row["log_er"] - train_cell_means.get((row["handle"], row["media_type"]), global_train_mean) for _, row in train_df.iterrows()])

        pca_text_cell = PCA(n_components=8, random_state=42)
        train_pca = pca_text_cell.fit_transform(caption_embeds_cells[train_idx])
        val_pca = pca_text_cell.transform(caption_embeds_cells[val_idx])

        # Median hour and gap for cell df
        c_med_h = train_df.groupby("handle")["post_hour"].median().to_dict()
        g_med_h = float(train_df["post_hour"].median())
        train_circ = np.array([min(abs(h - c_med_h.get(hand, g_med_h)), 24 - abs(h - c_med_h.get(hand, g_med_h))) for h, hand in zip(train_df["post_hour"], train_df["handle"])])
        val_circ = np.array([min(abs(h - c_med_h.get(hand, g_med_h)), 24 - abs(h - c_med_h.get(hand, g_med_h))) for h, hand in zip(val_df["post_hour"], val_df["handle"])])

        c_med_g = train_df.groupby("handle")["days_since_prev"].median().to_dict()
        g_med_g = float(train_df["days_since_prev"].median())
        def c_gap_r(gaps, handles):
            return np.array([min(g / c_med_g.get(hand, g_med_g), 10.0) if not (np.isnan(g) or np.isnan(c_med_g.get(hand, g_med_g)) or c_med_g.get(hand, g_med_g) <= 0) else 1.0 for g, hand in zip(gaps, handles)])

        train_gap_r = c_gap_r(train_df["days_since_prev"], train_df["handle"])
        val_gap_r = c_gap_r(val_df["days_since_prev"], val_df["handle"])

        train_df_ct = train_df.copy(); train_df_ct["circ_dist"] = train_circ; train_df_ct["gap_ratio"] = train_gap_r
        val_df_ct = val_df.copy(); val_df_ct["circ_dist"] = val_circ; val_df_ct["gap_ratio"] = val_gap_r

        cell_timing_variants = [
            ("sin_cos", "Hour Sin/Cos", ["hour_sin", "hour_cos"]),
            ("circ_dist", "Rel Hour to Median (Circ Dist)", ["circ_dist"]),
            ("weekend", "Weekend Flag", ["is_weekend"]),
            ("blocks", "4-Hour Blocks", [f"hblock_{b}" for b in range(6)]),
            ("gap_ratio", "Post Gap Rel to Median", ["gap_ratio"])
        ]
        for tag, label, f_t in cell_timing_variants:
            X_tr = np.hstack([train_df_ct[len_hash_feats + f_t].values, train_pca])
            X_va = np.hstack([val_df_ct[len_hash_feats + f_t].values, val_pca])
            m = Ridge(alpha=10.0, random_state=42+fold).fit(X_tr, y_train_cell)
            df_cells.iloc[val_idx, df_cells.columns.get_loc(f"pred_cell_timing_{tag}")] = m.predict(X_va)

    print("\nB) On Cell-Centered Task (compared paired vs No-Timing Base m3):")
    timing_cell_res = {}
    for tag, label, f_t in cell_timing_variants:
        c_ct, w_ct, cc_ct = eval_cells(f"pred_cell_timing_{tag}")
        m_ct, ci_ct = boot_cell_ci(c_ct, w_ct, cc_ct, weighted=False)
        # Paired delta vs no timing m3 over common cells
        common_cells = [k for k in c_ct if k in c_cells_3]
        deltas = {k: c_ct[k] - c_cells_3[k] for k in common_cells}
        # Bootstrap delta over creators
        means_d = []
        creators_common = list(set([k[0] for k in common_cells]))
        np.random.seed(42)
        for _ in range(1000):
            s_c = np.random.choice(creators_common, size=len(creators_common), replace=True)
            s_d = [deltas[k] for c in s_c for k in common_cells if k[0] == c]
            means_d.append(np.mean(s_d))
        delta_m = float(np.mean(list(deltas.values())))
        ci_delta = (float(np.percentile(means_d, 2.5)), float(np.percentile(means_d, 97.5)))
        timing_cell_res[tag] = {"label": label, "spearman": m_ct, "ci": ci_ct, "delta": delta_m, "ci_delta": ci_delta}
        print(f"  {label:<30}: Spearman = {m_ct:+.4f} [{ci_ct[0]:+.4f}, {ci_ct[1]:+.4f}] | Delta vs No-Timing = {delta_m:+.4f} [{ci_delta[0]:+.4f}, {ci_delta[1]:+.4f}]")

    # ----------------------------------------------------
    # ITEM 5: THUMBNAIL GROUP ON FIXED SET & HOLM CORRECTION
    # ----------------------------------------------------
    print("\n--- ITEM 5: THUMBNAIL ON FIXED SET & HOLM CORRECTION ---")
    # Evaluate thumb on fixed set
    c_thumb = eval_fixed("pred_thumb_on_fixed")
    c_d_thumb = eval_fixed("pred_d_plus_thumb_fixed")

    m_thumb, ci_thumb = bootstrap_ci_over_creators(c_thumb)
    m_d_thumb, ci_d_thumb = bootstrap_ci_over_creators(c_d_thumb)

    d_thumb_vs_a, ci_thumb_vs_a = bootstrap_paired_delta_ci_over_creators(ca, c_thumb)
    d_dthumb_vs_d, ci_dthumb_vs_d = bootstrap_paired_delta_ci_over_creators(cd, c_d_thumb)

    print(f"Media + Thumbnail on Fixed Set     : Spearman = {m_thumb:+.4f} [{ci_thumb[0]:+.4f}, {ci_thumb[1]:+.4f}] | Delta vs Media = {d_thumb_vs_a:+.4f} [{ci_thumb_vs_a[0]:+.4f}, {ci_thumb_vs_a[1]:+.4f}]")
    print(f"Deployable (d) + Thumbnail on Fixed: Spearman = {m_d_thumb:+.4f} [{ci_d_thumb[0]:+.4f}, {ci_d_thumb[1]:+.4f}] | Delta vs (d)   = {d_dthumb_vs_d:+.4f} [{ci_dthumb_vs_d[0]:+.4f}, {ci_dthumb_vs_d[1]:+.4f}]")

    # Family of candidate comparisons tested against base in this ranking analysis:
    # 1. Model b vs a
    # 2. Model c vs a
    # 3. Model d vs a
    # 4. Media + Thumb vs a
    # 5. Model d + Thumb vs d
    # (Total = 5 primary content hypothesis comparisons)
    # Estimate two-tailed bootstrap p-values: 2 * min(P(delta <= 0), P(delta >= 0))
    def calc_boot_p(base_dict, cand_dict):
        common = [h for h in cand_dict if h in base_dict]
        deltas = {h: cand_dict[h] - base_dict[h] for h in common}
        means = []
        np.random.seed(42)
        for _ in range(5000):
            s_c = np.random.choice(common, size=len(common), replace=True)
            means.append(np.mean([deltas[h] for h in s_c]))
        means = np.array(means)
        p_val = 2.0 * min(np.mean(means <= 0), np.mean(means >= 0))
        return max(p_val, 1e-4)

    p_b = calc_boot_p(ca, cb)
    p_c = calc_boot_p(ca, cc)
    p_d = calc_boot_p(ca, cd)
    p_th_a = calc_boot_p(ca, c_thumb)
    p_d_th = calc_boot_p(cd, c_d_thumb)

    family_comparisons = [
        {"name": "Model (b) [Media + Length/Hashtags] vs (a) Media Only", "delta": d_ba, "ci": ci_ba, "p": p_b},
        {"name": "Model (c) [Media + Caption PCA] vs (a) Media Only", "delta": d_ca, "ci": ci_ca, "p": p_c},
        {"name": "Model (d) [Media + Len/Hash + Capt PCA] vs (a) Media Only", "delta": d_da, "ci": ci_da, "p": p_d},
        {"name": "Media + Thumbnail PCA vs (a) Media Only", "delta": d_thumb_vs_a, "ci": ci_thumb_vs_a, "p": p_th_a},
        {"name": "Model (d) + Thumbnail PCA vs (d) Deployable", "delta": d_dthumb_vs_d, "ci": ci_dthumb_vs_d, "p": p_d_th}
    ]

    # Apply Holm-Bonferroni correction (alpha = 0.05)
    family_comparisons.sort(key=lambda x: x["p"])
    m_tests = len(family_comparisons)
    print(f"\nHolm-Bonferroni Correction over {m_tests} Candidate Comparisons (Family alpha = 0.05):")
    for rank, comp in enumerate(family_comparisons):
        alpha_holm = 0.05 / (m_tests - rank)
        survives = comp["p"] < alpha_holm and comp["delta"] > 0
        comp["rank"] = rank + 1
        comp["alpha_holm"] = alpha_holm
        comp["survives"] = survives
        print(f"  Rank {rank+1}: {comp['name']:<55} | Delta = {comp['delta']:+.4f} [{comp['ci'][0]:+.4f}, {comp['ci'][1]:+.4f}] | p = {comp['p']:.4f} | Target alpha = {alpha_holm:.4f} -> Survives? {survives}")

    # ----------------------------------------------------
    # ITEM 6: LEVEL MODEL PERMUTATION IMPORTANCE REDONE
    # ----------------------------------------------------
    print("\n--- ITEM 6: LEVEL MODEL PERMUTATION IMPORTANCE REDONE ---")
    df_eval = df[df["n_priors"] >= 1].copy().reset_index(drop=True)
    features_full = [
        "media_image", "media_reel", "media_video", "media_carousel",
        "hour_sin", "hour_cos", "post_weekday",
        "caption_length", "hashtag_count",
        "prev_10_std", "prev_3_mean", "n_priors", "days_since_prev"
    ]
    feature_groups = {
        "trailing_history": ["prev_10_std", "prev_3_mean", "n_priors", "days_since_prev"],
        "media_type": ["media_image", "media_reel", "media_video", "media_carousel"],
        "caption_length_and_timing": ["hour_sin", "hour_cos", "post_weekday", "caption_length"],
        "hashtags": ["hashtag_count"]
    }

    df_eval["pred_full_lgb"] = np.nan
    gkf_eval = GroupKFold(n_splits=5)
    models_full = []

    for fold, (train_idx, val_idx) in enumerate(gkf_eval.split(df_eval, groups=df_eval["handle"])):
        train_sub = df_eval.iloc[train_idx]
        val_sub = df_eval.iloc[val_idx]
        y_dev_train = train_sub["log_er"].values - train_sub["prev_10_mean"].values
        p1, p99 = np.percentile(y_dev_train, [1, 99])
        y_dev_train_win = np.clip(y_dev_train, p1, p99)

        tr_data = lgb.Dataset(train_sub[features_full], label=y_dev_train_win)
        params = {"objective": "regression", "metric": "mae", "learning_rate": 0.05, "num_leaves": 15, "min_data_in_leaf": 20, "reg_alpha": 1.0, "reg_lambda": 1.0, "verbose": -1, "seed": 42+fold}
        gbm = lgb.train(params, tr_data, num_boost_round=100)
        df_eval.iloc[val_idx, df_eval.columns.get_loc("pred_full_lgb")] = val_sub["prev_10_mean"].values + gbm.predict(val_sub[features_full])
        models_full.append((gbm, val_idx))

    base_mae = mean_absolute_error(df_eval["log_er"], df_eval["pred_full_lgb"])
    print(f"Baseline Unpermuted Model MAE: {base_mae:.4f}")

    perm_importance_dict = {}
    np.random.seed(42)
    for grp_name, grp_feats in feature_groups.items():
        perm_maes = []
        for rep in range(10):
            preds_perm = np.zeros(len(df_eval))
            for gbm, val_idx in models_full:
                val_sub_perm = df_eval.iloc[val_idx].copy()
                shuff_idx = np.random.permutation(len(val_sub_perm))
                for f in grp_feats:
                    val_sub_perm[f] = val_sub_perm[f].values[shuff_idx]
                preds_perm[val_idx] = val_sub_perm["prev_10_mean"].values + gbm.predict(val_sub_perm[features_full])
            perm_maes.append(mean_absolute_error(df_eval["log_er"], preds_perm))
        mean_perm_mae = float(np.mean(perm_maes))
        importance = mean_perm_mae - base_mae
        perm_importance_dict[grp_name] = {"permuted_mae": mean_perm_mae, "delta_mae": importance}
        print(f"Group: {grp_name:<25} | Permuted MAE: {mean_perm_mae:.4f} | Permuted - Baseline MAE = +{importance:.4f}")

    # ----------------------------------------------------
    # ITEM 7: FORMAT EFFECTS ON MULTI-FORMAT CREATORS ONLY
    # ----------------------------------------------------
    print("\n--- ITEM 7: FORMAT EFFECTS ON MULTI-FORMAT CREATORS ONLY ---")
    # Using df_fixed (creators with >=3 posts and >=2 media types)
    # Creator centered log_er
    creator_means_fixed = df_fixed.groupby("handle")["log_er"].mean().to_dict()
    df_fixed["centered_log_er"] = df_fixed["log_er"] - df_fixed["handle"].map(creator_means_fixed)

    format_table_v3 = {}
    for b in ["under 10K", "10K-100K", "100K-1M", "over 1M"]:
        format_table_v3[b] = {}
        sub_b = df_fixed[df_fixed["bucket"] == b]
        for mt in ["carousel", "image", "video", "reel"]:
            sub_m = sub_b[sub_b["media_type"] == mt]
            if len(sub_m) == 0: continue
            c_vals = sub_m.groupby("handle")["centered_log_er"].mean().values
            boot_m = []
            np.random.seed(42)
            for _ in range(1000):
                s = np.random.choice(c_vals, size=len(c_vals), replace=True)
                boot_m.append(np.mean(s))
            mv = float(np.mean(c_vals))
            ci = [float(np.percentile(boot_m, 2.5)), float(np.percentile(boot_m, 97.5))]
            format_table_v3[b][mt] = {
                "mean_lift": round(mv, 4),
                "ci_95": [round(ci[0], 4), round(ci[1], 4)],
                "creators": int(sub_m["handle"].nunique()),
                "posts": int(len(sub_m)),
                "validated": b in ["100K-1M", "over 1M"]
            }
            print(f"Bucket {b:<10} | {mt:<10}: lift = {mv:+.4f} [{ci[0]:+.4f}, {ci[1]:+.4f}] (Creators: {sub_m['handle'].nunique()}, Posts: {len(sub_m)}) -> Valid: {b in ['100K-1M', 'over 1M']}")

    # Save to storage/format_effects.json
    with open(os.path.join(STORAGE_DIR, "format_effects.json"), "w") as f:
        json.dump(format_table_v3, f, indent=2)

    # ----------------------------------------------------
    # BENCHMARK B (POOLED OPTIMIZER SIMULATION):
    # For each creator with 8+ usable posts and 2+ formats,
    # hold out the last 3 posts as the candidate pool, pick K=1 with each method:
    # 1. Random pick (mean over 50 random selections)
    # 2. Greedy (highest candidate predicted score)
    # 3. Best-format heuristic (pick format with highest bucket mean lift)
    # 4. Actual posting order (first post in pool)
    # Compare against real creator-centered log(ER) of the picks
    # ----------------------------------------------------
    print("\n--- BENCHMARK B: POOLED CANDIDATE SELECTION EVALUATION ---")
    creator_post_counts = df_fixed.groupby("handle")["shortcode"].count()
    bench_creators = creator_post_counts[creator_post_counts >= 8].index.tolist()
    print(f"Qualifying creators for Benchmark B (>=8 posts, >=2 formats): {len(bench_creators)} creators")

    bench_rows = []
    # Best format heuristic lookup table
    best_format_per_bucket = {
        "over 1M": "carousel",
        "100K-1M": "carousel",
        "10K-100K": "image",
        "under 10K": "carousel"
    }

    for h in bench_creators:
        c_posts = df_fixed[df_fixed["handle"] == h].sort_values("posted_at_dt").reset_index(drop=True)
        # Hold out last 3 posts as candidate pool
        pool = c_posts.iloc[-3:].copy().reset_index(drop=True)
        # Actual posting order: post 0 in pool (first chronological)
        actual_val = pool.iloc[0]["centered_log_er"]

        # Random: expected value over the 3 posts
        random_val = pool["centered_log_er"].mean()

        # Best-format heuristic: pick post whose media_type matches best format, break ties randomly/first
        b_target = best_format_per_bucket[pool.iloc[0]["bucket"]]
        match_bf = pool[pool["media_type"] == b_target]
        if len(match_bf) > 0:
            best_format_val = match_bf["centered_log_er"].mean()
        else:
            best_format_val = pool["centered_log_er"].mean()

        # Greedy: highest predicted lift using Model d
        greedy_idx = pool["pred_d"].argmax()
        greedy_val = pool.iloc[greedy_idx]["centered_log_er"]

        bench_rows.append({
            "handle": h,
            "actual_val": actual_val,
            "random_val": random_val,
            "best_format_val": best_format_val,
            "greedy_val": greedy_val
        })

    df_bench = pd.DataFrame(bench_rows)
    print(f"Evaluated Benchmark B on {len(df_bench)} creators:")
    np.random.seed(42)
    def boot_mean(series, n_boot=1000):
        means = [np.mean(np.random.choice(series, size=len(series), replace=True)) for _ in range(n_boot)]
        return float(np.mean(series)), (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))

    m_act, ci_act = boot_mean(df_bench["actual_val"])
    m_rnd, ci_rnd = boot_mean(df_bench["random_val"])
    m_bf, ci_bf = boot_mean(df_bench["best_format_val"])
    m_grd, ci_grd = boot_mean(df_bench["greedy_val"])

    # Paired deltas vs Best-Format Heuristic
    d_grd_vs_bf, ci_grd_vs_bf = boot_mean(df_bench["greedy_val"] - df_bench["best_format_val"])
    d_grd_vs_rnd, ci_grd_vs_rnd = boot_mean(df_bench["greedy_val"] - df_bench["random_val"])
    d_bf_vs_rnd, ci_bf_vs_rnd = boot_mean(df_bench["best_format_val"] - df_bench["random_val"])

    print(f"1. Actual Posting Order      : Mean Lift = {m_act:+.4f} [{ci_act[0]:+.4f}, {ci_act[1]:+.4f}]")
    print(f"2. Random Selection Baseline : Mean Lift = {m_rnd:+.4f} [{ci_rnd[0]:+.4f}, {ci_rnd[1]:+.4f}]")
    print(f"3. Best-Format Heuristic     : Mean Lift = {m_bf:+.4f} [{ci_bf[0]:+.4f}, {ci_bf[1]:+.4f}] | Delta vs Random = {d_bf_vs_rnd:+.4f} [{ci_bf_vs_rnd[0]:+.4f}, {ci_bf_vs_rnd[1]:+.4f}]")
    print(f"4. Optimizer / Greedy (ML)   : Mean Lift = {m_grd:+.4f} [{ci_grd[0]:+.4f}, {ci_grd[1]:+.4f}] | Delta vs Best-Format = {d_grd_vs_bf:+.4f} [{ci_grd_vs_bf[0]:+.4f}, {ci_grd_vs_bf[1]:+.4f}]")

    return {
        "fixed_ladder": {"ma": ma, "ci_a": ci_a, "mb": mb, "ci_b": ci_b, "d_ba": d_ba, "ci_ba": ci_ba, "mc": mc, "ci_c": ci_c, "d_ca": d_ca, "ci_ca": ci_ca, "md": md, "ci_d": ci_d, "d_da": d_da, "ci_da": ci_da, "shuff_floor": shuff_floor_fixed_95},
        "cells": {"n_cells": n_cells, "n_creators": n_creators_cells, "n_posts": n_posts_cells, "shuff_floor": shuff_floor_cell_95, "m1_u": m1_u, "ci1_u": ci1_u, "m1_w": m1_w, "ci1_w": ci1_w, "m2_u": m2_u, "ci2_u": ci2_u, "m2_w": m2_w, "ci2_w": ci2_w, "m3_u": m3_u, "ci3_u": ci3_u, "m3_w": m3_w, "ci3_w": ci3_w},
        "timing_fixed": timing_fixed_res, "timing_cells": timing_cell_res,
        "thumb_fixed": {"m_thumb": m_thumb, "ci_thumb": ci_thumb, "d_thumb_vs_a": d_thumb_vs_a, "ci_thumb_vs_a": ci_thumb_vs_a, "m_d_thumb": m_d_thumb, "ci_d_thumb": ci_d_thumb, "d_dthumb_vs_d": d_dthumb_vs_d, "ci_dthumb_vs_d": ci_dthumb_vs_d},
        "holm": family_comparisons,
        "level_perm": {"base_mae": base_mae, "groups": perm_importance_dict},
        "format_effects_v3": format_table_v3,
        "benchmark_b": {"n_creators": len(df_bench), "m_act": m_act, "ci_act": ci_act, "m_rnd": m_rnd, "ci_rnd": ci_rnd, "m_bf": m_bf, "ci_bf": ci_bf, "m_grd": m_grd, "ci_grd": ci_grd, "d_grd_vs_bf": d_grd_vs_bf, "ci_grd_vs_bf": ci_grd_vs_bf, "d_bf_vs_rnd": d_bf_vs_rnd, "ci_bf_vs_rnd": ci_bf_vs_rnd}
    }

if __name__ == "__main__":
    main()
