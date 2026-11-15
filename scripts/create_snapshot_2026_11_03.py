import os
import json
import hashlib
import pandas as pd
import numpy as np
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
PROFILES_SRC = os.path.join(STORAGE_DIR, "profiles")
POSTS_SRC = os.path.join(STORAGE_DIR, "posts")

RAW_SNAP_DIR = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03")
CLEAN_SNAP_DIR = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean")

os.makedirs(os.path.join(RAW_SNAP_DIR, "profiles"), exist_ok=True)
os.makedirs(os.path.join(RAW_SNAP_DIR, "posts"), exist_ok=True)
os.makedirs(os.path.join(CLEAN_SNAP_DIR, "profiles"), exist_ok=True)
os.makedirs(os.path.join(CLEAN_SNAP_DIR, "posts"), exist_ok=True)

snapshot_time = datetime.now()
snapshot_dt = pd.to_datetime(snapshot_time.isoformat(), utc=True)
cutoff_dt = snapshot_dt - pd.Timedelta(days=7)

print(f"Creating frozen snapshot 2026-11-03 at {snapshot_dt.isoformat()}...")
print(f"7-day exclusion cutoff datetime: {cutoff_dt.isoformat()}")

# 1. Create raw snapshot 2026-11-03
raw_manifest_files = []
profile_files = sorted([f for f in os.listdir(PROFILES_SRC) if f.endswith(".json")])

for pf in profile_files:
    handle = pf.replace(".json", "")
    src_prof = os.path.join(PROFILES_SRC, pf)
    dst_prof = os.path.join(RAW_SNAP_DIR, "profiles", pf)
    with open(src_prof, "r", encoding="utf-8") as f:
        content = f.read()
    with open(dst_prof, "w", encoding="utf-8") as f:
        f.write(content)
    sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    raw_manifest_files.append({
        "type": "profile",
        "handle": handle,
        "path": f"profiles/{pf}",
        "sha256": sha,
        "size_bytes": len(content.encode("utf-8"))
    })

post_files = sorted([f for f in os.listdir(POSTS_SRC) if f.endswith(".json")])
total_raw_posts = 0
for pf in post_files:
    handle = pf.replace(".json", "")
    src_post = os.path.join(POSTS_SRC, pf)
    dst_post = os.path.join(RAW_SNAP_DIR, "posts", pf)
    with open(src_post, "r", encoding="utf-8") as f:
        content = f.read()
    with open(dst_post, "w", encoding="utf-8") as f:
        f.write(content)
    sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    try:
        p_list = json.loads(content)
        p_cnt = len(p_list) if isinstance(p_list, list) else 0
    except:
        p_cnt = 0
    total_raw_posts += p_cnt
    raw_manifest_files.append({
        "type": "posts",
        "handle": handle,
        "path": f"posts/{pf}",
        "sha256": sha,
        "size_bytes": len(content.encode("utf-8")),
        "posts_count": p_cnt
    })

