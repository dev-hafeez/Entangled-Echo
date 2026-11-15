import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.model_selection import GroupKFold
import lightgbm as lgb
from typing import Tuple

from scripts.run_corrected_evaluation import load_clean_data

df_clean = load_clean_data(exclude_exact_3_likes=False)
df = df_clean[~df_clean["data_suspect"]].copy().reset_index(drop=True)

# Content-only features
media_types = ["media_image", "media_reel", "media_video", "media_carousel"]
content_features = media_types + ["hour_sin", "hour_cos", "post_weekday", "caption_length", "hashtag_count"]

gkf = GroupKFold(n_splits=5)
groups = df["handle"].values

df["pred_content_log_er"] = np.nan
df["pred_mediatype_log_er"] = np.nan

for fold, (train_idx, val_idx) in enumerate(gkf.split(df, df["log_er"], groups)):
    train_df = df.iloc[train_idx]
    val_df = df.iloc[val_idx]

    # 1. Content-Only Model predicting raw log_er directly
    m_content = lgb.LGBMRegressor(
        n_estimators=60, learning_rate=0.03, max_depth=3, num_leaves=7,
        min_child_samples=25, subsample=0.8, colsample_bytree=0.8,
        reg_alpha=1.0, reg_lambda=5.0, random_state=42 + fold, verbose=-1
    )
    m_content.fit(train_df[content_features], train_df["log_er"])
    df.iloc[val_idx, df.columns.get_loc("pred_content_log_er")] = m_content.predict(val_df[content_features])

    # 2. Media-Type-Only Control
    m_media = lgb.LGBMRegressor(
        n_estimators=60, learning_rate=0.03, max_depth=3, num_leaves=7,
        min_child_samples=25, subsample=0.8, colsample_bytree=0.8,
        reg_alpha=1.0, reg_lambda=5.0, random_state=42 + fold, verbose=-1
    )
    m_media.fit(train_df[media_types], train_df["log_er"])
    df.iloc[val_idx, df.columns.get_loc("pred_mediatype_log_er")] = m_media.predict(val_df[media_types])

def eval_within_creator_log_er(pred_col: str):
    corrs = []
    for h, group in df.groupby("handle"):
        if len(group) >= 3:
            yt = group["log_er"].values
            yp = group[pred_col].values
            if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                c, _ = spearmanr(yt, yp)
                if not np.isnan(c):
                    corrs.append(float(c))
    mean_c = float(np.mean(corrs)) if corrs else 0.0

    # Bootstrap CI
    per_c = {}
    for h, group in df.groupby("handle"):
        if len(group) >= 3:
            yt = group["log_er"].values
            yp = group[pred_col].values
            if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                c, _ = spearmanr(yt, yp)
                if not np.isnan(c):
                    per_c[h] = float(c)
    eligible = list(per_c.keys())
    means = []
    np.random.seed(42)
    for _ in range(1000):
        s_h = np.random.choice(eligible, size=len(eligible), replace=True)
        means.append(np.mean([per_c[h] for h in s_h]))
    ci_low = float(np.percentile(means, 2.5))
    ci_high = float(np.percentile(means, 97.5))

    # Shuffled floor within creator
    shuff_means = []
    for _ in range(20):
        shuff_corrs = []
        for h, group in df.groupby("handle"):
            if len(group) >= 3:
                yt = group["log_er"].values
                yp = np.random.permutation(group[pred_col].values)
                if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                    c, _ = spearmanr(yt, yp)
                    if not np.isnan(c):
                        shuff_corrs.append(float(c))
        if shuff_corrs:
            shuff_means.append(np.mean(shuff_corrs))
    shuff_floor_95 = float(np.percentile(shuff_means, 95))

    return mean_c, (ci_low, ci_high), shuff_floor_95

c_mean, c_ci, c_floor = eval_within_creator_log_er("pred_content_log_er")
m_mean, m_ci, m_floor = eval_within_creator_log_er("pred_mediatype_log_er")

print("\n--- CLEAN HEADLINE WITHIN-CREATOR METRIC ---")
print(f"Content-Only Model (vs actual log_er)   : Spearman = {c_mean:+.4f} [95% CI: {c_ci[0]:+.4f}, {c_ci[1]:+.4f}] | Shuff Floor 95th: {c_floor:+.4f}")
print(f"Media-Type-Only Control (vs actual log_er): Spearman = {m_mean:+.4f} [95% CI: {m_ci[0]:+.4f}, {m_ci[1]:+.4f}] | Shuff Floor 95th: {m_floor:+.4f}")
print(f"CI Lower Bound Exceeds Floor? {c_ci[0] > c_floor} (Lower: {c_ci[0]:+.4f} vs Floor: {c_floor:+.4f})")
