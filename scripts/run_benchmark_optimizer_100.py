import os
import time
import json
import numpy as np
import pandas as pd
from typing import Dict, Any, List
from services.ml.candidate_generator import CandidateGenerator
from services.ml.optimizer import ScheduleOptimizer

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
EMBEDDINGS_DIR = os.path.join(STORAGE_DIR, "embeddings")
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports")

def main():
    print("="*80)
    print("ITEM 7: RIGOROUS SOLVER BENCHMARK (100 INSTANCES PER SIZE)")
    print("="*80)

    caption_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "caption_minilm_embeddings.npy"))

    real_captions = []
    real_tags = []
    posts_dir = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean-v2", "posts")
    for pf in sorted(os.listdir(posts_dir))[:35]:
        with open(os.path.join(posts_dir, pf), "r") as f:
            for p in json.load(f):
                c = str(p.get("caption") or "")
                t = p.get("hashtags") or []
                if len(c) > 10: real_captions.append(c)
                if t: real_tags.append(t)
    
    print(f"Loaded {len(real_captions)} real captions and {len(real_tags)} hashtag sets.")

    np.random.seed(42)
    empirical_scores_pool = np.random.normal(loc=0.05, scale=0.28, size=1000)
    gen = CandidateGenerator(seed=42)

    optimizer = ScheduleOptimizer(
        posts_per_week=4,
        min_spacing_hours=18,
        penalty_k=12.0,
        penalty_spacing=10.0,
        penalty_similarity=6.0,
        penalty_format=5.0,
        penalty_hashtag_budget=4.0
    )

    sizes = [10, 20, 40, 80]
    n_instances = 100
    results = []

    def calc_boot(arr, n_boot=1000):
        arr = np.array(arr)
        means = [np.mean(np.random.choice(arr, size=len(arr), replace=True)) for _ in range(n_boot)]
        return float(np.mean(arr)), (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))

    for N in sizes:
        print(f"\nEvaluating N = {N} candidates over {n_instances} instances...")
        sa_better_count = 0
        tied_count = 0
        sa_worse_count = 0

        obj_gaps = []       # SA energy - Greedy energy (negative = SA is better)
        bf_gaps_sa = []     # SA energy - Brute Force energy
        bf_gaps_gr = []     # Greedy energy - Brute Force energy
        sa_times = []
        gr_times = []

        for inst in range(n_instances):
            sub_caps = [real_captions[(inst * N + i) % len(real_captions)] for i in range(N)]
            sub_tags = [real_tags[(inst * N + i) % len(real_tags)] for i in range(N)]
            
            candidates = gen.generate_candidate_pool(
                n_candidates=N,
                follower_count=350000,
                sample_captions=sub_caps,
                sample_hashtags=sub_tags
            )

            inst_scores = np.random.choice(empirical_scores_pool, size=N, replace=True).tolist()

            emb_idx = [(inst * N + i) % len(caption_embeds) for i in range(N)]
            sub_emb = caption_embeds[emb_idx]
            norms = np.linalg.norm(sub_emb, axis=1, keepdims=True)
            norms = np.maximum(norms, 1e-8)
            normed_emb = sub_emb / norms
            sim_matrix = normed_emb @ normed_emb.T

            # Run Simulated Annealing
            t0 = time.perf_counter()
            res_sa = optimizer.solve_simulated_annealing(
                candidates,
                custom_scores=inst_scores,
                custom_sim_matrix=sim_matrix,
                num_reads=100,
                num_sweeps=300,
                seed=inst
            )
            t_sa = (time.perf_counter() - t0) * 1000.0
            sa_times.append(t_sa)

            # Run Greedy
            t0 = time.perf_counter()
            res_gr = optimizer.solve_greedy(
                candidates,
                custom_scores=inst_scores,
                custom_sim_matrix=sim_matrix
            )
            t_gr = (time.perf_counter() - t0) * 1000.0
            gr_times.append(t_gr)

            e_sa = res_sa["energy"]
            e_gr = res_gr["energy"]
            gap = e_sa - e_gr
            obj_gaps.append(gap)

            if gap < -1e-4:
                sa_better_count += 1
            elif gap > 1e-4:
                sa_worse_count += 1
            else:
                tied_count += 1

            if N <= 20:
                res_bf = optimizer.solve_brute_force(
                    candidates,
                    custom_scores=inst_scores,
                    custom_sim_matrix=sim_matrix
                )
                bf_gaps_sa.append(e_sa - res_bf["energy"])
                bf_gaps_gr.append(e_gr - res_bf["energy"])

        m_gap, ci_gap = calc_boot(obj_gaps, 1000)
        m_sa_t = np.mean(sa_times)
        m_gr_t = np.mean(gr_times)

        if N <= 20:
            m_bf_sa, ci_bf_sa = calc_boot(bf_gaps_sa, 1000)
            m_bf_gr, ci_bf_gr = calc_boot(bf_gaps_gr, 1000)
            bf_sa_str = f"{m_bf_sa:.4f} [{ci_bf_sa[0]:.4f}, {ci_bf_sa[1]:.4f}]"
            bf_gr_str = f"{m_bf_gr:.4f} [{ci_bf_gr[0]:.4f}, {ci_bf_gr[1]:.4f}]"
        else:
            bf_sa_str = "N/A (>20)"
            bf_gr_str = "N/A (>20)"

        res_row = {
            "N": N,
            "SA_Better_Pct": f"{sa_better_count / n_instances * 100:.1f}%",
            "Tied_Pct": f"{tied_count / n_instances * 100:.1f}%",
            "SA_Worse_Pct": f"{sa_worse_count / n_instances * 100:.1f}%",
            "Mean_Objective_Gap (SA - Greedy)": f"{m_gap:+.4f} [{ci_gap[0]:+.4f}, {ci_gap[1]:+.4f}]",
            "SA_Optimality_Gap_vs_BruteForce": bf_sa_str,
            "Greedy_Optimality_Gap_vs_BruteForce": bf_gr_str,
            "SA_Time_ms": f"{m_sa_t:.1f} ms",
            "Greedy_Time_ms": f"{m_gr_t:.1f} ms"
        }
        results.append(res_row)

        print(f"Results for N = {N}:")
        print(f"  SA Better: {res_row['SA_Better_Pct']} | Tied: {res_row['Tied_Pct']} | SA Worse: {res_row['SA_Worse_Pct']}")
        print(f"  Mean Objective Gap: {res_row['Mean_Objective_Gap (SA - Greedy)']}")
        if N <= 20:
            print(f"  SA Optimality Gap vs Exact     : {res_row['SA_Optimality_Gap_vs_BruteForce']}")
            print(f"  Greedy Optimality Gap vs Exact : {res_row['Greedy_Optimality_Gap_vs_BruteForce']}")
        print(f"  Runtime: SA = {res_row['SA_Time_ms']} | Greedy = {res_row['Greedy_Time_ms']}")

    df_out = pd.DataFrame(results)
    df_out.to_markdown(os.path.join(REPORTS_DIR, "optimizer_rigorous_100_benchmark.md"), index=False)
    print(f"\nSaved benchmark table to reports/optimizer_rigorous_100_benchmark.md")

if __name__ == "__main__":
    main()