raw_manifest = {
    "snapshot_name": "2026-11-03",
    "created_at": snapshot_dt.isoformat(),
    "total_creators": len(profile_files),
    "total_posts": total_raw_posts,
    "files": raw_manifest_files
}
with open(os.path.join(RAW_SNAP_DIR, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(raw_manifest, f, indent=2)
print(f"Raw snapshot 2026-11-03 written: {len(profile_files)} profiles, {total_raw_posts} posts.")

# 2. Filter exclusions for 2026-11-03-clean
exclusion_logs = []
clean_posts_by_handle = {}
clean_profiles_by_handle = {}

total_inspected_posts = 0

for pf in profile_files:
    handle = pf.replace(".json", "")
    p_path = os.path.join(PROFILES_SRC, pf)
    with open(p_path, "r", encoding="utf-8") as f:
        pdata = json.load(f)

    # Filter 1: test/demo creators
    if any(term in handle.lower() for term in ["test", "demo", "sample"]):
        exclusion_logs.append({
            "type": "creator",
            "handle": handle,
            "reason": "test_or_demo_creator"
        })
        continue

    # Filter 2: missing/zero followers
    followers = pdata.get("followers_count") or pdata.get("followersCount")
    if not followers or followers <= 0:
        exclusion_logs.append({
            "type": "creator",
            "handle": handle,
            "reason": "missing_or_zero_followers"
        })
        continue

    post_file = os.path.join(POSTS_SRC, f"{handle}.json")
    if not os.path.exists(post_file):
        continue

    with open(post_file, "r", encoding="utf-8") as f:
        posts = json.load(f)

    if not isinstance(posts, list) or len(posts) == 0:
        continue

    parsed_posts = []
    for idx, p in enumerate(posts):
        total_inspected_posts += 1
        sc = p.get("shortcode") or p.get("code")
        ts = p.get("postedAt") or p.get("posted_at")
        likes = p.get("likesCount") if p.get("likesCount") is not None else p.get("likes_count")
        comments = p.get("commentsCount") if p.get("commentsCount") is not None else p.get("comments_count")

        if not sc or not ts or likes is None or comments is None:
            exclusion_logs.append({
                "type": "post",
                "handle": handle,
                "shortcode": sc or f"unknown_{idx}",
                "reason": "missing_required_metrics_or_timestamp"
            })
            continue

        p_dt = pd.to_datetime(ts, utc=True)
        parsed_posts.append({
            "orig_idx": idx,
            "shortcode": sc,
            "posted_dt": p_dt,
            "raw_post": p
        })

    # Pinned post detection rule:
    # Instagram returns feed newest-first. A pinned post is positioned at index 0, 1, or 2
    # but has a timestamp older than any subsequent post in positions up to index + 3.
    pinned_flags = [False] * len(parsed_posts)
    for i in range(min(3, len(parsed_posts))):
        cur_dt = parsed_posts[i]["posted_dt"]
        if any(cur_dt < parsed_posts[j]["posted_dt"] for j in range(i + 1, min(len(parsed_posts), i + 4))):
            pinned_flags[i] = True
            exclusion_logs.append({
                "type": "post",
                "handle": handle,
                "shortcode": parsed_posts[i]["shortcode"],
                "position_in_list": parsed_posts[i]["orig_idx"],
                "timestamp": cur_dt.isoformat(),
                "reason": "pinned_post_out_of_order_top_grid"
            })

    kept_posts = []
    for i, p_entry in enumerate(parsed_posts):
        if pinned_flags[i]:
            continue
        if p_entry["posted_dt"] > cutoff_dt:
            exclusion_logs.append({
                "type": "post",
                "handle": handle,
                "shortcode": p_entry["shortcode"],
                "timestamp": p_entry["posted_dt"].isoformat(),
                "reason": "less_than_7_days_old_at_snapshot_time"
            })
            continue
        kept_posts.append(p_entry["raw_post"])

    if len(kept_posts) > 0:
        clean_posts_by_handle[handle] = kept_posts
        clean_profiles_by_handle[handle] = pdata

print(f"Total clean creators: {len(clean_profiles_by_handle)}")
print(f"Total clean posts kept: {sum(len(v) for v in clean_posts_by_handle.values())}")
print(f"Total exclusions logged: {len(exclusion_logs)}")

# Write to storage/snapshots/2026-11-03-clean
clean_manifest_files = []
for handle, pdata in clean_profiles_by_handle.items():
    prof_path = os.path.join(CLEAN_SNAP_DIR, "profiles", f"{handle}.json")
    content = json.dumps(pdata, indent=2)
    with open(prof_path, "w", encoding="utf-8") as f:
        f.write(content)
    sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    clean_manifest_files.append({
        "type": "profile",
        "handle": handle,
        "path": f"profiles/{handle}.json",
        "sha256": sha,
        "size_bytes": len(content.encode("utf-8"))
    })

for handle, posts in clean_posts_by_handle.items():
    post_path = os.path.join(CLEAN_SNAP_DIR, "posts", f"{handle}.json")
    content = json.dumps(posts, indent=2)
    with open(post_path, "w", encoding="utf-8") as f:
        f.write(content)
    sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    clean_manifest_files.append({
        "type": "posts",
        "handle": handle,
        "path": f"posts/{handle}.json",
        "sha256": sha,
        "size_bytes": len(content.encode("utf-8")),
        "posts_count": len(posts)
    })

with open(os.path.join(CLEAN_SNAP_DIR, "exclusion_log.json"), "w", encoding="utf-8") as f:
    json.dump(exclusion_logs, f, indent=2)

clean_manifest = {
    "snapshot_name": "2026-11-03-clean",
    "created_at": snapshot_dt.isoformat(),
    "base_snapshot": "2026-11-03",
    "7_day_cutoff": cutoff_dt.isoformat(),
    "total_creators": len(clean_profiles_by_handle),
    "total_posts": sum(len(v) for v in clean_posts_by_handle.values()),
    "total_exclusions": len(exclusion_logs),
    "exclusion_summary": {
        "pinned_posts": len([e for e in exclusion_logs if e.get("reason") == "pinned_post_out_of_order_top_grid"]),
        "recent_posts": len([e for e in exclusion_logs if e.get("reason") == "less_than_7_days_old_at_snapshot_time"]),
        "test_creators": len([e for e in exclusion_logs if e.get("reason") == "test_or_demo_creator"]),
        "missing_metrics": len([e for e in exclusion_logs if e.get("reason") == "missing_required_metrics_or_timestamp"]),
    },
    "files": clean_manifest_files
}
with open(os.path.join(CLEAN_SNAP_DIR, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(clean_manifest, f, indent=2)

print(f"Clean snapshot saved to {CLEAN_SNAP_DIR}")
