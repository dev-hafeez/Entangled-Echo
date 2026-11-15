import time
import numpy as np
import pandas as pd
from typing import Dict, Any, List
from services.ml.candidate_generator import CandidateGenerator
from services.ml.optimizer import ScheduleOptimizer
from services.ml.scorer import ScorerInterface

def run_benchmark():
    sizes = [10, 20, 40, 80]
    n_instances = 15
    k_target = 4
    min_spacing = 18

    # Initialize candidate generator and optimizer
    gen = CandidateGenerator(seed=100)
    optimizer = ScheduleOptimizer(posts_per_week=k_target, min_spacing_hours=min_spacing)

    # 1. Parameter Tuning on Separate Validation Instances
    # Tune annealing parameters (num_reads, num_sweeps)
    print("--- TUNING SIMULATED ANNEALING PARAMETERS ON VALIDATION INSTANCES ---")
    val_instances = [gen.generate_candidate_pool(20, follower_count=200000) for _ in range(5)]
    param_grid = [
        {"num_reads": 50, "num_sweeps": 200},
        {"num_reads": 100, "num_sweeps": 300},
        {"num_reads": 150, "num_sweeps": 500},
        {"num_reads": 200, "num_sweeps": 800}
    ]

    best_params = param_grid[1]
    best_val_energy = float("inf")
    for params in param_grid:
        energies = []
        for v_inst in val_instances:
            res = optimizer.solve_simulated_annealing(
                v_inst,
                num_reads=params["num_reads"],
                num_sweeps=params["num_sweeps"],
                seed=42
            )
            energies.append(res["energy"])
        mean_e = np.mean(energies)
        print(f"Params: {params} -> Mean Validation Energy: {mean_e:.4f}")
        if mean_e < best_val_energy:
            best_val_energy = mean_e
            best_params = params

    print(f"Selected Annealing Parameters: {best_params}\n")

    # 2. Main Benchmark Across Sizes
    print("--- STEP 4A: SOLVER BENCHMARK ON SYNTHETIC INSTANCES ---")
    results = []

    for N in sizes:
        print(f"\nBenchmarking N = {N} Candidates ({n_instances} instances)...")
        sa_energies, sa_times, sa_feasibles = [], [], []
        gr_energies, gr_times, gr_feasibles = [], [], []
        rd_energies, rd_times, rd_feasibles = [], [], []
        bf_energies, bf_times = [], []

        for inst_idx in range(n_instances):
            candidates = gen.generate_candidate_pool(N, follower_count=250000)

            # Simulated Annealing
            t0 = time.perf_counter()
            sa_res = optimizer.solve_simulated_annealing(
                candidates,
                num_reads=best_params["num_reads"],
                num_sweeps=best_params["num_sweeps"],
                seed=42 + inst_idx
            )
            t_sa = (time.perf_counter() - t0) * 1000.0
            sa_energies.append(sa_res["energy"])
            sa_times.append(t_sa)
            sa_feasibles.append(sa_res["feasible"])

            # Greedy
            t0 = time.perf_counter()
            gr_res = optimizer.solve_greedy(candidates)
            t_gr = (time.perf_counter() - t0) * 1000.0
            gr_energies.append(gr_res["energy"])
            gr_times.append(t_gr)
            gr_feasibles.append(gr_res["feasible"])

            # Random
            t0 = time.perf_counter()
            rd_res = optimizer.solve_random(candidates, seed=42 + inst_idx)
            t_rd = (time.perf_counter() - t0) * 1000.0
            rd_energies.append(rd_res["energy"])
            rd_times.append(t_rd)
            rd_feasibles.append(rd_res["feasible"])

            # Brute Force (only for N <= 20)
            if N <= 20:
                t0 = time.perf_counter()
                bf_res = optimizer.solve_brute_force(candidates)
                t_bf = (time.perf_counter() - t0) * 1000.0
                bf_energies.append(bf_res["energy"])
                bf_times.append(t_bf)

        # Compute summary metrics and bootstrap CIs
        def calc_boot_mean(arr):
            boot = [np.mean(np.random.choice(arr, size=len(arr), replace=True)) for _ in range(1000)]
            return float(np.mean(arr)), (float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5)))

        m_sa_e, ci_sa_e = calc_boot_mean(sa_energies)
        m_gr_e, ci_gr_e = calc_boot_mean(gr_energies)
        m_rd_e, ci_rd_e = calc_boot_mean(rd_energies)

        # Delta: SA vs Greedy
        delta_sa_gr = np.array(sa_energies) - np.array(gr_energies)
        m_d_sag, ci_d_sag = calc_boot_mean(delta_sa_gr)

        # Optimality Gap vs Brute Force (N <= 20)
        gap_sa = np.array(sa_energies) - np.array(bf_energies) if N <= 20 else None
        gap_gr = np.array(gr_energies) - np.array(bf_energies) if N <= 20 else None
        m_gap_sa, ci_gap_sa = calc_boot_mean(gap_sa) if gap_sa is not None else (np.nan, (np.nan, np.nan))
        m_gap_gr, ci_gap_gr = calc_boot_mean(gap_gr) if gap_gr is not None else (np.nan, (np.nan, np.nan))

        row = {
            "N": N,
            "SA_Energy": f"{m_sa_e:.3f} [{ci_sa_e[0]:.3f}, {ci_sa_e[1]:.3f}]",
            "Greedy_Energy": f"{m_gr_e:.3f} [{ci_gr_e[0]:.3f}, {ci_gr_e[1]:.3f}]",
            "Random_Energy": f"{m_rd_e:.3f} [{ci_rd_e[0]:.3f}, {ci_rd_e[1]:.3f}]",
            "Delta_SA_vs_Greedy": f"{m_d_sag:+.3f} [{ci_d_sag[0]:+.3f}, {ci_d_sag[1]:+.3f}]",
            "SA_Optimality_Gap": f"{m_gap_sa:.3f} [{ci_gap_sa[0]:.3f}, {ci_gap_sa[1]:.3f}]" if N <= 20 else "N/A (>20)",
            "Greedy_Optimality_Gap": f"{m_gap_gr:.3f} [{ci_gap_gr[0]:.3f}, {ci_gap_gr[1]:.3f}]" if N <= 20 else "N/A (>20)",
            "SA_Time_ms": f"{np.mean(sa_times):.1f} ms",
            "Greedy_Time_ms": f"{np.mean(gr_times):.1f} ms",
            "SA_Feasible_Rate": f"{np.mean(sa_feasibles)*100:.0f}%"
        }
        results.append(row)

        print(f"Results for N={N}:")
        print(f"  SA Energy            : {row['SA_Energy']} (Time: {row['SA_Time_ms']}, Feasible: {row['SA_Feasible_Rate']})")
        print(f"  Greedy Energy        : {row['Greedy_Energy']} (Time: {row['Greedy_Time_ms']})")
        print(f"  Random Energy        : {row['Random_Energy']}")
        print(f"  SA vs Greedy (Delta) : {row['Delta_SA_vs_Greedy']}")
        if N <= 20:
            print(f"  SA Optimality Gap    : {row['SA_Optimality_Gap']}")
            print(f"  Greedy Optimality Gap: {row['Greedy_Optimality_Gap']}")

    df_res = pd.DataFrame(results)
    df_res.to_markdown("reports/optimizer_step4a_benchmark.md", index=False)
    print("\nSaved benchmark results to reports/optimizer_step4a_benchmark.md")

if __name__ == "__main__":
    run_benchmark()
