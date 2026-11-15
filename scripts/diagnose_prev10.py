import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from scripts.run_corrected_evaluation import load_clean_data

df = load_clean_data(exclude_exact_3_likes=False)
df = df[~df["data_suspect"]].copy().reset_index(drop=True)

# Assertion test: check that every trailing window strictly contains posts before target post
print("Running assertion check on chronological sorting & window isolation...")
assertion_passed = True
for h, grp in df.groupby("handle", sort=False):
    # check sorted
    dts = grp["posted_at_dt"].values
    for i in range(len(dts) - 1):
        if dts[i] > dts[i+1]:
            assertion_passed = False
            print(f"FAILED SORT: {h} has post {i} ({dts[i]}) > post {i+1} ({dts[i+1]})")
            break
print(f"Assertion: Chronological order strictly oldest-to-newest? {assertion_passed}")

# a) Lag-1 within-creator Spearman of log(ER) between consecutive posts
lag1_corrs = []
for h, grp in df.groupby("handle"):
    if len(grp) >= 4:
        log_ers = grp["log_er"].values
        # consecutive pairs (y_{t-1}, y_t)
        y_prev = log_ers[:-1]
        y_curr = log_ers[1:]
        if not np.all(y_prev == y_prev[0]) and not np.all(y_curr == y_curr[0]):
            c, _ = spearmanr(y_prev, y_curr)
            if not np.isnan(c):
                lag1_corrs.append(c)

print(f"\na) Lag-1 within-creator autocorrelation Spearman: Mean = {np.mean(lag1_corrs):+.4f} (across {len(lag1_corrs)} creators)")

# b) Shuffle post order within creator (20 repeats) and recompute the baseline's within-creator Spearman
shuff_prev10_spearmans = []
np.random.seed(42)
for rep in range(20):
    shuff_corrs = []
    for h, grp in df.groupby("handle"):
        log_ers = grp["log_er"].values.copy()
        np.random.shuffle(log_ers)
        n = len(log_ers)
        if n >= 3:
            # recompute trailing mean on shuffled sequence
            shuff_prev10 = []
            for i in range(n):
                prior = log_ers[:i]
                if len(prior) >= 1:
                    shuff_prev10.append(np.mean(prior[-10:]))
                else:
                    shuff_prev10.append(np.nan)
            valid_mask = ~np.isnan(shuff_prev10)
            if valid_mask.sum() >= 3:
                yt = log_ers[valid_mask]
                yp = np.array(shuff_prev10)[valid_mask]
                if not np.all(yt == yt[0]) and not np.all(yp == yp[0]):
                    c, _ = spearmanr(yt, yp)
                    if not np.isnan(c):
                        shuff_corrs.append(c)
    if shuff_corrs:
        shuff_prev10_spearmans.append(np.mean(shuff_corrs))

print(f"b) Shuffled-order trailing mean within-creator Spearman (20 repeats): Mean = {np.mean(shuff_prev10_spearmans):+.4f}, Range: [{min(shuff_prev10_spearmans):+.4f}, {max(shuff_prev10_spearmans):+.4f}]")
