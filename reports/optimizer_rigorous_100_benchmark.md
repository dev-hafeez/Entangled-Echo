> [!WARNING] SUPERSEDED
> The findings and metrics in this document (e.g. historical +0.0774 lift claims, unadjusted carousel gains, or unvalidated timing claims) are superseded by `docs/EVAL_PROTOCOL.md` and the canonical evaluation results in `reports/canonical_results.md`. Do NOT cite or use numbers from this legacy report.

|   N | SA_Better_Pct   | Tied_Pct   | SA_Worse_Pct   | Mean_Objective_Gap (SA - Greedy)   | SA_Optimality_Gap_vs_BruteForce   | Greedy_Optimality_Gap_vs_BruteForce   | SA_Time_ms   | Greedy_Time_ms   |
|----:|:----------------|:-----------|:---------------|:-----------------------------------|:----------------------------------|:--------------------------------------|:-------------|:-----------------|
|  10 | 43.0%           | 56.0%      | 1.0%           | -1.0378 [-1.5576, -0.6267]         | 0.0009 [-0.0000, 0.0025]          | 1.0387 [0.5968, 1.5131]               | 14.2 ms      | 3.9 ms           |
|  20 | 19.0%           | 24.0%      | 57.0%          | +0.0112 [-0.0663, +0.0790]         | 0.1368 [0.1127, 0.1629]           | 0.1256 [0.0691, 0.2021]               | 31.0 ms      | 10.6 ms          |
|  40 | 2.0%            | 1.0%       | 97.0%          | +0.4256 [+0.3849, +0.4643]         | N/A (>20)                         | N/A (>20)                             | 74.0 ms      | 30.7 ms          |
|  80 | 0.0%            | 1.0%       | 99.0%          | +0.7950 [+0.7257, +0.8567]         | N/A (>20)                         | N/A (>20)                             | 202.1 ms     | 95.5 ms          |