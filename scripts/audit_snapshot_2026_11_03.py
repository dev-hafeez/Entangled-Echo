import os
import glob
import json
import numpy as np
import pandas as pd

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_CLEAN_DIR = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean")
SNAP_RAW_DIR = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03")
JOBS_FILE = os.path.join(STORAGE_DIR, "jobs.json")

def get_follower_bucket(followers: int) -> str:
    if followers < 10000:
        return "under 10K"
    elif followers <= 100000:
        return "10K-100K"
    elif followers <= 1000000:
        return "100K-1M"
    else:
        return "over 1M"

# 1. Load clean snapshot
profiles_dir = os.path.join(SNAP_CLEAN_DIR, "profiles")
posts_dir = os.path.join(SNAP_CLEAN_DIR, "posts")

creator_rows = []
post_rows = []

for pf in sorted(os.listdir(posts_dir)):
    if not pf.endswith(".json"):
        continue
    h = pf.replace(".json", "")
    with open(os.path.join(profiles_dir, pf), "r", encoding="utf-8") as f:
        pdata = json.load(f)
    followers = pdata.get("followers_count") or pdata.get("followersCount")
    following = pdata.get("following_count") or 0
    bucket = get_follower_bucket(followers)

    with open(os.path.join(posts_dir, pf), "r", encoding="utf-8") as f:
        posts = json.load(f)

    creator_rows.append({
        "handle": h,
        "followers_count": followers,
        "follower_bucket": bucket,
        "posts_count": len(posts)
    })

    for p in posts:
        likes = p.get("likesCount") if p.get("likesCount") is not None else p.get("likes_count")
        comments = p.get("commentsCount") if p.get("commentsCount") is not None else p.get("comments_count")
        ts = p.get("postedAt") or p.get("posted_at")
        sc = p.get("shortcode") or p.get("code")
        v = p.get("scraper_version") or p.get("scraperVersion") or "v1.0.0-legacy"
        cap = str(p.get("caption") or "")

        er = float(likes + comments) / float(followers)
        post_rows.append({
            "handle": h,
            "shortcode": sc,
            "followers_count": followers,
            "follower_bucket": bucket,
            "likes": likes,
            "comments": comments,
            "engagement_rate": er,
            "posted_at": ts,
            "caption": cap,
            "hashtags": p.get("hashtags") or [],
            "media_type": p.get("mediaType") or p.get("media_type") or "image",
            "scraper_version": v
        })

df_creators = pd.DataFrame(creator_rows)
df_posts = pd.DataFrame(post_rows)

print("=== AUDIT PART 1: SNAPSHOT 2026-11-03-CLEAN ===")
print(f"Total clean creators: {len(df_creators)}")
print(f"Total clean posts: {len(df_posts)}")
posts_per_creator = df_creators["posts_count"]
print(f"Posts per creator -> Min: {posts_per_creator.min()}, Median: {posts_per_creator.median()}, Max: {posts_per_creator.max()}")

ge_30 = df_creators[df_creators["posts_count"] >= 30]
print(f"Creators with >= 30 usable posts: {len(ge_30)}")

print("\n--- Follower Bucket Distribution (Creators) ---")
print(df_creators["follower_bucket"].value_counts())

print("\n--- Follower Bucket Distribution (Posts) ---")
print(df_posts["follower_bucket"].value_counts())

print("\n--- Posts per Scraper Version ---")
print(df_posts["scraper_version"].value_counts())

# Jobs audit
with open(JOBS_FILE, "r", encoding="utf-8") as f:
    jobs = json.load(f)

job_status_counts = pd.Series([j.get("status") for j in jobs]).value_counts()
print("\n--- Jobs Status Counts ---")
print(job_status_counts)

partial_reasons = {}
failed_reasons = {}
for j in jobs:
    st = j.get("status")
    r = j.get("failure_reason") or j.get("error") or "unknown"
    if st == "partial":
        partial_reasons[r] = partial_reasons.get(r, 0) + 1
    elif st == "failed":
        failed_reasons[r] = failed_reasons.get(r, 0) + 1
print(f"Partial job reasons: {partial_reasons}")
print(f"Failed job reasons: {failed_reasons}")

# Null rates
null_rates = {}
for col in ["shortcode", "posted_at", "likes", "comments", "caption", "media_type", "hashtags"]:
    null_count = df_posts[col].isna().sum() + (df_posts[col] == "").sum() if col in ["caption", "shortcode"] else df_posts[col].isna().sum()
    null_rates[col] = float(null_count) / len(df_posts)
print("\n--- Null Rates per Field ---")
for col, rate in null_rates.items():
    print(f"  {col}: {rate*100:.2f}% ({int(rate*len(df_posts))}/{len(df_posts)})")

# Light integrity guards
print("\n=== LIGHT INTEGRITY GUARDS ===")
likes_series = df_posts["likes"].dropna().astype(int)
hist_0_20 = likes_series[(likes_series >= 0) & (likes_series <= 20)].value_counts().sort_index().to_dict()
print("Likes 0-20 histogram:", hist_0_20)

likes_lt_comments = df_posts[df_posts["likes"] < df_posts["comments"]]
print(f"Posts where likes < comments: {len(likes_lt_comments)}")

audio_caption_terms = ["original audio", "original sound", "audio track", "son original", "suono originale"]
audio_captions = df_posts[df_posts["caption"].str.strip().str.lower().isin(audio_caption_terms)]
print(f"Captions that are audio labels: {len(audio_captions)}")

er_gt_1 = df_posts[df_posts["engagement_rate"] > 1.0]
print(f"Posts with ER > 1.0: {len(er_gt_1)}")

suspect_mask = ((df_posts["likes"] <= 5) & (df_posts["likes"] < df_posts["comments"])) | (df_posts["engagement_rate"] > 1.0)
print(f"Total data_suspect flagged posts: {suspect_mask.sum()} ({suspect_mask.sum()/len(df_posts)*100:.2f}%)")

top_25_er = df_posts.sort_values(by="engagement_rate", ascending=False).head(25)
print("\nTop 5 posts by ER:")
for _, r in top_25_er.head(5).iterrows():
    print(f"  @{r['handle']} | shortcode: {r['shortcode']} | likes: {r['likes']} | comments: {r['comments']} | followers: {r['followers_count']} | ER: {r['engagement_rate']:.4f}")

