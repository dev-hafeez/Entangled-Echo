import os
import json
import numpy as np
import pandas as pd
from typing import Dict, Any, List
import statsmodels.api as sm

from scripts.run_part_a_rigorous import load_data

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports")

def cluster_bootstrap_ci(arr, n_boot=2000, seed=42):
    arr = np.array(arr)
    arr = arr[~np.isnan(arr)]
    if len(arr) == 0:
        return np.nan, (np.nan, np.nan)
    rng = np.random.default_rng(seed)
    indices = rng.integers(0, len(arr), size=(n_boot, len(arr)))
    boot_means = np.mean(arr[indices], axis=1)
    return float(np.mean(arr)), (float(np.percentile(boot_means, 2.5)), float(np.percentile(boot_means, 97.5)))

def main():
    print("=" * 80)
    print("TASK 4: TIME-WINDOW SENSITIVITY (30-180 DAYS) & LOG(AGE) COVARIATE")
    print("=" * 80)

    df = load_data()
    df_100k = df[df["followers"] >= 100000].copy()

    # 1. Full 100K+ sample
    X_full = sm.add_constant(df_100k[["media_carousel", "media_video"]].astype(float))
    m_full = sm.OLS(df_100k["centered_log_er"].astype(float), X_full).fit()
    
    # 2. Window 30-180 days
    df_window = df_100k[(df_100k["age_at_scrape_days"] >= 30.0) & (df_100k["age_at_scrape_days"] <= 180.0)].copy()
    X_win = sm.add_constant(df_window[["media_carousel", "media_video"]].astype(float))
    m_win = sm.OLS(df_window["centered_log_er"].astype(float), X_win).fit()

    # 3. Window 30-180 days + log(age) covariate
    df_window["log_age"] = np.log(df_window["age_at_scrape_days"])
    X_cov = sm.add_constant(df_window[["media_carousel", "media_video", "log_age"]].astype(float))
    m_cov = sm.OLS(df_window["centered_log_er"].astype(float), X_cov).fit()

    # 4. Creator-Clustered Bootstrap of Carousel vs Video Gap in 30-180d window
    unique_creators = df_window["handle"].unique()
    print(f"Window 30-180d: {len(df_window)} posts across {len(unique_creators)} creators with >=100K followers.")

    # Pairwise creator differences: for creators with both carousel and video in this window
    creator_gaps = []
    for h, grp in df_window.groupby("handle"):
        c_sub = grp[grp["media_carousel"] == 1]
        v_sub = grp[grp["media_video"] == 1]
        if len(c_sub) > 0 and len(v_sub) > 0:
            c_mean = c_sub["centered_log_er"].mean()
            v_mean = v_sub["centered_log_er"].mean()
            creator_gaps.append(c_mean - v_mean)

    gap_mean, gap_ci = cluster_bootstrap_ci(creator_gaps, n_boot=2000)

    print("\nRegression Parameters:")
    print(f"  All 100K+ posts (N={len(df_100k)}):")
    print(f"    Carousel Coeff: {m_full.params['media_carousel']:+.4f} (p={m_full.pvalues['media_carousel']:.2e})")
    print(f"    Video Coeff   : {m_full.params['media_video']:+.4f} (p={m_full.pvalues['media_video']:.2e})")
    print(f"    Raw Gap (C - V): {m_full.params['media_carousel'] - m_full.params['media_video']:+.4f}")

    print(f"\n  Restricted 30-180 Days (N={len(df_window)}):")
    print(f"    Carousel Coeff: {m_win.params['media_carousel']:+.4f} (p={m_win.pvalues['media_carousel']:.4f})")
    print(f"    Video Coeff   : {m_win.params['media_video']:+.4f} (p={m_win.pvalues['media_video']:.2e})")
    print(f"    Raw Gap (C - V): {m_win.params['media_carousel'] - m_win.params['media_video']:+.4f}")

    print(f"\n  Restricted 30-180 Days + log(age) Covariate (N={len(df_window)}):")
    print(f"    Carousel Coeff: {m_cov.params['media_carousel']:+.4f} (p={m_cov.pvalues['media_carousel']:.4f})")
    print(f"    Video Coeff   : {m_cov.params['media_video']:+.4f} (p={m_cov.pvalues['media_video']:.2e})")
    print(f"    log(age) Coeff: {m_cov.params['log_age']:+.4f} (p={m_cov.pvalues['log_age']:.4f})")
    print(f"    Controlled Gap: {m_cov.params['media_carousel'] - m_cov.params['media_video']:+.4f}")

    print(f"\n  Creator-Clustered Intra-Account Carousel vs Video Gap (N={len(creator_gaps)} creators):")
    print(f"    Mean Gap: {gap_mean:+.4f} [95% Bootstrap CI: {gap_ci[0]:+.4f}, {gap_ci[1]:+.4f}]")

    out_file = os.path.join(REPORTS_DIR, "task4_timewindow_sensitivity.json")
    results = {
        "n_posts_100k_total": len(df_100k),
        "n_posts_30_180d": len(df_window),
        "n_creators_30_180d": len(unique_creators),
        "unrestricted_carousel_coeff": float(m_full.params["media_carousel"]),
        "unrestricted_video_coeff": float(m_full.params["media_video"]),
        "unrestricted_gap": float(m_full.params["media_carousel"] - m_full.params["media_video"]),
        "window_covariate_carousel_coeff": float(m_cov.params["media_carousel"]),
        "window_covariate_video_coeff": float(m_cov.params["media_video"]),
        "window_covariate_log_age_coeff": float(m_cov.params["log_age"]),
        "window_covariate_gap": float(m_cov.params["media_carousel"] - m_cov.params["media_video"]),
        "creator_clustered_gap_mean": float(gap_mean),
        "creator_clustered_gap_ci_95": [float(gap_ci[0]), float(gap_ci[1])],
        "effects_survive": bool(m_cov.params["media_carousel"] > 0 and m_cov.params["media_video"] < 0 and gap_ci[0] > 0)
    }

    with open(out_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved Task 4 results to {out_file}")

if __name__ == "__main__":
    main()
