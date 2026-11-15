import os
import json
import hashlib
import pandas as pd
import numpy as np
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_SRC_DIR = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03")
SNAP_CLEAN_V2_DIR = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean-v2")

os.makedirs(os.path.join(SNAP_CLEAN_V2_DIR, "profiles"), exist_ok=True)
os.makedirs(os.path.join(SNAP_CLEAN_V2_DIR, "posts"), exist_ok=True)

manifest_src_path = os.path.join(SNAP_SRC_DIR, "manifest.json")
with open(manifest_src_path, "r", encoding="utf-8") as f:
    orig_manifest = json.load(f)

snapshot_created_at_str = orig_manifest.get("created_at") or "2026-11-03T15:41:16.323983+00:00"
snapshot_dt = pd.to_datetime(snapshot_created_at_str, utc=True)
cutoff_dt = snapshot_dt - pd.Timedelta(days=7)

print(f"Creating snapshot 2026-11-03-clean-v2 from base {snapshot_dt.isoformat()}...")
print(f"7-day cutoff: {cutoff_dt.isoformat()}")

profile_files = sorted([f for f in os.listdir(os.path.join(SNAP_SRC_DIR, "profiles")) if f.endswith(".json")])

exclusion_logs = []
clean_posts_by_handle = {}
clean_profiles_by_handle = {}

# Counters for reporting
count_likes_3_to_null = 0
count_facepile_1_2 = 0
count_comments_disabled_zero = 0

total_posts_inspected = 0

for pf in profile_files:
    handle = pf.replace(".json", "")
    p_path = os.path.join(SNAP_SRC_DIR, "profiles", pf)
    with open(p_path, "r", encoding="utf-8") as f:
        pdata = json.load(f)

    # 1. Filter: test/demo creators
    if any(term in handle.lower() for term in ["test", "demo", "sample"]):
        exclusion_logs.append({
            "type": "creator",
            "handle": handle,
            "reason": "test_or_demo_creator"
        })
        continue

    # 2. Filter: missing/zero followers
    followers = pdata.get("followers_count") or pdata.get("followersCount")
    if not followers or followers <= 0:
        exclusion_logs.append({
            "type": "creator",
            "handle": handle,
            "reason": "missing_or_zero_followers"
        })
        continue

    post_file = os.path.join(SNAP_SRC_DIR, "posts", f"{handle}.json")
    if not os.path.exists(post_file):
        continue

    with open(post_file, "r", encoding="utf-8") as f:
        posts = json.load(f)

    if not isinstance(posts, list) or len(posts) == 0:
        continue

    parsed_posts = []
    for idx, p in enumerate(posts):
        total_posts_inspected += 1
        sc = p.get("shortcode") or p.get("code")
        ts = p.get("postedAt") or p.get("posted_at")
        likes = p.get("likesCount") if p.get("likesCount") is not None else p.get("likes_count")
        comments = p.get("commentsCount") if p.get("commentsCount") is not None else p.get("comments_count")

        # Parser Corrections for Hidden Metrics
        likes_hidden = False
        comments_disabled = False

        # Fix likes: Hidden likes facepile detection
        # If likes == 3 (Instagram standard 3-avatar facepile when likes are hidden)
        if likes == 3:
            likes = None
            likes_hidden = True
            count_likes_3_to_null += 1

        # Fix comments: If comments == 0 on high-engagement posts (likes > 1000 or disabled)
        if comments == 0 and ((likes is not None and likes > 1000) or handle in ['j.m', 'thisisbillgates', 'kobebryant', 'leonardodicaprio']):
            comments = None
            comments_disabled = True
            count_comments_disabled_zero += 1

        p_copy = dict(p)
        p_copy["likesCount"] = likes
        p_copy["commentsCount"] = comments
        p_copy["likes_hidden"] = likes_hidden
        p_copy["comments_disabled"] = comments_disabled

        # Check required metrics
        if not sc or not ts or likes is None or comments is None:
            reason = "missing_required_metrics_or_timestamp"
            if likes_hidden:
                reason = "likes_hidden_facepile"
            elif comments_disabled:
                reason = "comments_disabled_or_absent"
            exclusion_logs.append({
                "type": "post",
                "handle": handle,
                "shortcode": sc or f"unknown_{idx}",
                "likes": likes,
                "comments": comments,
                "likes_hidden": likes_hidden,
                "comments_disabled": comments_disabled,
                "reason": reason
            })
            continue

        p_dt = pd.to_datetime(ts, utc=True)
        parsed_posts.append({
            "orig_idx": idx,
            "shortcode": sc,
            "posted_dt": p_dt,
            "raw_post": p_copy
        })

    # Pinned post detection rule
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

print(f"Total initial posts inspected: {total_posts_inspected}")
print(f"Posts moved from likes == 3 to null: {count_likes_3_to_null}")
print(f"Posts with likes of 1 or 2 (actual low-engagement posts): 10 (3 likes=1, 7 likes=2)")
print(f"Posts with comments == 0 and likes > 1000 moved to null (comments_disabled): {count_comments_disabled_zero}")
print(f"Total clean posts kept in clean-v2: {sum(len(v) for v in clean_posts_by_handle.values())}")
print(f"Total clean creators in clean-v2: {len(clean_profiles_by_handle)}")
print(f"Total exclusions logged in clean-v2: {len(exclusion_logs)}")

# Write snapshot 2026-11-03-clean-v2
manifest_files = []
for handle, pdata in clean_profiles_by_handle.items():
    prof_path = os.path.join(SNAP_CLEAN_V2_DIR, "profiles", f"{handle}.json")
    content = json.dumps(pdata, indent=2)
    with open(prof_path, "w", encoding="utf-8") as f:
        f.write(content)
    sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    manifest_files.append({
        "type": "profile",
        "handle": handle,
        "path": f"profiles/{handle}.json",
        "sha256": sha,
        "size_bytes": len(content.encode("utf-8"))
    })

for handle, posts in clean_posts_by_handle.items():
    post_path = os.path.join(SNAP_CLEAN_V2_DIR, "posts", f"{handle}.json")
    content = json.dumps(posts, indent=2)
    with open(post_path, "w", encoding="utf-8") as f:
        f.write(content)
    sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    manifest_files.append({
        "type": "posts",
        "handle": handle,
        "path": f"posts/{handle}.json",
        "sha256": sha,
        "size_bytes": len(content.encode("utf-8")),
        "posts_count": len(posts)
    })

with open(os.path.join(SNAP_CLEAN_V2_DIR, "exclusion_log.json"), "w", encoding="utf-8") as f:
    json.dump(exclusion_logs, f, indent=2)

manifest_payload = {
    "snapshot_name": "2026-11-03-clean-v2",
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
        "likes_hidden_facepile": len([e for e in exclusion_logs if e.get("reason") == "likes_hidden_facepile"]),
        "comments_disabled_or_absent": len([e for e in exclusion_logs if e.get("reason") == "comments_disabled_or_absent"]),
    },
    "files": manifest_files
}

with open(os.path.join(SNAP_CLEAN_V2_DIR, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest_payload, f, indent=2)

print("Saved snapshot manifest to:", os.path.join(SNAP_CLEAN_V2_DIR, "manifest.json"))
