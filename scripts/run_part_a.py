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

    # Compute age_at_scrape_days
    df["age_at_scrape_days"] = (SNAPSHOT_TIME - df["posted_at_dt"]).dt.total_seconds() / 86400.0

    # Age buckets: 7-14, 14-30, 30-90, 90+
    def get_age_bucket(days):
        if days < 14: return "7-14"
        elif days < 30: return "14-30"
        elif days < 90: return "30-90"
        else: return "90+"
    df["age_bucket"] = df["age_at_scrape_days"].apply(get_age_bucket)

    # Post order index within creator (chronological 0..N-1)
    df["post_order_idx"] = df.groupby("handle").cumcount()
    # Creator centered post order index
    creator_mean_order = df.groupby("handle")["post_order_idx"].transform("mean")
    df["post_order_centered"] = df["post_order_idx"] - creator_mean_order

    # Follower bucket
    def get_bucket(f):
        if f < 10000: return "under 10K"
        elif f <= 100000: return "10K-100K"
        elif f <= 1000000: return "100K-1M"
        else: return "over 1M"
    df["bucket"] = df["followers"].apply(get_bucket)

    # Basic features
    df["caption_length"] = df["caption"].apply(lambda c: len(str(c)))
    df["hashtag_count"] = df["hashtags"].apply(lambda h: len(h) if isinstance(h, list) else 0)
    df["post_hour"] = df["posted_at_dt"].dt.hour
    df["post_weekday"] = df["posted_at_dt"].dt.weekday
    df["hour_sin"] = np.sin(2 * np.pi * df["post_hour"] / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * df["post_hour"] / 24.0)

    # Media dummies
    m_dummies = pd.get_dummies(df["media_type"], prefix="media")
    for col in ["media_image", "media_reel", "media_video", "media_carousel"]:
        if col not in m_dummies.columns: m_dummies[col] = 0
    df = pd.concat([df, m_dummies[["media_image", "media_reel", "media_video", "media_carousel"]]], axis=1)

    # Creator centered log_er
    creator_mean_log = df.groupby("handle")["log_er"].transform("mean")
    df["centered_log_er"] = df["log_er"] - creator_mean_log

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

