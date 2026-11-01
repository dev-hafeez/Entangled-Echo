import os
from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import pandas as pd

_client: Client = None

def get_supabase() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _client

def fetch_training_data(handle: str = None) -> pd.DataFrame:
    supabase = get_supabase()

    acc_query = supabase.table("accounts").select("id, handle, followers_count")
    if handle:
        acc_query = acc_query.eq("handle", handle.lower().replace("@", ""))
    
    acc_res = acc_query.execute()
    accounts = acc_res.data or []
    if not accounts:
        return pd.DataFrame()

    acc_map = {a["id"]: a for a in accounts}
    account_ids = list(acc_map.keys())

    post_res = (
        supabase.table("posts")
        .select("id, account_id, shortcode, media_type, caption, hashtags, mentions, posted_at, carousel_size")
        .in_("account_id", account_ids)
        .execute()
    )
    posts = post_res.data or []
    if not posts:
        return pd.DataFrame()

    post_ids = [p["id"] for p in posts]

    snap_res = (
        supabase.table("post_snapshots")
        .select("post_id, likes_count, comments_count, views_count, collected_at")
        .in_("post_id", post_ids)
        .order("collected_at", desc=True)
        .execute()
    )
    snaps = snap_res.data or []
    
    snap_map = {}
    for s in snaps:
        if s["post_id"] not in snap_map:
            snap_map[s["post_id"]] = s

    rows = []
    for p in posts:
        s = snap_map.get(p["id"])
        if not s:
            continue

        likes = s.get("likes_count")
        comments = s.get("comments_count")
        acc = acc_map.get(p["account_id"], {})
        followers = acc.get("followers_count")

        if likes is None or comments is None or followers is None or followers <= 0:
            continue

        engagement_rate = float(likes + comments) / float(followers)

        rows.append({
            "post_id": p["id"],
            "account_id": p["account_id"],
            "handle": acc.get("handle"),
            "shortcode": p["shortcode"],
            "media_type": p.get("media_type") or "image",
            "caption": p.get("caption") or "",
            "hashtags": p.get("hashtags") or [],
            "mentions": p.get("mentions") or [],
            "posted_at": p.get("posted_at"),
            "carousel_size": p.get("carousel_size") or 0,
            "likes_count": likes,
            "comments_count": comments,
            "views_count": s.get("views_count"),
            "followers_count": followers,
            "target_engagement_rate": engagement_rate
        })

    return pd.DataFrame(rows)

def upload_model_artifact(local_file_path: str, storage_path: str) -> str:
    supabase = get_supabase()
    with open(local_file_path, "rb") as f:
        file_bytes = f.read()
        try:
            supabase.storage.from_("model-artifacts").upload(
                storage_path,
                file_bytes,
                file_options={"upsert": "true", "content-type": "application/octet-stream"}
            )
        except Exception as e:
            print(f"[storage] Artifact upload notice: {e}")
    return storage_path

def download_model_artifact(storage_path: str, local_file_path: str):
    supabase = get_supabase()
    data = supabase.storage.from_("model-artifacts").download(storage_path)
    os.makedirs(os.path.dirname(local_file_path), exist_ok=True)
    with open(local_file_path, "wb") as f:
        f.write(data)
