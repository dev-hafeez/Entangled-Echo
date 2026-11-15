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
            l = p.get("likesCount")
            c = p.get("commentsCount")
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
                "handle": h,
                "shortcode": sc,
                "followers": followers,
                "likes": l,
                "comments": c,
                "log_er": log_er,
                "posted_at": ts,
                "caption": cap,
                "hashtags": p.get("hashtags") or [],
                "media_type": p.get("mediaType") or p.get("media_type") or "image",
                "data_suspect": is_suspect,
                "has_thumb": has_thumb
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
        if col not in m_dummies.columns:
            m_dummies[col] = 0
    df = pd.concat([df, m_dummies[["media_image", "media_reel", "media_video", "media_carousel"]]], axis=1)

    # 4-hour block dummies
    b_dummies = pd.get_dummies(df["hour_block"], prefix="hblock")
    for b in range(6):
        col = f"hblock_{b}"
        if col not in b_dummies.columns:
            b_dummies[col] = 0
    df = pd.concat([df, b_dummies[[f"hblock_{b}" for b in range(6)]]], axis=1)

    # Trailing history calculation
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

def bootstrap_ci(corrs_dict: Dict[str, float], n_boot: int = 1000) -> Tuple[float, Tuple[float, float]]:
    eligible = list(corrs_dict.keys())
    means = []
    np.random.seed(42)
    for _ in range(n_boot):
        sample_h = np.random.choice(eligible, size=len(eligible), replace=True)
        means.append(np.mean([corrs_dict[h] for h in sample_h]))
    mean_val = float(np.mean(list(corrs_dict.values())))
    ci = (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))
    return mean_val, ci

