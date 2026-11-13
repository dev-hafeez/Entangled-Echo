import pytest
import os
import json
from services.ml.candidate_generator import CandidateGenerator
from services.ml.optimizer import ScheduleOptimizer
from services.ml.scorer import ScorerInterface

def test_candidate_generator_spans_formats():
    gen = CandidateGenerator(seed=42)
    pool = gen.generate_candidate_pool(n_candidates=10)
    assert len(pool) == 10
    formats = {c["media_type"] for c in pool}
    assert "image" in formats
    assert "reel" in formats
    assert "carousel" in formats

def test_optimizer_feasibility_and_constraints():
    gen = CandidateGenerator(seed=42)
    pool = gen.generate_candidate_pool(n_candidates=15, follower_count=250000)
    optimizer = ScheduleOptimizer(posts_per_week=4, min_spacing_hours=18)
    res = optimizer.solve_simulated_annealing(pool, num_reads=100, num_sweeps=300, seed=42)

    assert res["feasible"] is True
    assert len(res["selected_indices"]) == 4
    assert res["validation_status"] == "validated"

def test_under_100k_labeled_not_validated():
    gen = CandidateGenerator(seed=42)
    pool = gen.generate_candidate_pool(n_candidates=10, follower_count=45000)
    optimizer = ScheduleOptimizer(posts_per_week=3)
    res = optimizer.solve_simulated_annealing(pool, num_reads=50, num_sweeps=100, seed=42)

    assert res["validation_status"] == "not validated"

def test_greedy_and_brute_force_solvers():
    gen = CandidateGenerator(seed=42)
    pool = gen.generate_candidate_pool(n_candidates=8, follower_count=120000)
    optimizer = ScheduleOptimizer(posts_per_week=3)

    greedy_res = optimizer.solve_greedy(pool)
    assert greedy_res["feasible"] is True
    assert len(greedy_res["selected_indices"]) == 3

    exact_res = optimizer.solve_brute_force(pool)
    assert exact_res["feasible"] is True
    assert len(exact_res["selected_indices"]) == 3
    # Exact brute-force must achieve energy <= greedy
    assert exact_res["energy"] <= greedy_res["energy"] + 1e-5

def test_scorer_rejects_provisional_ranking_model():
    with pytest.raises(PermissionError):
        ScorerInterface(mode="ranking_model")
