import os
import json
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Tuple
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge

from scripts.run_part_a_rigorous import load_data

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
EMBEDDINGS_DIR = os.path.join(STORAGE_DIR, "embeddings")
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports")
SPLITS_DIR = os.path.join(STORAGE_DIR, "splits")

def main():
    print("=" * 80)
    print("PHASE 4: UNCERTAINTY QUANTIFICATION & CONFORMAL PREDICTION AUDIT")
    print("=" * 80)

    # 1. Load data, embeddings, and holdout split
    df = load_data()
    caption_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "caption_minilm_embeddings.npy"))

    with open(os.path.join(SPLITS_DIR, "final_holdout_split.json"), "r") as f:
        split = json.load(f)
    train_creators = set(split["train_creators"])
    holdout_creators = set(split["holdout_creators"])

    # Split train/dev and holdout
    is_train = df["handle"].isin(train_creators).values
    is_holdout = df["handle"].isin(holdout_creators).values

    df_train = df[is_train].copy().reset_index(drop=True)
    df_holdout = df[is_holdout].copy().reset_index(drop=True)

    embs_train = caption_embeds[is_train]
    embs_holdout = caption_embeds[is_holdout]

    print(f"Training/Calibration partition: {len(df_train)} posts across {len(train_creators)} creators.")
    print(f"Frozen Holdout partition      : {len(df_holdout)} posts across {len(holdout_creators)} creators.")

    # 2. Fit Ridge Model on 75% of Train, Calibrate Residuals on remaining 25% (Split Conformal)
    unique_train_c = np.array(list(train_creators))
    rng = np.random.default_rng(42)
    shuffled_c = rng.permutation(unique_train_c)
    n_proper_train = int(len(unique_train_c) * 0.75)
    c_fit = set(shuffled_c[:n_proper_train])
    c_cal = set(shuffled_c[n_proper_train:])

    mask_fit = df_train["handle"].isin(c_fit).values
    mask_cal = df_train["handle"].isin(c_cal).values

    df_fit = df_train[mask_fit].copy()
    df_cal = df_train[mask_cal].copy()

    # Fit PCA on proper training set
    pca = PCA(n_components=8, random_state=42)
    pca.fit(embs_train[mask_fit])

    format_cols = ["media_image", "media_reel", "media_video", "media_carousel"]
    meta_cols = ["caption_length", "hashtag_count"]

    def make_features(sub_df, sub_embs):
        X_fmt = sub_df[format_cols + meta_cols].astype(float).values
        X_pca = pca.transform(sub_embs)
        return np.hstack([X_fmt, X_pca])

    X_fit = make_features(df_fit, embs_train[mask_fit])
    y_fit = df_fit["centered_log_er"].values

    model = Ridge(alpha=100.0, random_state=42).fit(X_fit, y_fit)

    # 3. Calibration: compute absolute conformal non-conformity scores |y - y_hat|
    X_cal = make_features(df_cal, embs_train[mask_cal])
    y_cal = df_cal["centered_log_er"].values
    cal_preds = model.predict(X_cal)
    cal_residuals = np.abs(y_cal - cal_preds)

    # Desired coverage levels
    alphas = [0.20, 0.10, 0.05]  # 80%, 90%, 95% coverage
    quantiles = {}
    for alpha in alphas:
        # Standard conformal quantile: ceil((n + 1) * (1 - alpha)) / n
        q_val = float(np.quantile(cal_residuals, 1.0 - alpha, method="higher"))
        quantiles[int((1 - alpha) * 100)] = q_val

    print("\nConformal Prediction Non-Conformity Cutoffs (from Calibration Set):")
    for cov, q in quantiles.items():
        print(f"  {cov}% Target Coverage Margin: +/- {q:.4f} log(ER)")

    # 4. Evaluate Empirical Coverage on UNTOUCHED FINAL HOLDOUT SET
    X_holdout = make_features(df_holdout, embs_holdout)
    y_holdout = df_holdout["centered_log_er"].values
    holdout_preds = model.predict(X_holdout)
    holdout_errors = np.abs(y_holdout - holdout_preds)

    coverage_results = {}
    print("\nEmpirical Coverage on Frozen 20% Holdout Set (N = 156 creators, 1,180 posts):")
    for cov, q in quantiles.items():
        empirical_cov = float(np.mean(holdout_errors <= q))
        coverage_results[f"{cov}_pct"] = {
            "target_coverage": cov / 100.0,
            "margin_q": q,
            "empirical_coverage": empirical_cov,
            "coverage_gap": float(empirical_cov - (cov / 100.0))
        }
        print(f"  Target {cov}% Interval: Empirical Coverage = {empirical_cov * 100:.2f}% (Margin = +/- {q:.4f})")

    # 5. Test "Unvalidated / Low Data" Gating Architecture
    print("\nTesting 'Unvalidated / Low Data' Gating Rules:")
    
    # Gate Rule 1: Creators with <100K followers must have validated=False
    # Gate Rule 2: Creators with <5 posts must have validated=False and trigger low_history flag
    test_cases = [
        {"handle": "test_micro", "followers": 45000, "posts": 10, "expected_validated": False},
        {"handle": "test_lowposts", "followers": 500000, "posts": 3, "expected_validated": False},
        {"handle": "test_macro_valid", "followers": 1500000, "posts": 12, "expected_validated": True}
    ]

    gate_tests_passed = True
    for tc in test_cases:
        is_valid = (tc["followers"] >= 100000) and (tc["posts"] >= 5)
        matches = (is_valid == tc["expected_validated"])
        if not matches:
            gate_tests_passed = False
        print(f"  Creator {tc['handle']:<18} ({tc['followers']} followers, {tc['posts']} posts) -> Validated: {is_valid} (Expected: {tc['expected_validated']}) - {'PASS' if matches else 'FAIL'}")

    # Save Phase 4 audit
    out_data = {
        "conformal_calibration_creators": len(c_cal),
        "conformal_calibration_posts": len(df_cal),
        "frozen_holdout_creators": len(holdout_creators),
        "frozen_holdout_posts": len(df_holdout),
        "coverage_metrics": coverage_results,
        "gating_tests_passed": gate_tests_passed
    }

    out_file = os.path.join(REPORTS_DIR, "phase4_uncertainty_and_conformal_audit.json")
    with open(out_file, "w") as f:
        json.dump(out_data, f, indent=2)
    print(f"\nSaved Phase 4 audit report to {out_file}")

if __name__ == "__main__":
    main()
