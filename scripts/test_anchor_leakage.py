import os
import json
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.model_selection import GroupKFold
import lightgbm as lgb
from typing import Tuple, List

from scripts.run_corrected_evaluation import load_clean_data, compute_within_creator_deviation_spearman, bootstrap_deviation_spearman_ci

# Load data without data_suspect
df_clean = load_clean_data(exclude_exact_3_likes=False)
df = df_clean[~df_clean["data_suspect"]].copy().reset_index(drop=True)
print(f"Loaded {len(df)} posts across {df['handle'].nunique()} creators.")

# Feature subsets
media_time_features = ["media_image", "media_reel", "media_video", "media_carousel", "hour_sin", "hour_cos", "post_weekday"]
caption_features = ["caption_length"]
hashtag_features = ["hashtag_count"]
content_features = media_time_features + caption_features + hashtag_features
trailing_history_features = ["prev_10_std", "prev_3_mean", "num_prior_posts", "days_since_prev", "has_history"]
full_features = content_features + trailing_history_features

gkf = GroupKFold(n_splits=5)
groups = df["handle"].values

# Storage for predictions
df["pred_dev_full"] = np.nan
df["pred_dev_trailing_only"] = np.nan
df["pred_dev_content_only"] = np.nan
df["pred_dev_neg_prev10"] = -df["prev_10_mean"]

for fold, (train_idx, val_idx) in enumerate(gkf.split(df, df["log_er"], groups)):
    train_df = df.iloc[train_idx].copy()
    val_df = df.iloc[val_idx].copy()

    p1 = np.percentile(train_df["actual_deviation"], 1.0)
    p99 = np.percentile(train_df["actual_deviation"], 99.0)
    train_dev_winsorized = np.clip(train_df["actual_deviation"], p1, p99)

    # a) Full model
    m_full = lgb.LGBMRegressor(
        n_estimators=60, learning_rate=0.03, max_depth=3, num_leaves=7,
        min_child_samples=25, subsample=0.8, colsample_bytree=0.8,
        reg_alpha=1.0, reg_lambda=5.0, random_state=42 + fold, verbose=-1
    )
    m_full.fit(train_df[full_features], train_dev_winsorized)
    df.iloc[val_idx, df.columns.get_loc("pred_dev_full")] = m_full.predict(val_df[full_features])

    # b) Trailing-history-features-only model
    m_trail = lgb.LGBMRegressor(
        n_estimators=60, learning_rate=0.03, max_depth=3, num_leaves=7,
        min_child_samples=25, subsample=0.8, colsample_bytree=0.8,
        reg_alpha=1.0, reg_lambda=5.0, random_state=42 + fold, verbose=-1
    )
    m_trail.fit(train_df[trailing_history_features], train_dev_winsorized)
    df.iloc[val_idx, df.columns.get_loc("pred_dev_trailing_only")] = m_trail.predict(val_df[trailing_history_features])

    # c) Content-only model (media type, hour, weekday, caption length, hashtag count; NO trailing or creator features)
    m_content = lgb.LGBMRegressor(
        n_estimators=60, learning_rate=0.03, max_depth=3, num_leaves=7,
        min_child_samples=25, subsample=0.8, colsample_bytree=0.8,
        reg_alpha=1.0, reg_lambda=5.0, random_state=42 + fold, verbose=-1
    )
    m_content.fit(train_df[content_features], train_dev_winsorized)
    df.iloc[val_idx, df.columns.get_loc("pred_dev_content_only")] = m_content.predict(val_df[content_features])

# Shuffled control for each
predictors = [
    ("a) Current Full Model", "pred_dev_full"),
    ("b) Trailing-History-Only Model", "pred_dev_trailing_only"),
    ("c) Content-Only Model", "pred_dev_content_only"),
    ("d) Trivial Predictor: -prev_10_mean", "pred_dev_neg_prev10"),
]

print("\n--- ANCHOR LEAKAGE TEST RESULTS (Deviation Spearman) ---")
for name, col in predictors:
    mean_sp, _ = compute_within_creator_deviation_spearman(df, col, "actual_deviation")
    ci_low, ci_high = bootstrap_deviation_spearman_ci(df, col, "actual_deviation")

    # Shuffled floor for this predictor
    shuff_corrs = []
    np.random.seed(42)
    for _ in range(20):
        df_shuff = df.copy()
        shuff_vals = []
        for h, grp in df.groupby("handle", sort=False):
            vals = grp[col].values.copy()
            np.random.shuffle(vals)
            shuff_vals.extend(vals)
        df_shuff["shuff_col"] = shuff_vals
        s, _ = compute_within_creator_deviation_spearman(df_shuff, "shuff_col", "actual_deviation")
        shuff_corrs.append(s)
    floor_95 = float(np.percentile(shuff_corrs, 95))
    floor_mean = float(np.mean(shuff_corrs))

    print(f"{name:38s} | Spearman: {mean_sp:+.4f} [95% CI: {ci_low:+.4f}, {ci_high:+.4f}] | Shuff Floor 95th: {floor_95:+.4f}")

