import requests
import json
import os
import sys

def smoke_test():
    base_url = "http://127.0.0.1:8001"
    
    # 1. 100K+ Creator (djokernole: 17,000,000 followers)
    print("\n--- Test 1: Real Multi-Format 100K+ Creator (djokernole) ---")
    gen_payload = {
        "handle": "djokernole",
        "topic": "Grand Slam Preparation & High Performance Recovery",
        "n_candidates": 6
    }
    r_gen = requests.post(f"{base_url}/api/candidates/generate", json=gen_payload)
    print("Generate status:", r_gen.status_code)
    gen_data = r_gen.json()
    print(f"Generated {gen_data['count']} candidates spanning formats: {[c['media_type'] for c in gen_data['candidates']]}")
    
    opt_payload = {
        "handle": "djokernole",
        "candidates": gen_data["candidates"],
        "posts_per_week": 4,
        "solver": "simulated_annealing"
    }
    r_opt = requests.post(f"{base_url}/api/optimize", json=opt_payload)
    print("Optimize status:", r_opt.status_code)
    opt_data = r_opt.json()
    print("Optimizer validation label:", opt_data["validation_status"])
    print(f"Selected {len(opt_data['scheduled_posts'])} posts (Energy: {opt_data['energy']:.4f}, Feasible: {opt_data['feasible']}):")
    for p in opt_data["scheduled_posts"]:
        print(f"  Day: {p.get('assigned_day'):<9} | Time: {p.get('assigned_time')} | Format: {p.get('media_type'):<8} | Lift: {p.get('predicted_lift', 0.0):+.3f} | Status: {p.get('validation_status')} | {p.get('caption')[:60]}...")

    # 2. Under 100K Creator (edgyhegel: 71,000 followers)
    print("\n--- Test 2: Real Under 100K Creator (edgyhegel) ---")
    gen_payload_u = {
        "handle": "edgyhegel",
        "topic": "Dialectics breakdown and philosophy meme culture",
        "n_candidates": 6
    }
    r_gen_u = requests.post(f"{base_url}/api/candidates/generate", json=gen_payload_u)
    print("Generate status:", r_gen_u.status_code)
    gen_data_u = r_gen_u.json()
    print(f"Generated {gen_data_u['count']} candidates spanning formats: {[c['media_type'] for c in gen_data_u['candidates']]}")
    
    opt_payload_u = {
        "handle": "edgyhegel",
        "candidates": gen_data_u["candidates"],
        "posts_per_week": 3,
        "solver": "simulated_annealing"
    }
    r_opt_u = requests.post(f"{base_url}/api/optimize", json=opt_payload_u)
    print("Optimize status:", r_opt_u.status_code)
    opt_data_u = r_opt_u.json()
    print("Optimizer validation label:", opt_data_u["validation_status"])
    print(f"Selected {len(opt_data_u['scheduled_posts'])} posts (Energy: {opt_data_u['energy']:.4f}, Feasible: {opt_data_u['feasible']}):")
    for p in opt_data_u["scheduled_posts"]:
        print(f"  Day: {p.get('assigned_day'):<9} | Time: {p.get('assigned_time')} | Format: {p.get('media_type'):<8} | Lift: {p.get('predicted_lift', 0.0):+.3f} | Status: {p.get('validation_status')} | Notes: {p.get('notes')} | {p.get('caption')[:50]}...")

if __name__ == "__main__":
    smoke_test()
