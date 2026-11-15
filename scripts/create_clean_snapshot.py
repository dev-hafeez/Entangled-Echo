import os
import json
import hashlib
import pandas as pd
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAPSHOT_SRC = os.path.join(PROJECT_ROOT, "storage", "snapshots", "2026-11-02")
SNAPSHOT_DST = os.path.join(PROJECT_ROOT, "storage", "snapshots", "2026-11-02-clean")

os.makedirs(os.path.join(SNAPSHOT_DST, "profiles"), exist_ok=True)
os.makedirs(os.path.join(SNAPSHOT_DST, "posts"), exist_ok=True)

manifest_src_path = os.path.join(SNAPSHOT_SRC, "manifest.json")
with open(manifest_src_path, "r", encoding="utf-8") as f:
    orig_manifest = json.load(f)

snapshot_created_at_str = orig_manifest.get("created_at") or "2026-11-02T13:23:19.910037Z"
snapshot_dt = pd.to_datetime(snapshot_created_at_str, utc=True)
cutoff_dt = snapshot_dt - pd.Timedelta(days=7)

profile_files = sorted([
    f for f in os.listdir(os.path.join(SNAPSHOT_SRC, "profiles"))
    if f.endswith(".json")
])

exclusion_logs = []
clean_posts_by_handle = {}
clean_profiles_by_handle = {}

total_scraped_posts = 0

for pf in profile_files:
    handle = pf.replace(".json", "")
    p_path = os.path.join(SNAPSHOT_SRC, "profiles", pf)
    with open(p_path, "r", encoding="utf-8") as f:
        pdata = json.load(f)

    # 1. Filter: Test or Demo creators
    if any(term in handle.lower() for term in ["test", "demo", "sample"]):
        exclusion_logs.append({
            "type": "creator",
            "handle": handle,
            "reason": "test_or_demo_creator"
        })
        continue

    followers = pdata.get("followers_count")
    if not followers or followers <= 0:
        exclusion_logs.append({
            "type": "creator",
            "handle": handle,
            "reason": "missing_or_zero_followers"
        })
        continue

    post_file = os.path.join(SNAPSHOT_SRC, "posts", f"{handle}.json")
    if not os.path.exists(post_file):
        continue

    with open(post_file, "r", encoding="utf-8") as f:
        posts = json.load(f)

    if not isinstance(posts, list) or len(posts) == 0:
        continue

    # Parse and check pinned
    parsed_posts = []
    for idx, p in enumerate(posts):
        total_scraped_posts += 1
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

print(f"Total initial posts inspected: {total_scraped_posts}")
print(f"Total clean posts kept: {sum(len(v) for v in clean_posts_by_handle.values())}")
print(f"Total clean creators: {len(clean_profiles_by_handle)}")
print(f"Total excluded items logged: {len(exclusion_logs)}")

# Write to storage/snapshots/2026-11-02-clean
manifest_files = []

for handle, pdata in clean_profiles_by_handle.items():
    prof_path = os.path.join(SNAPSHOT_DST, "profiles", f"{handle}.json")
    content = json.dumps(pdata, indent=2)
    with open(prof_path, "w", encoding="utf-8") as f:
        f.write(content)
    sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
    manifest_files.append({
        "type": "profile",
        "handle": handle,
        "path": f"profiles/{handle}.json",
        "sha256": sha256,
        "size_bytes": len(content.encode("utf-8"))
    })

for handle, posts in clean_posts_by_handle.items():
    post_path = os.path.join(SNAPSHOT_DST, "posts", f"{handle}.json")
    content = json.dumps(posts, indent=2)
    with open(post_path, "w", encoding="utf-8") as f:
        f.write(content)
    sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
    manifest_files.append({
        "type": "posts",
        "handle": handle,
        "path": f"posts/{handle}.json",
        "sha256": sha256,
        "size_bytes": len(content.encode("utf-8")),
        "posts_count": len(posts)
    })

exclusion_log_path = os.path.join(SNAPSHOT_DST, "exclusion_log.json")
with open(exclusion_log_path, "w", encoding="utf-8") as f:
    json.dump(exclusion_logs, f, indent=2)

manifest_payload = {
    "snapshot_name": "2026-11-02-clean",
    "created_at": datetime.now().isoformat(),
    "base_snapshot": "2026-11-02",
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
    "files": manifest_files
}

manifest_dst_path = os.path.join(SNAPSHOT_DST, "manifest.json")
with open(manifest_dst_path, "w", encoding="utf-8") as f:
    json.dump(manifest_payload, f, indent=2)

print("Saved clean snapshot manifest to:", manifest_dst_path)
