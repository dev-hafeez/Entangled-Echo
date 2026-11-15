import os
import json
import numpy as np
import pandas as pd

from scripts.run_evaluation_v2 import load_clean_snapshot_data

df = load_clean_snapshot_data("2026-11-02-clean")
print(f"Loaded {len(df)} posts.")

# Ensure time ordering
df["posted_at_dt"] = pd.to_datetime(df["posted_at"], utc=True)
df = df.sort_values(by=["handle", "posted_at_dt"]).reset_index(drop=True)

# Compute bucket means for fallback
bucket_means = df.groupby("follower_bucket")["log_er"].mean().to_dict()

# Calculate strictly past-only features per creator
trailing_rows = []
for handle, group in df.groupby("handle", sort=False):
    # group is sorted chronologically
    log_ers = group["log_er"].values
    dts = group["posted_at_dt"].values
    bucket = group["follower_bucket"].values[0]
    b_mean = bucket_means[bucket]
    
    n_posts = len(group)
    for i in range(n_posts):
        # Only strictly prior posts [0 : i]
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
            # Days since previous post
            diff_sec = (dts[i] - prior_dts[-1]) / np.timedelta64(1, 's')
            days_since_prev = max(0.0, float(diff_sec) / 86400.0)
        else:
            days_since_prev = 0.0
            
        trailing_rows.append({
            "prev_10_mean": prev_10_mean,
            "prev_10_std": prev_10_std,
            "prev_3_mean": prev_3_mean,
            "num_prior_posts": num_prior,
            "days_since_prev": days_since_prev,
            "has_history": has_history,
            "target_deviation": log_ers[i] - prev_10_mean
        })

trailing_df = pd.DataFrame(trailing_rows)
print("Trailing features computed successfully!")
print(trailing_df.describe())