def bootstrap_paired_delta_ci(corrs_base: Dict[str, float], corrs_cand: Dict[str, float], n_boot: int = 1000) -> Tuple[float, Tuple[float, float]]:
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
    print("Loading data and precomputed embeddings...")
    df = load_data()
    n_posts = len(df)
    n_creators = df["handle"].nunique()
    print(f"Dataset: {n_posts} posts across {n_creators} creators.")

    caption_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "caption_minilm_embeddings.npy"))
    thumb_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "thumbnail_mobilenet_embeddings.npy"))
    assert len(caption_embeds) == n_posts
    assert len(thumb_embeds) == n_posts

    # Subset of posts with thumbnails for thumbnail comparison
    has_thumb_idx = df["has_thumb"].values

    # Setup 5-fold CV GroupKFold
    gkf = GroupKFold(n_splits=5)
    groups = df["handle"].values

    # Features for deployable models
    media_feats = ["media_image", "media_reel", "media_video", "media_carousel"]
    len_hash_feats = ["caption_length", "hashtag_count"]

    # ----------------------------------------------------
    # 2. CORRECTED LADDER (DEPLOYABLE FEATURES ONLY)
    # (a) media only
    # (b) a + length/hashtags
    # (c) a + caption PCA (<=8, fold-fit)
    # (d) a + length/hashtags + caption PCA
    # ----------------------------------------------------
    pred_cols_deploy = ["pred_a", "pred_b", "pred_c", "pred_d", "pred_e_thumb", "pred_d_plus_thumb"]
    for col in pred_cols_deploy:
        df[col] = np.nan

    # Also for timing experiments:
    # (i) hour sin/cos
    # (ii) circular distance to creator training-fold median posting hour
    # (iii) weekend flag
    # (iv) 4-hour blocks
    # (v) post gap relative to creator's training-fold median gap
    timing_pred_cols = [
        "pred_time_sin_cos", "pred_time_circ_dist", "pred_time_weekend", "pred_time_blocks", "pred_time_gap_ratio",
        "pred_lgb_time_sin_cos", "pred_lgb_time_circ_dist", "pred_lgb_time_weekend", "pred_lgb_time_blocks", "pred_lgb_time_gap_ratio"
    ]
    for col in timing_pred_cols:
        df[col] = np.nan

    print("\nRunning 5-fold CV for Deployable Ranking Ladder and Timing Experiments...")
    for fold, (train_idx, val_idx) in enumerate(gkf.split(df, groups=groups)):
        train_df = df.iloc[train_idx]
        val_df = df.iloc[val_idx]

        # Target: creator-centered log_er on training fold only
        train_creator_means = train_df.groupby("handle")["log_er"].mean().to_dict()
        y_train = train_df["log_er"].values - train_df["handle"].map(train_creator_means).values

        # PCA fit in training folds only
        pca_text = PCA(n_components=8, random_state=42)
        train_text_pca = pca_text.fit_transform(caption_embeds[train_idx])
        val_text_pca = pca_text.transform(caption_embeds[val_idx])

        pca_img = PCA(n_components=8, random_state=42)
        train_img_pca = pca_img.fit_transform(thumb_embeds[train_idx])
        val_img_pca = pca_img.transform(thumb_embeds[val_idx])

        # Model (a): Media only
        ma = Ridge(alpha=10.0, random_state=42 + fold)
        ma.fit(train_df[media_feats], y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_a")] = ma.predict(val_df[media_feats])

        # Model (b): a + length/hashtags
        feats_b = media_feats + len_hash_feats
        mb = Ridge(alpha=10.0, random_state=42 + fold)
        mb.fit(train_df[feats_b], y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_b")] = mb.predict(val_df[feats_b])

        # Model (c): a + caption PCA
        X_train_c = np.hstack([train_df[media_feats].values, train_text_pca])
        X_val_c = np.hstack([val_df[media_feats].values, val_text_pca])
        mc = Ridge(alpha=10.0, random_state=42 + fold)
        mc.fit(X_train_c, y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_c")] = mc.predict(X_val_c)

        # Model (d): a + length/hashtags + caption PCA
        X_train_d = np.hstack([train_df[feats_b].values, train_text_pca])
        X_val_d = np.hstack([val_df[feats_b].values, val_text_pca])
        md = Ridge(alpha=10.0, random_state=42 + fold)
        md.fit(X_train_d, y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_d")] = md.predict(X_val_d)

        # 4. Optional Thumbnail Image PCA:
        # e_thumb: media + thumb PCA
        X_train_e = np.hstack([train_df[media_feats].values, train_img_pca])
        X_val_e = np.hstack([val_df[media_feats].values, val_img_pca])
        me = Ridge(alpha=10.0, random_state=42 + fold)
        me.fit(X_train_e, y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_e_thumb")] = me.predict(X_val_e)

        # d + thumb: full combo
        X_train_de = np.hstack([X_train_d, train_img_pca])
        X_val_de = np.hstack([X_val_d, val_img_pca])
        mde = Ridge(alpha=10.0, random_state=42 + fold)
        mde.fit(X_train_de, y_train)
        df.iloc[val_idx, df.columns.get_loc("pred_d_plus_thumb")] = mde.predict(X_val_de)

        # ----------------------------------------------------
        # 3. TIMING EXPERIMENTS (EACH ADDED TO MEDIA-ONLY)
        # Compute training-fold creator medians for timing
        # ----------------------------------------------------
        # (ii) Creator median posting hour (circular median)
        creator_median_hours = train_df.groupby("handle")["post_hour"].median().to_dict()
        global_median_hour = float(train_df["post_hour"].median())

        def calc_circ_dist(series_hours, series_handles):
            dist = []
            for h_val, handle in zip(series_hours, series_handles):
                med_h = creator_median_hours.get(handle, global_median_hour)
                d = abs(h_val - med_h)
                d_circ = min(d, 24 - d)
                dist.append(d_circ)
            return np.array(dist, dtype=float)

        train_circ = calc_circ_dist(train_df["post_hour"], train_df["handle"])
        val_circ = calc_circ_dist(val_df["post_hour"], val_df["handle"])

        # (v) Creator median gap (days)
        creator_median_gaps = train_df.groupby("handle")["days_since_prev"].median().to_dict()
        global_median_gap = float(train_df["days_since_prev"].median())

        def calc_gap_ratio(series_gaps, series_handles):
            ratios = []
            for g_val, handle in zip(series_gaps, series_handles):
                med_g = creator_median_gaps.get(handle, global_median_gap)
                if np.isnan(g_val) or np.isnan(med_g) or med_g <= 0:
                    ratios.append(1.0)
                else:
                    ratios.append(min(g_val / med_g, 10.0))
            return np.array(ratios, dtype=float)

        train_gap_ratio = calc_gap_ratio(train_df["days_since_prev"], train_df["handle"])
        val_gap_ratio = calc_gap_ratio(val_df["days_since_prev"], val_df["handle"])

        timing_variants = [
            ("time_sin_cos", ["hour_sin", "hour_cos"]),
            ("time_circ_dist", ["circ_dist"]),
            ("time_weekend", ["is_weekend"]),
            ("time_blocks", [f"hblock_{b}" for b in range(6)]),
            ("time_gap_ratio", ["gap_ratio"])
        ]

        # Build training and validation feature frames
        train_df_timing = train_df.copy()
        train_df_timing["circ_dist"] = train_circ
        train_df_timing["gap_ratio"] = train_gap_ratio

        val_df_timing = val_df.copy()
        val_df_timing["circ_dist"] = val_circ
        val_df_timing["gap_ratio"] = val_gap_ratio

        for tag, f_time in timing_variants:
            feats = media_feats + f_time
            # Ridge
            m_tr = Ridge(alpha=10.0, random_state=42 + fold)
            m_tr.fit(train_df_timing[feats], y_train)
            df.iloc[val_idx, df.columns.get_loc(f"pred_{tag}")] = m_tr.predict(val_df_timing[feats])

            # Small regularized LightGBM (min_child_samples >= 50)
            train_lgb_data = lgb.Dataset(train_df_timing[feats], label=y_train)
            lgb_params = {
                "objective": "regression",
                "metric": "l2",
                "learning_rate": 0.05,
                "num_leaves": 7,
                "min_child_samples": 50,
                "reg_alpha": 2.0,
                "reg_lambda": 2.0,
                "verbose": -1,
                "seed": 42 + fold
            }
            m_lgb = lgb.train(lgb_params, train_lgb_data, num_boost_round=40)
            df.iloc[val_idx, df.columns.get_loc(f"pred_lgb_{tag}")] = m_lgb.predict(val_df_timing[feats])

    # ----------------------------------------------------
    # EVALUATION & METRICS EXTRACTION
    # ----------------------------------------------------
    print("\nComputing Within-Creator Spearman for all models...")
    corrs_a = compute_per_creator_spearman(df, "pred_a")
    corrs_b = compute_per_creator_spearman(df, "pred_b")
    corrs_c = compute_per_creator_spearman(df, "pred_c")
    corrs_d = compute_per_creator_spearman(df, "pred_d")

    mean_a, ci_a = bootstrap_ci(corrs_a)
    mean_b, ci_b = bootstrap_ci(corrs_b)
    mean_c, ci_c = bootstrap_ci(corrs_c)
    mean_d, ci_d = bootstrap_ci(corrs_d)

    # Paired deltas DIRECTLY vs (a)
    d_ba, ci_ba = bootstrap_paired_delta_ci(corrs_a, corrs_b)
    d_ca, ci_ca = bootstrap_paired_delta_ci(corrs_a, corrs_c)
    d_da, ci_da = bootstrap_paired_delta_ci(corrs_a, corrs_d)

    # Shuffled floor for Step A
    shuff_means = []
    np.random.seed(42)
    for _ in range(20):
        s_c = []
        for h, grp in df.groupby("handle"):
            if len(grp) >= 3:
                yt = grp["log_er"].values
                yp = np.random.permutation(grp["pred_a"].values)
                if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                    c, _ = spearmanr(yt, yp)
                    if not np.isnan(c): s_c.append(float(c))
        if s_c: shuff_means.append(np.mean(s_c))
    shuff_floor_95 = float(np.percentile(shuff_means, 95))

    print("\n=======================================================")
    print("2. CORRECTED DEPLOYABLE LADDER (PAIRED VS MEDIA-ONLY)")
    print("=======================================================")
    print(f"Shuffled-Within-Creator Floor (95th%): {shuff_floor_95:+.4f}")
    print(f"(a) Media Only                  : Spearman = {mean_a:+.4f} [{ci_a[0]:+.4f}, {ci_a[1]:+.4f}]")
    print(f"(b) Media + Length/Hashtags     : Spearman = {mean_b:+.4f} [{ci_b[0]:+.4f}, {ci_b[1]:+.4f}] | Paired Delta vs (a) = {d_ba:+.4f} [{ci_ba[0]:+.4f}, {ci_ba[1]:+.4f}] -> Beats (a)? {ci_ba[0] > 0}")
    print(f"(c) Media + Caption PCA (8-dim) : Spearman = {mean_c:+.4f} [{ci_c[0]:+.4f}, {ci_c[1]:+.4f}] | Paired Delta vs (a) = {d_ca:+.4f} [{ci_ca[0]:+.4f}, {ci_ca[1]:+.4f}] -> Beats (a)? {ci_ca[0] > 0}")
    print(f"(d) Media + Len/Hash + Capt PCA : Spearman = {mean_d:+.4f} [{ci_d[0]:+.4f}, {ci_d[1]:+.4f}] | Paired Delta vs (a) = {d_da:+.4f} [{ci_da[0]:+.4f}, {ci_da[1]:+.4f}] -> Beats (a)? {ci_da[0] > 0}")

    # ----------------------------------------------------
    # 3. TIMING EXPERIMENT RESULTS
    # ----------------------------------------------------
    print("\n=======================================================")
    print("3. TIMING EXPERIMENTS (PAIRED DELTA VS MEDIA-ONLY)")
    print("=======================================================")
    timing_results = []
    for tag, label in [
        ("time_sin_cos", "(i) Hour Sin/Cos"),
        ("time_circ_dist", "(ii) Rel Hour to Creator Median (Circ Dist)"),
        ("time_weekend", "(iii) Weekend Flag"),
        ("time_blocks", "(iv) 4-Hour Blocks"),
        ("time_gap_ratio", "(v) Post Gap Rel to Median")
    ]:
        # Ridge
        c_r = compute_per_creator_spearman(df, f"pred_{tag}")
        mr, cir = bootstrap_ci(c_r)
        dr, c_dr = bootstrap_paired_delta_ci(corrs_a, c_r)

        # LightGBM
        c_l = compute_per_creator_spearman(df, f"pred_lgb_{tag}")
        ml, cil = bootstrap_ci(c_l)
        dl, c_dl = bootstrap_paired_delta_ci(corrs_a, c_l)

        timing_results.append({
            "feature": label,
            "ridge_spearman": mr, "ridge_ci": cir, "ridge_delta": dr, "ridge_delta_ci": c_dr,
            "lgb_spearman": ml, "lgb_ci": cil, "lgb_delta": dl, "lgb_delta_ci": c_dl
        })
        print(f"{label}:")
        print(f"  Ridge:    Spearman = {mr:+.4f} [{cir[0]:+.4f}, {cir[1]:+.4f}] | Delta vs (a) = {dr:+.4f} [{c_dr[0]:+.4f}, {c_dr[1]:+.4f}]")
        print(f"  LightGBM: Spearman = {ml:+.4f} [{cil[0]:+.4f}, {cil[1]:+.4f}] | Delta vs (a) = {dl:+.4f} [{c_dl[0]:+.4f}, {c_dl[1]:+.4f}]")

    # ----------------------------------------------------
    # 4. THUMBNAIL IMAGE PCA OPTIONAL GROUP
    # ----------------------------------------------------
    print("\n=======================================================")
    print("4. THUMBNAIL IMAGE PCA (EVALUATED ON THUMBNAIL SUBSET)")
    print("=======================================================")
    # Evaluate strictly on posts where thumbnail exists
    df_thumb = df[df["has_thumb"]].copy().reset_index(drop=True)
    corrs_a_thumb = compute_per_creator_spearman(df_thumb, "pred_a")
    corrs_e_thumb = compute_per_creator_spearman(df_thumb, "pred_e_thumb")
    corrs_d_thumb = compute_per_creator_spearman(df_thumb, "pred_d")
    corrs_de_thumb = compute_per_creator_spearman(df_thumb, "pred_d_plus_thumb")

    m_at, ci_at = bootstrap_ci(corrs_a_thumb)
    m_et, ci_et = bootstrap_ci(corrs_e_thumb)
    m_dt, ci_dt = bootstrap_ci(corrs_d_thumb)
    m_det, ci_det = bootstrap_ci(corrs_de_thumb)

    d_ea, ci_ea = bootstrap_paired_delta_ci(corrs_a_thumb, corrs_e_thumb)
    d_ed, ci_ed = bootstrap_paired_delta_ci(corrs_d_thumb, corrs_de_thumb)

    print(f"Media Only (on thumb subset)          : Spearman = {m_at:+.4f} [{ci_at[0]:+.4f}, {ci_at[1]:+.4f}]")
    print(f"Media + Thumbnail PCA                 : Spearman = {m_et:+.4f} [{ci_et[0]:+.4f}, {ci_et[1]:+.4f}] | Paired Delta vs Media = {d_ea:+.4f} [{ci_ea[0]:+.4f}, {ci_ea[1]:+.4f}] -> Beats Media? {ci_ea[0] > 0}")
    print(f"Best Deployable (d)                   : Spearman = {m_dt:+.4f} [{ci_dt[0]:+.4f}, {ci_dt[1]:+.4f}]")
    print(f"Best Deployable (d) + Thumbnail PCA   : Spearman = {m_det:+.4f} [{ci_det[0]:+.4f}, {ci_det[1]:+.4f}] | Paired Delta vs (d)     = {d_ed:+.4f} [{ci_ed[0]:+.4f}, {ci_ed[1]:+.4f}] -> Beats (d)? {ci_ed[0] > 0}")

    # ----------------------------------------------------
    # 5. DECISION RULE & FORMAT EFFECTS
    # ----------------------------------------------------
    print("\n=======================================================")
    print("5. DECISION RULE & FORMAT EFFECTS TABLE")
    print("=======================================================")
    # Calculate format effects per bucket and media type
    creator_means_all = df.groupby("handle")["log_er"].mean().to_dict()
    df["centered_log_er"] = df["log_er"] - df["handle"].map(creator_means_all)

    def get_bucket(f):
        if f < 10000: return "under 10K"
        elif f <= 100000: return "10K-100K"
        elif f <= 1000000: return "100K-1M"
        else: return "over 1M"
    df["bucket"] = df["followers"].apply(get_bucket)

    format_table = []
    for b in ["under 10K", "10K-100K", "100K-1M", "over 1M"]:
        sub_b = df[df["bucket"] == b]
        for mt in ["carousel", "image", "video", "reel"]:
            sub_m = sub_b[sub_b["media_type"] == mt]
            if len(sub_m) == 0: continue
            # Mean of creator means
            c_vals = sub_m.groupby("handle")["centered_log_er"].mean().values
            boot_m = []
            np.random.seed(42)
            for _ in range(1000):
                sample = np.random.choice(c_vals, size=len(c_vals), replace=True)
                boot_m.append(np.mean(sample))
            mv = float(np.mean(c_vals))
            ci = (float(np.percentile(boot_m, 2.5)), float(np.percentile(boot_m, 97.5)))
            format_table.append({
                "bucket": b, "media_type": mt, "creators": sub_m["handle"].nunique(),
                "posts": len(sub_m), "mean_lift": mv, "ci": ci,
                "validated": b in ["100K-1M", "over 1M"]
            })
            print(f"Bucket {b:<10} | {mt:<10}: lift = {mv:+.4f} [{ci[0]:+.4f}, {ci[1]:+.4f}] (Creators: {sub_m['handle'].nunique()}, Posts: {len(sub_m)}) -> Valid: {b in ['100K-1M', 'over 1M']}")

    # ----------------------------------------------------
    # 6. LEVEL MODEL ATTRIBUTION (PERMUTATION IMPORTANCE)
    # ----------------------------------------------------
    print("\n=======================================================")
    print("6. LEVEL MODEL ATTRIBUTION (PERMUTATION IMPORTANCE)")
    print("=======================================================")
    # Evaluate LightGBM deviation model on df_eval (posts with n_priors >= 1)
    df_eval = df[df["n_priors"] >= 1].copy().reset_index(drop=True)
    features_full = [
        "media_image", "media_reel", "media_video", "media_carousel",
        "hour_sin", "hour_cos", "post_weekday",
        "caption_length", "hashtag_count",
        "prev_10_std", "prev_3_mean", "n_priors", "days_since_prev"
    ]
    features_hist_only = ["prev_10_std", "prev_3_mean", "n_priors", "days_since_prev"]

    feature_groups = {
        "trailing_history": ["prev_10_std", "prev_3_mean", "n_priors", "days_since_prev"],
        "media_type": ["media_image", "media_reel", "media_video", "media_carousel"],
        "caption_length_and_timing": ["hour_sin", "hour_cos", "post_weekday", "caption_length"],
        "hashtags": ["hashtag_count"]
    }

    df_eval["pred_full_lgb"] = np.nan
    df_eval["pred_hist_lgb"] = np.nan

    # Fit models in 5-fold CV
    gkf_eval = GroupKFold(n_splits=5)
    models_full = []
    val_indices_list = []

    for fold, (train_idx, val_idx) in enumerate(gkf_eval.split(df_eval, groups=df_eval["handle"])):
        train_sub = df_eval.iloc[train_idx]
        val_sub = df_eval.iloc[val_idx]

        y_dev_train = train_sub["log_er"].values - train_sub["prev_10_mean"].values
        p1, p99 = np.percentile(y_dev_train, [1, 99])
        y_dev_train_win = np.clip(y_dev_train, p1, p99)

        # Full LGBM
        tr_data = lgb.Dataset(train_sub[features_full], label=y_dev_train_win)
        params = {"objective": "regression", "metric": "mae", "learning_rate": 0.05, "num_leaves": 15, "min_data_in_leaf": 20, "reg_alpha": 1.0, "reg_lambda": 1.0, "verbose": -1, "seed": 42 + fold}
        gbm = lgb.train(params, tr_data, num_boost_round=100)
        df_eval.iloc[val_idx, df_eval.columns.get_loc("pred_full_lgb")] = val_sub["prev_10_mean"].values + gbm.predict(val_sub[features_full])
        models_full.append((gbm, val_idx))

        # History-only LGBM
        tr_data_hist = lgb.Dataset(train_sub[features_hist_only], label=y_dev_train_win)
        gbm_h = lgb.train(params, tr_data_hist, num_boost_round=100)
        df_eval.iloc[val_idx, df_eval.columns.get_loc("pred_hist_lgb")] = val_sub["prev_10_mean"].values + gbm_h.predict(val_sub[features_hist_only])

    # Base MAE per creator for full model and history-only model
    mae_full_c, mae_hist_c = {}, {}
    for h, grp in df_eval.groupby("handle"):
        mae_full_c[h] = mean_absolute_error(grp["log_er"], grp["pred_full_lgb"])
        mae_hist_c[h] = mean_absolute_error(grp["log_er"], grp["pred_hist_lgb"])

    m_full, ci_full = bootstrap_ci(mae_full_c)
    m_hist, ci_hist = bootstrap_ci(mae_hist_c)
    d_fh, ci_fh = bootstrap_paired_delta_ci(mae_hist_c, mae_full_c)

    print(f"History-Only Model MAE : {m_hist:.4f} [{ci_hist[0]:.4f}, {ci_hist[1]:.4f}]")
    print(f"Full Model MAE         : {m_full:.4f} [{ci_full[0]:.4f}, {ci_full[1]:.4f}]")
    print(f"Paired Delta (Full - History-Only): {d_fh:.4f} [{ci_fh[0]:.4f}, {ci_fh[1]:.4f}] -> Does Content Add Value? {ci_fh[1] < 0}")

    # Permutation importance by feature group
    perm_results = {}
    base_mae = mean_absolute_error(df_eval["log_er"], df_eval["pred_full_lgb"])
    np.random.seed(42)
    for grp_name, grp_feats in feature_groups.items():
        # Permute within validation sets across repeats
        perm_maes = []
        for rep in range(10):
            df_eval_perm = df_eval.copy()
            preds_perm = []
            for gbm, val_idx in models_full:
                val_sub_perm = df_eval.iloc[val_idx].copy()
                # Permute group features together
                shuff_idx = np.random.permutation(len(val_sub_perm))
                for f in grp_feats:
                    val_sub_perm[f] = val_sub_perm[f].values[shuff_idx]
                p_dev = gbm.predict(val_sub_perm[features_full])
                preds_perm.extend(val_sub_perm["prev_10_mean"].values + p_dev)
            perm_maes.append(mean_absolute_error(df_eval["log_er"], preds_perm))
        mean_perm_mae = float(np.mean(perm_maes))
        importance = mean_perm_mae - base_mae
        perm_results[grp_name] = importance
        print(f"Group: {grp_name:<25} | Permuted MAE: {mean_perm_mae:.4f} | Delta MAE: +{importance:.4f}")

    # ----------------------------------------------------
    # 7. SMALL CREATORS POWER & EXPLANATION
    # ----------------------------------------------------
    print("\n=======================================================")
    print("7. SMALL CREATORS AUDIT & POWER ANALYSIS")
    print("=======================================================")
    under100k = df[df["followers"] < 100000]
    u_creators = under100k["handle"].nunique()
    u_posts = len(under100k)
    post_counts = under100k.groupby("handle")["shortcode"].count()

    print(f"Total Under-100K Creators: {u_creators}")
    print(f"Total Under-100K Posts: {u_posts} (Mean = {post_counts.mean():.2f}, Median = {post_counts.median()}, Min = {post_counts.min()}, Max = {post_counts.max()})")
    print(f"Distribution of posts per creator in Under-100K:")
    print(f"  1 post : {(post_counts == 1).sum()} creators")
    print(f"  2 posts: {(post_counts == 2).sum()} creators")
    print(f"  3+ posts (eligible for within-creator correlation): {(post_counts >= 3).sum()} creators")

    # Check variation in media types for eligible 3+ creators
    eligible_under = under100k[under100k["handle"].isin(post_counts[post_counts >= 3].index)]
    varied_creators = 0
    for h, grp in eligible_under.groupby("handle"):
        if grp["media_type"].nunique() > 1:
            varied_creators += 1
    print(f"Eligible creators with multiple distinct media types: {varied_creators} / {(post_counts >= 3).sum()}")

    return {
        "ladder": {
            "mean_a": mean_a, "ci_a": ci_a,
            "mean_b": mean_b, "ci_b": ci_b, "d_ba": d_ba, "ci_ba": ci_ba,
            "mean_c": mean_c, "ci_c": ci_c, "d_ca": d_ca, "ci_ca": ci_ca,
            "mean_d": mean_d, "ci_d": ci_d, "d_da": d_da, "ci_da": ci_da,
            "shuff_floor": shuff_floor_95
        },
        "timing": timing_results,
        "thumb": {
            "m_at": m_at, "ci_at": ci_at, "m_et": m_et, "ci_et": ci_et, "d_ea": d_ea, "ci_ea": ci_ea,
            "m_dt": m_dt, "ci_dt": ci_dt, "m_det": m_det, "ci_det": ci_det, "d_ed": d_ed, "ci_ed": ci_ed
        },
        "level_attr": {
            "m_full": m_full, "ci_full": ci_full, "m_hist": m_hist, "ci_hist": ci_hist, "d_fh": d_fh, "ci_fh": ci_fh,
            "perm_results": perm_results
        },
        "small_creators": {
            "total_creators": u_creators, "total_posts": u_posts, "c_1": int((post_counts == 1).sum()),
            "c_2": int((post_counts == 2).sum()), "c_3plus": int((post_counts >= 3).sum()),
            "varied_media": varied_creators
        },
        "format_table": format_table
    }

if __name__ == "__main__":
    results = main()