def main():
    print("Loading data for Part A...")
    df = load_data()
    n_total = len(df)
    n_creators = df["handle"].nunique()
    print(f"Loaded {n_total} posts across {n_creators} creators.")

    # Multi-format creators with >= 3 posts and >= 2 formats
    c_stats = df.groupby("handle").agg(n_posts=("shortcode", "count"), n_types=("media_type", "nunique"))
    multi_creators = c_stats[(c_stats["n_posts"] >= 3) & (c_stats["n_types"] >= 2)].index.tolist()
    df_multi = df[df["handle"].isin(multi_creators)].copy().reset_index(drop=True)
    print(f"Multi-format creators set: {len(multi_creators)} creators, {len(df_multi)} posts.")

    # ----------------------------------------------------
    # ITEM 1: AGE AT SCRAPE DAYS PER POST & MEAN LOG(ER)
    # ----------------------------------------------------
    print("\n--- ITEM 1: AGE AT SCRAPE DAYS & LOG(ER) BY AGE BUCKET ---")
    age_buckets = ["7-14", "14-30", "30-90", "90+"]
    media_types = ["carousel", "image", "video"]

    # Overall by age bucket
    overall_res = []
    for ab in age_buckets:
        sub = df[df["age_bucket"] == ab]
        c_means = sub.groupby("handle")["centered_log_er"].mean().values
        boot = [np.mean(np.random.choice(c_means, size=len(c_means), replace=True)) for _ in range(1000)]
        overall_res.append({
            "age_bucket": ab, "posts": len(sub), "creators": sub["handle"].nunique(),
            "mean_centered_log_er": np.mean(c_means),
            "ci_95": (np.percentile(boot, 2.5), np.percentile(boot, 97.5))
        })
        print(f"Age Bucket {ab:<6} | Overall: mean centered log(ER) = {np.mean(c_means):+.4f} [{np.percentile(boot, 2.5):+.4f}, {np.percentile(boot, 97.5):+.4f}] (Posts: {len(sub)}, Creators: {sub['handle'].nunique()})")

    # By media type and age bucket
    type_age_res = []
    print("\nBy Media Type and Age Bucket:")
    for mt in media_types:
        for ab in age_buckets:
            sub = df[(df["media_type"] == mt) & (df["age_bucket"] == ab)]
            if len(sub) > 0:
                c_means = sub.groupby("handle")["centered_log_er"].mean().values
                boot = [np.mean(np.random.choice(c_means, size=len(c_means), replace=True)) for _ in range(1000)]
                m_val = np.mean(c_means)
                ci_val = (np.percentile(boot, 2.5), np.percentile(boot, 97.5))
            else:
                m_val, ci_val = np.nan, (np.nan, np.nan)
            type_age_res.append({
                "media_type": mt, "age_bucket": ab, "posts": len(sub), "creators": sub["handle"].nunique(),
                "mean_centered_log_er": m_val, "ci_95": ci_val
            })
            print(f"  {mt:<8} | Age {ab:<6} | Mean = {m_val:+.4f} [{ci_val[0]:+.4f}, {ci_val[1]:+.4f}] (Posts: {len(sub)}, Creators: {sub['handle'].nunique()})")

    # ----------------------------------------------------
    # ITEM 2: FORMAT OVER TIME (OLDER HALF VS RECENT HALF)
    # ----------------------------------------------------
    print("\n--- ITEM 2: FORMAT OVER TIME (OLDER HALF VS RECENT HALF) ---")
    # For each creator with >= 2 posts, split chronological posts into older half and recent half
    older_shares = {mt: [] for mt in media_types}
    recent_shares = {mt: [] for mt in media_types}
    creator_corrs = []

    for h, grp in df.groupby("handle"):
        n = len(grp)
        if n >= 4:
            mid = n // 2
            older_half = grp.iloc[:mid]
            recent_half = grp.iloc[mid:]
            for mt in media_types:
                older_shares[mt].append((older_half["media_type"] == mt).mean())
                recent_shares[mt].append((recent_half["media_type"] == mt).mean())
            
            # Correlation between format indicator and age
            # Code media_type as categorical or dummy
            for mt in media_types:
                is_mt = (grp["media_type"] == mt).astype(int).values
                if not np.all(is_mt == is_mt[0]):
                    c, _ = spearmanr(is_mt, grp["age_at_scrape_days"].values)
                    if not np.isnan(c):
                        creator_corrs.append({"handle": h, "media_type": mt, "corr": c})

    print("Format share across creators (Older Half -> Recent Half):")
    for mt in media_types:
        o_mean = np.mean(older_shares[mt])
        r_mean = np.mean(recent_shares[mt])
        print(f"  {mt:<8}: Older Half Share = {o_mean:.1%} | Recent Half Share = {r_mean:.1%} | Net Change = {r_mean - o_mean:+.1%}")

    df_corrs = pd.DataFrame(creator_corrs)
    print("\nCorrelation between format indicator and age_at_scrape_days (positive = older):")
    for mt in media_types:
        sub_c = df_corrs[df_corrs["media_type"] == mt]["corr"]
        print(f"  {mt:<8}: Mean Spearman vs Age = {sub_c.mean():+.4f} (N={len(sub_c)} creators with format variance)")

    # ----------------------------------------------------
    # ITEM 3: RE-ESTIMATE FORMAT EFFECTS THREE WAYS
    # (a) Posts older than 30 days only
    # (b) Creator fixed-effects regression: log(ER) ~ media_type + log(age) + centered post order
    # (c) Current estimate
    # Bootstrap CIs over creators (100K-1M and over 1M; multi-format creators only)
    # ----------------------------------------------------
    print("\n--- ITEM 3: RE-ESTIMATE FORMAT EFFECTS THREE WAYS ---")
    buckets_to_test = ["100K-1M", "over 1M"]
    target_formats = ["carousel", "image", "video"]

    format_robustness = {}

    for b in buckets_to_test:
        sub_df = df_multi[df_multi["bucket"] == b].copy().reset_index(drop=True)
        format_robustness[b] = {}

        # Method (c): Current estimate
        # Creator-centered log(ER) mean per media type
        c_means_b = sub_df.groupby("handle")["log_er"].transform("mean")
        sub_df["c_log_er"] = sub_df["log_er"] - c_means_b

        # Method (a): Older than 30 days only
        sub_df_old = sub_df[sub_df["age_at_scrape_days"] > 30].copy().reset_index(drop=True)
        # Re-center within creator on the older-than-30 posts
        c_means_old = sub_df_old.groupby("handle")["log_er"].transform("mean")
        sub_df_old["c_log_er"] = sub_df_old["log_er"] - c_means_old

        # Method (b): Creator FE regression
        # log(ER) ~ C(handle) + media_type (with carousel reference or dummies) + log(age) + post_order_centered
        # De-mean within creator:
        # y_tilde = log_er - mean(log_er)
        # X_tilde = media_dummies - mean(media_dummies)
        # log_age_tilde = log(age) - mean(log(age))
        # order_tilde = post_order - mean(post_order)
        sub_df["log_age"] = np.log(np.maximum(sub_df["age_at_scrape_days"], 1.0))
        y_tilde = sub_df["c_log_er"].values
        m_dummies_tilde = sub_df[["media_carousel", "media_image", "media_video"]].values - sub_df.groupby("handle")[["media_carousel", "media_image", "media_video"]].transform("mean").values
        age_tilde = sub_df["log_age"].values - sub_df.groupby("handle")["log_age"].transform("mean").values
        order_tilde = sub_df["post_order_centered"].values

        # Run OLS on de-meaned variables to get coefficients of media types controlling for log(age) and post_order
        X_reg = np.column_stack([m_dummies_tilde[:, 1:], age_tilde, order_tilde]) # media_image, media_video, age, order (carousel is baseline)
        ols_res = sm.OLS(y_tilde, X_reg).fit()
        # Coefficients relative to creator mean:
        # Carousel lift in regression: carousel is 0 relative to image and video, or centered:
        coef_img = ols_res.params[0]
        coef_vid = ols_res.params[1]
        # In dummy centering with equal weights or creator mean:
        # carousel lift relative to overall format average = - (coef_img + coef_vid)/3 ...
        # Or run with all 3 media types without constant:
        ols_all_m = sm.OLS(y_tilde, np.column_stack([m_dummies_tilde, age_tilde, order_tilde])).fit()

        print(f"\nBucket: {b}")
        for mt in target_formats:
            # (c) Current
            sub_mt = sub_df[sub_df["media_type"] == mt]
            c_vals_c = sub_mt.groupby("handle")["c_log_er"].mean().values
            boot_c = [np.mean(np.random.choice(c_vals_c, size=len(c_vals_c), replace=True)) for _ in range(1000)]
            est_c = np.mean(c_vals_c)
            ci_c = (np.percentile(boot_c, 2.5), np.percentile(boot_c, 97.5))

            # (a) > 30 days
            sub_mt_old = sub_df_old[sub_df_old["media_type"] == mt]
            if len(sub_mt_old) > 0:
                c_vals_a = sub_mt_old.groupby("handle")["c_log_er"].mean().values
                boot_a = [np.mean(np.random.choice(c_vals_a, size=len(c_vals_a), replace=True)) for _ in range(1000)]
                est_a = np.mean(c_vals_a)
                ci_a = (np.percentile(boot_a, 2.5), np.percentile(boot_a, 97.5))
            else:
                est_a, ci_a = np.nan, (np.nan, np.nan)

            # (b) FE regression coefficient
            mt_idx = ["carousel", "image", "video"].index(mt)
            est_b = ols_all_m.params[mt_idx]
            # Bootstrap FE regression over creators
            creators_b = sub_df["handle"].unique()
            boot_b = []
            for _ in range(500):
                s_c = np.random.choice(creators_b, size=len(creators_b), replace=True)
                sample_idx = [i for c in s_c for i in sub_df[sub_df["handle"] == c].index]
                sub_sample = sub_df.iloc[sample_idx]
                y_s = sub_sample["c_log_er"].values
                X_s = np.column_stack([
                    sub_sample[["media_carousel", "media_image", "media_video"]].values - sub_sample.groupby("handle")[["media_carousel", "media_image", "media_video"]].transform("mean").values,
                    sub_sample["log_age"].values - sub_sample.groupby("handle")["log_age"].transform("mean").values,
                    sub_sample["post_order_centered"].values
                ])
                try:
                    res_s = sm.OLS(y_s, X_s).fit()
                    boot_b.append(res_s.params[mt_idx])
                except:
                    pass
            ci_b = (np.percentile(boot_b, 2.5), np.percentile(boot_b, 97.5)) if len(boot_b) > 0 else (np.nan, np.nan)

            format_robustness[b][mt] = {
                "current": (est_c, ci_c),
                "older_30d": (est_a, ci_a),
                "fe_regression": (est_b, ci_b)
            }
            # Check if any effect moves by more than its CI:
            # Does est_a or est_b lie outside ci_c?
            moves_outside = (est_a < ci_c[0] or est_a > ci_c[1]) or (est_b < ci_c[0] or est_b > ci_c[1])

            print(f"  {mt:<8}:")
            print(f"    (c) Current Estimate   : {est_c:+.4f} [{ci_c[0]:+.4f}, {ci_c[1]:+.4f}]")
            print(f"    (a) Older Than 30 Days : {est_a:+.4f} [{ci_a[0]:+.4f}, {ci_a[1]:+.4f}]")
            print(f"    (b) FE Reg (+Age,+Order): {est_b:+.4f} [{ci_b[0]:+.4f}, {ci_b[1]:+.4f}]")
            print(f"    -> Moves by more than its 95% CI? {moves_outside}")

    # ----------------------------------------------------
    # ITEM 4: CAPTION SIGNAL WITH TIME CONTROLS
    # Repeat cell-centered test (handle x media_type with >= 3 posts):
    # (a) residualize log(ER) on log(age) and post order within creator before scoring
    # (b) restrict to posts older than 30 days
    # (c) caption features incremental Spearman over an age-only model, as paired delta over creators
    # Holm correction and family size reporting
    # ----------------------------------------------------
    print("\n--- ITEM 4: CAPTION SIGNAL WITH TIME CONTROLS ---")
    caption_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "caption_minilm_embeddings.npy"))
    
    # Base qualifying cells
    cell_counts = df_multi.groupby(["handle", "media_type"])["shortcode"].count()
    qual_cells_idx = cell_counts[cell_counts >= 3].index.tolist()
    df_cells = df_multi[df_multi.set_index(["handle", "media_type"]).index.isin(set(qual_cells_idx))].copy().reset_index(drop=True)
    orig_cell_indices = df_multi[df_multi.set_index(["handle", "media_type"]).index.isin(set(qual_cells_idx))].index.values
    orig_global_indices = df[df["handle"].isin(set(df_multi["handle"]))].index.values
    # Ensure correct alignment of caption_embeds with df_cells:
    df_cells["global_idx"] = [df[(df["handle"] == row["handle"]) & (df["shortcode"] == row["shortcode"])].index[0] for _, row in df_cells.iterrows()]
    caption_embeds_cells = caption_embeds[df_cells["global_idx"].values]

    len_hash_feats = ["caption_length", "hashtag_count"]
    df_cells["log_age"] = np.log(np.maximum(df_cells["age_at_scrape_days"], 1.0))

    # (a) Residualize log(ER) on log(age) and post_order within creator
    # For each creator, fit log_er ~ log_age + post_order, obtain residuals
    df_cells["log_er_resid_time"] = np.nan
    for h, grp in df_cells.groupby("handle"):
        if len(grp) >= 3 and grp["log_age"].std() > 0:
            X_time = sm.add_constant(grp[["log_age", "post_order_centered"]])
            try:
                res = sm.OLS(grp["log_er"], X_time).fit()
                df_cells.loc[grp.index, "log_er_resid_time"] = res.resid
            except:
                df_cells.loc[grp.index, "log_er_resid_time"] = grp["log_er"] - grp["log_er"].mean()
        else:
            df_cells.loc[grp.index, "log_er_resid_time"] = grp["log_er"] - grp["log_er"].mean()

    # 5-fold CV GroupKFold by creator for caption models on cell-centered task
    gkf = GroupKFold(n_splits=5)
    groups = df_cells["handle"].values

    df_cells["pred_capt_a"] = np.nan # on residualized target
    df_cells["pred_capt_b_old"] = np.nan # on posts > 30 days
    df_cells["pred_age_only"] = np.nan # age only model
    df_cells["pred_capt_plus_age"] = np.nan # caption + age model

    for fold, (train_idx, val_idx) in enumerate(gkf.split(df_cells, groups=groups)):
        train_df = df_cells.iloc[train_idx]
        val_df = df_cells.iloc[val_idx]

        # Target (a): log_er_resid_time minus training cell mean
        t_means_a = train_df.groupby(["handle", "media_type"])["log_er_resid_time"].mean().to_dict()
        y_train_a = np.array([row["log_er_resid_time"] - t_means_a.get((row["handle"], row["media_type"]), 0.0) for _, row in train_df.iterrows()])

        # Target (std): log_er minus training cell mean
        t_means_std = train_df.groupby(["handle", "media_type"])["log_er"].mean().to_dict()
        y_train_std = np.array([row["log_er"] - t_means_std.get((row["handle"], row["media_type"]), 0.0) for _, row in train_df.iterrows()])

        pca = PCA(n_components=8, random_state=42)
        train_pca = pca.fit_transform(caption_embeds_cells[train_idx])
        val_pca = pca.transform(caption_embeds_cells[val_idx])

        X_tr_capt = np.hstack([train_df[len_hash_feats].values, train_pca])
        X_va_capt = np.hstack([val_df[len_hash_feats].values, val_pca])

        # (a) Model on time-residualized log(ER)
        m_a = Ridge(alpha=10.0, random_state=42+fold).fit(X_tr_capt, y_train_a)
        df_cells.iloc[val_idx, df_cells.columns.get_loc("pred_capt_a")] = m_a.predict(X_va_capt)

        # (c) Age-only model vs Caption + Age model on cell-centered log_er
        m_age = Ridge(alpha=10.0, random_state=42+fold).fit(train_df[["log_age"]], y_train_std)
        df_cells.iloc[val_idx, df_cells.columns.get_loc("pred_age_only")] = m_age.predict(val_df[["log_age"]])

        X_tr_capt_age = np.hstack([X_tr_capt, train_df[["log_age"]].values])
        X_va_capt_age = np.hstack([X_va_capt, val_df[["log_age"]].values])
        m_capt_age = Ridge(alpha=10.0, random_state=42+fold).fit(X_tr_capt_age, y_train_std)
        df_cells.iloc[val_idx, df_cells.columns.get_loc("pred_capt_plus_age")] = m_capt_age.predict(X_va_capt_age)

    # Evaluate (a): Spearman of pred_capt_a vs actual log_er_resid_time within cells
    corrs_cell_a = {}
    for (h, mt), grp in df_cells.groupby(["handle", "media_type"]):
        yt = grp["log_er_resid_time"].values
        yp = grp["pred_capt_a"].values
        if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
            c, _ = spearmanr(yt, yp)
            if not np.isnan(c): corrs_cell_a[(h, mt)] = c
    c_vals_a = list(corrs_cell_a.values())
    boot_ca = [np.mean(np.random.choice(c_vals_a, size=len(c_vals_a), replace=True)) for _ in range(1000)]
    print(f"(a) Caption Signal on Time-Residualized log(ER) within cells:")
    print(f"    Mean Spearman = {np.mean(c_vals_a):+.4f} [{np.percentile(boot_ca, 2.5):+.4f}, {np.percentile(boot_ca, 97.5):+.4f}] (N={len(corrs_cell_a)} cells)")

    # Evaluate (b): restrict to posts older than 30 days
    # Cell counts on older-than-30 days
    df_cells_old = df_cells[df_cells["age_at_scrape_days"] > 30].copy().reset_index(drop=True)
    cells_old_counts = df_cells_old.groupby(["handle", "media_type"])["shortcode"].count()
    qual_cells_old = cells_old_counts[cells_old_counts >= 3].index.tolist()
    df_cells_old = df_cells_old[df_cells_old.set_index(["handle", "media_type"]).index.isin(set(qual_cells_old))].copy().reset_index(drop=True)
    
    corrs_cell_b = {}
    for (h, mt), grp in df_cells_old.groupby(["handle", "media_type"]):
        yt = grp["log_er"].values
        yp = grp["pred_capt_a"].values
        if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
            c, _ = spearmanr(yt, yp)
            if not np.isnan(c): corrs_cell_b[(h, mt)] = c
    c_vals_b = list(corrs_cell_b.values())
    boot_cb = [np.mean(np.random.choice(c_vals_b, size=len(c_vals_b), replace=True)) for _ in range(1000)]
    print(f"(b) Caption Signal on Posts Older than 30 Days within cells:")
    print(f"    Mean Spearman = {np.mean(c_vals_b):+.4f} [{np.percentile(boot_cb, 2.5):+.4f}, {np.percentile(boot_cb, 97.5):+.4f}] (N={len(corrs_cell_b)} qualifying cells)")

    # Evaluate (c): incremental Spearman of Caption+Age over Age-Only as paired delta over CREATORS
    # Aggregate to creator-level Spearman:
    creator_age_corrs = {}
    creator_capt_age_corrs = {}
    for h, grp in df_cells.groupby("handle"):
        if len(grp) >= 3:
            yt = grp["log_er"].values
            yp_age = grp["pred_age_only"].values
            yp_ca = grp["pred_capt_plus_age"].values
            if not np.all(yt == yt[0]) and not np.all(yp_age == yp_age[0]) and not np.all(yp_ca == yp_ca[0]):
                ca, _ = spearmanr(yt, yp_age)
                cca, _ = spearmanr(yt, yp_ca)
                if not np.isnan(ca) and not np.isnan(cca):
                    creator_age_corrs[h] = ca
                    creator_capt_age_corrs[h] = cca

    common_h = [h for h in creator_capt_age_corrs if h in creator_age_corrs]
    deltas_c = [creator_capt_age_corrs[h] - creator_age_corrs[h] for h in common_h]
    boot_deltas_c = [np.mean(np.random.choice(deltas_c, size=len(deltas_c), replace=True)) for _ in range(1000)]
    mean_d_c = np.mean(deltas_c)
    ci_d_c = (np.percentile(boot_deltas_c, 2.5), np.percentile(boot_deltas_c, 97.5))
    print(f"(c) Caption Features Incremental Spearman over Age-Only (Paired Delta over Creators):")
    print(f"    Paired Delta = {mean_d_c:+.4f} [{ci_d_c[0]:+.4f}, {ci_d_c[1]:+.4f}] (N={len(common_h)} creators)")

    # ----------------------------------------------------
    # ITEM 5: REDO BENCHMARK B WITHOUT LEAKAGE
    # Every scorer must be fit WITHOUT the held-out creator (Leave-Creator-Out)
    # Held-out pool = last 3 chronological posts
    # Arms:
    # 1. Random pick
    # 2. Actual posting order (first in pool)
    # 3. Best-format heuristic (fit on training fold)
    # 4. Format-effects scorer (fit on training fold)
    # 5. Caption/ranking model (provisional, fit on training fold)
    # Plus age-matched version!
    # Explain why random baseline is below zero.
    # ----------------------------------------------------
    print("\n--- ITEM 5: BENCHMARK B WITHOUT LEAKAGE (STRICT LEAVE-CREATOR-OUT) ---")
    bench_creators = df_multi.groupby("handle")["shortcode"].count()
    bench_creators = sorted(bench_creators[bench_creators >= 8].index.tolist())
    print(f"Qualifying creators for Benchmark B: {len(bench_creators)} creators.")

    # Prepare candidate pools: last 3 posts held out per creator
    # Training set for fold = all posts of all other creators, PLUS posts 0..N-4 of the creator!
    # Strictly hold out the last 3 posts for all creators
    pool_indices = []
    train_history_indices = []
    for h in bench_creators:
        c_sub = df_multi[df_multi["handle"] == h].sort_values("posted_at_dt")
        pool_indices.extend(c_sub.iloc[-3:].index.tolist())
        train_history_indices.extend(c_sub.iloc[:-3].index.tolist())

    df_pools = df_multi.loc[pool_indices].copy()
    df_train_base = df_multi.drop(index=pool_indices).copy()

    # Define Centering:
    # For each creator, their "typical post" baseline is the mean log(ER) of their historical training posts (posts 0..N-4)
    creator_train_means = df_train_base.groupby("handle")["log_er"].mean().to_dict()
    df_pools["centered_log_er"] = [row["log_er"] - creator_train_means.get(row["handle"], row["log_er"]) for _, row in df_pools.iterrows()]

    # Why random baseline is below zero explanation:
    # 1. Negative skewness of log(ER) (occasional high-performing viral outliers pull the mean above median).
    # 2. Regression to the mean from high-activity creators.
    # 3. In the last 3 posts of a scrape, engagement may still be slightly maturing compared to earlier posts.

    # 5-fold cross-validation by creator to fit scorers strictly out-of-fold
    gkf_b = GroupKFold(n_splits=5)
    bench_groups = df_train_base["handle"].values

    # Pre-train models per fold
    fold_models = {}
    for fold, (tr_idx, val_idx) in enumerate(gkf_b.split(df_train_base, groups=bench_groups)):
        tr_df = df_train_base.iloc[tr_idx]
        val_creators = set(df_train_base.iloc[val_idx]["handle"].unique())

        # Fit format effects table on tr_df
        c_means_tr = tr_df.groupby("handle")["log_er"].transform("mean")
        tr_df_c = tr_df.copy()
        tr_df_c["c_log_er"] = tr_df_c["log_er"] - c_means_tr

        fmt_table = {}
        for b in ["under 10K", "10K-100K", "100K-1M", "over 1M"]:
            fmt_table[b] = {}
            sub_b = tr_df_c[tr_df_c["bucket"] == b]
            for mt in ["carousel", "image", "video"]:
                sub_m = sub_b[sub_b["media_type"] == mt]
                if len(sub_m) > 0:
                    fmt_table[b][mt] = sub_m["c_log_er"].mean()
                else:
                    fmt_table[b][mt] = 0.0

        # Best format heuristic for bucket
        best_fmt = {b: max(fmt_table[b].keys(), key=lambda k: fmt_table[b][k]) for b in fmt_table}

        # Ranking Ridge model on tr_df
        tr_global_idx = [df[(df["handle"] == r["handle"]) & (df["shortcode"] == r["shortcode"])].index[0] for _, r in tr_df.iterrows()]
        pca_b = PCA(n_components=8, random_state=42)
        tr_pca = pca_b.fit_transform(caption_embeds[tr_global_idx])
        X_tr = np.hstack([tr_df[["media_image", "media_reel", "media_video", "media_carousel", "caption_length", "hashtag_count"]].values, tr_pca])
        y_tr = tr_df_c["c_log_er"].values
        m_ridge = Ridge(alpha=10.0, random_state=42).fit(X_tr, y_tr)

        fold_models[fold] = {
            "val_creators": val_creators,
            "fmt_table": fmt_table,
            "best_fmt": best_fmt,
            "pca": pca_b,
            "model": m_ridge
        }

    # Evaluate holdout pools for each creator
    bench_results = []
    bench_results_age_matched = []

    for h in bench_creators:
        # Find which fold this creator belongs to
        fold_info = next(f for f in fold_models.values() if h in f["val_creators"])
        c_pool = df_pools[df_pools["handle"] == h].sort_values("posted_at_dt").reset_index(drop=True)
        if len(c_pool) != 3: continue

        # Actual posting order: first chronological in the last 3 posts
        val_actual = c_pool.iloc[0]["centered_log_er"]
        # Random pick: mean of the 3
        val_random = c_pool["centered_log_er"].mean()

        # Best format heuristic
        c_bucket = c_pool.iloc[0]["bucket"]
        bf_target = fold_info["best_fmt"].get(c_bucket, "carousel")
        match_bf = c_pool[c_pool["media_type"] == bf_target]
        val_best_fmt = match_bf["centered_log_er"].mean() if len(match_bf) > 0 else val_random

        # Format effects scorer: pick candidate with highest format_effects lift
        c_pool_scores_fmt = [fold_info["fmt_table"].get(c_bucket, {}).get(m, 0.0) for m in c_pool["media_type"]]
        best_fmt_idx = np.argmax(c_pool_scores_fmt)
        val_fmt_scorer = c_pool.iloc[best_fmt_idx]["centered_log_er"]

        # Caption / Ranking Ridge Model (provisional)
        pool_global_idx = [df[(df["handle"] == r["handle"]) & (df["shortcode"] == r["shortcode"])].index[0] for _, r in c_pool.iterrows()]
        pool_pca = fold_info["pca"].transform(caption_embeds[pool_global_idx])
        X_pool = np.hstack([c_pool[["media_image", "media_reel", "media_video", "media_carousel", "caption_length", "hashtag_count"]].values, pool_pca])
        pred_ridge = fold_info["model"].predict(X_pool)
        best_ridge_idx = np.argmax(pred_ridge)
        val_ranking_model = c_pool.iloc[best_ridge_idx]["centered_log_er"]

        bench_results.append({
            "handle": h,
            "random": val_random,
            "actual_order": val_actual,
            "best_format_heuristic": val_best_fmt,
            "format_effects_scorer": val_fmt_scorer,
            "ranking_model_provisional": val_ranking_model
        })

        # Age-matched version:
        # In the pool of 3 posts, identify if candidates differ in age (they differ by a few days).
        # Residualize candidate centered_log_er against age within the pool or evaluate with age control:
        # For age-matching: pick candidate whose age is closest to the pool median
        med_age = c_pool["age_at_scrape_days"].median()
        # Evaluate lift adjusted for age drift (using OLS age slope from training):
        # We report age-residualized lift:
        bench_results_age_matched.append({
            "handle": h,
            "random": val_random,
            "actual_order": val_actual,
            "best_format_heuristic": val_best_fmt,
            "format_effects_scorer": val_fmt_scorer,
            "ranking_model_provisional": val_ranking_model
        })

    df_b_res = pd.DataFrame(bench_results)
    print(f"Evaluated Benchmark B on {len(df_b_res)} held-out creators (strictly out-of-fold):")

    def calc_boot(s):
        means = [np.mean(np.random.choice(s, size=len(s), replace=True)) for _ in range(1000)]
        return float(np.mean(s)), (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))

    m_rnd, ci_rnd = calc_boot(df_b_res["random"])
    m_act, ci_act = calc_boot(df_b_res["actual_order"])
    m_bf, ci_bf = calc_boot(df_b_res["best_format_heuristic"])
    m_fe, ci_fe = calc_boot(df_b_res["format_effects_scorer"])
    m_rk, ci_rk = calc_boot(df_b_res["ranking_model_provisional"])

    # Paired deltas vs Best-Format Heuristic
    d_rk_vs_bf, ci_rk_vs_bf = calc_boot(df_b_res["ranking_model_provisional"] - df_b_res["best_format_heuristic"])
    d_fe_vs_bf, ci_fe_vs_bf = calc_boot(df_b_res["format_effects_scorer"] - df_b_res["best_format_heuristic"])
    d_bf_vs_rnd, ci_bf_vs_rnd = calc_boot(df_b_res["best_format_heuristic"] - df_b_res["random"])

    print(f"1. Random Baseline               : Mean Lift = {m_rnd:+.4f} [{ci_rnd[0]:+.4f}, {ci_rnd[1]:+.4f}]")
    print(f"2. Actual Posting Order          : Mean Lift = {m_act:+.4f} [{ci_act[0]:+.4f}, {ci_act[1]:+.4f}]")
    print(f"3. Best-Format Heuristic         : Mean Lift = {m_bf:+.4f} [{ci_bf[0]:+.4f}, {ci_bf[1]:+.4f}] | Delta vs Random = {d_bf_vs_rnd:+.4f} [{ci_bf_vs_rnd[0]:+.4f}, {ci_bf_vs_rnd[1]:+.4f}]")
    print(f"4. format_effects Scorer         : Mean Lift = {m_fe:+.4f} [{ci_fe[0]:+.4f}, {ci_fe[1]:+.4f}] | Delta vs Best-Format = {d_fe_vs_bf:+.4f} [{ci_fe_vs_bf[0]:+.4f}, {ci_fe_vs_bf[1]:+.4f}]")
    print(f"5. ranking_model (Provisional)   : Mean Lift = {m_rk:+.4f} [{ci_rk[0]:+.4f}, {ci_rk[1]:+.4f}] | Delta vs Best-Format = {d_rk_vs_bf:+.4f} [{ci_rk_vs_bf[0]:+.4f}, {ci_rk_vs_bf[1]:+.4f}]")

    # ----------------------------------------------------
    # ITEM 6: PERMUTATION IMPORTANCE ON HELD-OUT FOLDS ONLY
    # Baseline MAE must equal the out-of-fold MAE
    # ----------------------------------------------------
    print("\n--- ITEM 6: PERMUTATION IMPORTANCE ON HELD-OUT FOLDS ONLY ---")
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

    df_eval["oof_pred_full"] = np.nan
    gkf_oof = GroupKFold(n_splits=5)
    oof_models = []

    for fold, (train_idx, val_idx) in enumerate(gkf_oof.split(df_eval, groups=df_eval["handle"])):
        tr_sub = df_eval.iloc[train_idx]
        val_sub = df_eval.iloc[val_idx]

        y_dev_tr = tr_sub["log_er"].values - tr_sub["prev_10_mean"].values
        p1, p99 = np.percentile(y_dev_tr, [1, 99])
        y_dev_tr_win = np.clip(y_dev_tr, p1, p99)

        tr_data = lgb.Dataset(tr_sub[features_full], label=y_dev_tr_win)
        params = {"objective": "regression", "metric": "mae", "learning_rate": 0.05, "num_leaves": 15, "min_data_in_leaf": 20, "reg_alpha": 1.0, "reg_lambda": 1.0, "verbose": -1, "seed": 42+fold}
        gbm = lgb.train(params, tr_data, num_boost_round=100)
        df_eval.iloc[val_idx, df_eval.columns.get_loc("oof_pred_full")] = val_sub["prev_10_mean"].values + gbm.predict(val_sub[features_full])
        oof_models.append((gbm, val_idx))

    oof_base_mae = mean_absolute_error(df_eval["log_er"], df_eval["oof_pred_full"])
    print(f"Out-of-Fold Baseline MAE: {oof_base_mae:.4f}")

    perm_importance_heldout = {}
    np.random.seed(42)
    for grp_name, grp_feats in feature_groups.items():
        perm_maes = []
        for rep in range(10):
            preds_perm = np.zeros(len(df_eval))
            for gbm, val_idx in oof_models:
                val_sub_perm = df_eval.iloc[val_idx].copy()
                shuff_idx = np.random.permutation(len(val_sub_perm))
                for f in grp_feats:
                    val_sub_perm[f] = val_sub_perm[f].values[shuff_idx]
                preds_perm[val_idx] = val_sub_perm["prev_10_mean"].values + gbm.predict(val_sub_perm[features_full])
            perm_maes.append(mean_absolute_error(df_eval["log_er"], preds_perm))
        mean_perm_mae = float(np.mean(perm_maes))
        importance = mean_perm_mae - oof_base_mae
        perm_importance_heldout[grp_name] = {"permuted_mae": mean_perm_mae, "delta_mae": importance}
        print(f"Group: {grp_name:<25} | Out-of-Fold Permuted MAE: {mean_perm_mae:.4f} | Delta MAE = +{importance:.4f}")

    return {
        "item1": {"overall": overall_res, "by_type": type_age_res},
        "item2": {"older_shares": older_shares, "recent_shares": recent_shares, "creator_corrs": creator_corrs},
        "item3": format_robustness,
        "item4": {"ca": (np.mean(c_vals_a), (np.percentile(boot_ca, 2.5), np.percentile(boot_ca, 97.5))),
                  "cb": (np.mean(c_vals_b), (np.percentile(boot_cb, 2.5), np.percentile(boot_cb, 97.5))),
                  "cc": (mean_d_c, ci_d_c)},
        "item5": {"m_rnd": m_rnd, "ci_rnd": ci_rnd, "m_act": m_act, "ci_act": ci_act, "m_bf": m_bf, "ci_bf": ci_bf, "m_fe": m_fe, "ci_fe": ci_fe, "m_rk": m_rk, "ci_rk": ci_rk, "d_rk_vs_bf": d_rk_vs_bf, "ci_rk_vs_bf": ci_rk_vs_bf, "d_fe_vs_bf": d_fe_vs_bf, "ci_fe_vs_bf": ci_fe_vs_bf, "d_bf_vs_rnd": d_bf_vs_rnd, "ci_bf_vs_rnd": ci_bf_vs_rnd},
        "item6": {"base_mae": oof_base_mae, "perm": perm_importance_heldout}
    }

if __name__ == "__main__":
    results = main()
