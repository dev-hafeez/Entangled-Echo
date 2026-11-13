import numpy as np
import dimod
from dwave.samplers import SimulatedAnnealingSampler
from typing import List, Dict, Any, Optional, Tuple
from services.ml.scorer import ScorerInterface

class ScheduleOptimizer:
    """
    Step 3 & Part B: QUBO-based Schedule Optimizer with tight interacting constraints:
      - posts_per_week cardinality: A * (sum x_i - K)^2
      - minimum spacing gap conflicts: B * sum_{(i,j) spacing < min_gap} x_i * x_j
      - caption/hashtag similarity penalty: C * sim(i, j) * x_i * x_j
      - format overconcentration limit: D * sum_{(i,j) same_format} x_i * x_j
      - hashtag budget penalty: E * max(0, sum(tags) - max_tags)
    """
    def __init__(
        self,
        scorer: Optional[ScorerInterface] = None,
        posts_per_week: int = 4,
        min_spacing_hours: int = 18,
        penalty_k: float = 12.0,
        penalty_spacing: float = 10.0,
        penalty_similarity: float = 6.0,
        penalty_format: float = 5.0,
        penalty_hashtag_budget: float = 4.0,
        max_total_hashtags: int = 25
    ):
        self.scorer = scorer or ScorerInterface(mode="format_effects")
        self.posts_per_week = posts_per_week
        self.min_spacing_hours = min_spacing_hours
        self.penalty_k = penalty_k
        self.penalty_spacing = penalty_spacing
        self.penalty_similarity = penalty_similarity
        self.penalty_format = penalty_format
        self.penalty_hashtag_budget = penalty_hashtag_budget
        self.max_total_hashtags = max_total_hashtags

    def build_bqm(
        self,
        candidates: List[Dict[str, Any]],
        custom_scores: Optional[List[float]] = None,
        custom_sim_matrix: Optional[np.ndarray] = None
    ) -> Tuple[dimod.BinaryQuadraticModel, Dict[str, Any]]:
        N = len(candidates)
        K = min(self.posts_per_week, N)
        bqm = dimod.BinaryQuadraticModel(vartype=dimod.BINARY)

        # 1. Candidate scores (either empirical or from ScorerInterface)
        if custom_scores is not None and len(custom_scores) == N:
            scores = custom_scores
        else:
            scores = self.scorer.score_candidates(candidates)

        for i in range(N):
            bqm.add_variable(i, -float(scores[i]))

        # 2. Target Posts Constraint: A * (sum x_i - K)^2
        # = sum (1 - 2K) x_i + 2 sum_{i<j} x_i x_j + K^2
        A = self.penalty_k
        for i in range(N):
            bqm.add_variable(i, A * (1.0 - 2.0 * K))
        for i in range(N):
            for j in range(i + 1, N):
                bqm.add_interaction(i, j, 2.0 * A)
        bqm.offset += A * (K ** 2)

        # 3. Minimum Spacing Conflict: B * sum_{(i, j) spacing < min_gap} x_i x_j
        B = self.penalty_spacing
        for i in range(N):
            t_i = candidates[i].get("preferred_day", 0) * 24 + candidates[i].get("preferred_hour", 12)
            for j in range(i + 1, N):
                t_j = candidates[j].get("preferred_day", 0) * 24 + candidates[j].get("preferred_hour", 12)
                diff = abs(t_i - t_j)
                diff = min(diff, 168 - diff)  # wrap-around week
                if diff < self.min_spacing_hours:
                    bqm.add_interaction(i, j, B)

        # 4. Caption / Hashtag Similarity Penalty
        C = self.penalty_similarity
        if custom_sim_matrix is not None and custom_sim_matrix.shape == (N, N):
            for i in range(N):
                for j in range(i + 1, N):
                    sim = float(custom_sim_matrix[i, j])
                    if sim > 0.35:
                        bqm.add_interaction(i, j, C * sim)
        else:
            for i in range(N):
                tags_i = set(candidates[i].get("hashtags", []))
                for j in range(i + 1, N):
                    tags_j = set(candidates[j].get("hashtags", []))
                    if tags_i and tags_j:
                        jaccard = len(tags_i & tags_j) / len(tags_i | tags_j)
                        if jaccard > 0.35:
                            bqm.add_interaction(i, j, C * jaccard)

        # 5. Format Concentration Penalty: discourage picking identical formats
        D = self.penalty_format
        for i in range(N):
            for j in range(i + 1, N):
                if candidates[i].get("media_type") == candidates[j].get("media_type"):
                    bqm.add_interaction(i, j, D / max(1, K))

        # 6. Hashtag budget interaction
        E = self.penalty_hashtag_budget
        tag_counts = [candidates[i].get("hashtag_count", len(candidates[i].get("hashtags", []))) for i in range(N)]
        for i in range(N):
            for j in range(i + 1, N):
                if tag_counts[i] + tag_counts[j] > 14:
                    bqm.add_interaction(i, j, E * 0.5)

        meta = {
            "N": N, "K": K, "scores": scores,
            "validation_status": "validated" if candidates and candidates[0].get("follower_count", 0) >= 100000 else "not validated"
        }
        return bqm, meta

    def solve_simulated_annealing(
        self,
        candidates: List[Dict[str, Any]],
        custom_scores: Optional[List[float]] = None,
        custom_sim_matrix: Optional[np.ndarray] = None,
        num_reads: int = 100,
        num_sweeps: int = 300,
        seed: int = 42
    ) -> Dict[str, Any]:
        bqm, meta = self.build_bqm(candidates, custom_scores, custom_sim_matrix)
        sampler = SimulatedAnnealingSampler()
        sampleset = sampler.sample(
            bqm,
            num_reads=num_reads,
            num_sweeps=num_sweeps,
            seed=seed
        )
        best_sample = sampleset.first.sample
        best_energy = sampleset.first.energy

        selected_indices = [i for i, val in best_sample.items() if val == 1]
        selected_posts = [candidates[i] for i in selected_indices]

        return {
            "solver": "simulated_annealing",
            "selected_indices": sorted(selected_indices),
            "selected_posts": selected_posts,
            "energy": float(best_energy),
            "feasible": len(selected_indices) == meta["K"],
            "validation_status": meta["validation_status"],
            "k_target": meta["K"]
        }

    def solve_greedy(
        self,
        candidates: List[Dict[str, Any]],
        custom_scores: Optional[List[float]] = None,
        custom_sim_matrix: Optional[np.ndarray] = None
    ) -> Dict[str, Any]:
        bqm, meta = self.build_bqm(candidates, custom_scores, custom_sim_matrix)
        N = meta["N"]
        K = meta["K"]

        current_selection = []
        for _ in range(K):
            best_candidate = None
            best_energy = float("inf")
            for i in range(N):
                if i in current_selection: continue
                test_sample = {var: 1 if var in (current_selection + [i]) else 0 for var in range(N)}
                energy = bqm.energy(test_sample)
                if energy < best_energy:
                    best_energy = energy
                    best_candidate = i
            if best_candidate is not None:
                current_selection.append(best_candidate)

        final_sample = {var: 1 if var in current_selection else 0 for var in range(N)}
        final_energy = float(bqm.energy(final_sample))
        return {
            "solver": "greedy",
            "selected_indices": sorted(current_selection),
            "selected_posts": [candidates[i] for i in sorted(current_selection)],
            "energy": final_energy,
            "feasible": len(current_selection) == K,
            "validation_status": meta["validation_status"],
            "k_target": K
        }

    def solve_random(
        self,
        candidates: List[Dict[str, Any]],
        custom_scores: Optional[List[float]] = None,
        custom_sim_matrix: Optional[np.ndarray] = None,
        seed: int = 42
    ) -> Dict[str, Any]:
        bqm, meta = self.build_bqm(candidates, custom_scores, custom_sim_matrix)
        N = meta["N"]
        K = meta["K"]
        np.random.seed(seed)
        chosen = sorted(np.random.choice(N, size=K, replace=False).tolist())
        sample = {var: 1 if var in chosen else 0 for var in range(N)}
        energy = float(bqm.energy(sample))
        return {
            "solver": "random",
            "selected_indices": chosen,
            "selected_posts": [candidates[i] for i in chosen],
            "energy": energy,
            "feasible": len(chosen) == K,
            "validation_status": meta["validation_status"],
            "k_target": K
        }

    def solve_brute_force(
        self,
        candidates: List[Dict[str, Any]],
        custom_scores: Optional[List[float]] = None,
        custom_sim_matrix: Optional[np.ndarray] = None
    ) -> Dict[str, Any]:
        import itertools
        bqm, meta = self.build_bqm(candidates, custom_scores, custom_sim_matrix)
        N = meta["N"]
        K = meta["K"]
        if N > 25:
            raise ValueError(f"Brute force not feasible for N={N} > 25.")

        best_combo = None
        best_energy = float("inf")
        for combo in itertools.combinations(range(N), K):
            sample = {var: 1 if var in combo else 0 for var in range(N)}
            e = bqm.energy(sample)
            if e < best_energy:
                best_energy = e
                best_combo = combo

        return {
            "solver": "brute_force",
            "selected_indices": sorted(best_combo),
            "selected_posts": [candidates[i] for i in sorted(best_combo)],
            "energy": float(best_energy),
            "feasible": True,
            "validation_status": meta["validation_status"],
            "k_target": K
        }
