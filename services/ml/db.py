import os
import glob
import json
import shutil
from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOCAL_STORAGE_DIR, MODEL_ARTIFACTS_DIR
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
    """
    Fetches training data directly from local storage/profiles/ and storage/posts/
    with instant zero-timeout parsing. Falls back to Supabase only if local data is absent.
    """
    clean_handle = handle.lower().replace("@", "") if handle else None
    profiles_dir = os.path.join(LOCAL_STORAGE_DIR, "profiles")
    posts_dir = os.path.join(LOCAL_STORAGE_DIR, "posts")

    rows = []

    if os.path.exists(profiles_dir) and os.path.exists(posts_dir):
        profile_files = glob.glob(os.path.join(profiles_dir, "*.json"))
        for pf in profile_files:
            try:
                with open(pf, "r", encoding="utf-8") as f:
                    prof = json.load(f)
                h = (prof.get("handle") or os.path.basename(pf).replace(".json", "")).lower()

                if clean_handle and h != clean_handle:
                    continue

                followers = prof.get("followers_count") or 0
                if followers <= 0:
                    continue

                post_file = os.path.join(posts_dir, f"{h}.json")
                if not os.path.exists(post_file):
                    continue

                with open(post_file, "r", encoding="utf-8") as f:
                    posts = json.load(f)

                if not isinstance(posts, list):
                    continue

                for p in posts:
                    likes = p.get("likes_count") if p.get("likes_count") is not None else p.get("likesCount")
                    comments = p.get("comments_count") if p.get("comments_count") is not None else p.get("commentsCount")
                    if likes is None or comments is None:
                        continue

                    engagement_rate = float(likes + comments) / float(followers)
                    media_type = p.get("media_type") or p.get("mediaType") or "image"
                    posted_at = p.get("posted_at") or p.get("postedAt")
                    shortcode = p.get("shortcode") or ""
                    caption = p.get("caption") or ""
                    hashtags = p.get("hashtags") or []
                    mentions = p.get("mentions") or []
                    carousel_size = p.get("carousel_size") or p.get("carouselSize") or 0
                    views = p.get("views_count") if p.get("views_count") is not None else p.get("viewsCount")

                    rows.append({
                        "post_id": p.get("id") or f"{h}_{shortcode}",
                        "account_id": prof.get("id") or h,
                        "handle": h,
                        "shortcode": shortcode,
                        "media_type": media_type,
                        "caption": caption,
                        "hashtags": hashtags,
                        "mentions": mentions,
                        "posted_at": posted_at,
                        "carousel_size": carousel_size,
                        "likes_count": likes,
                        "comments_count": comments,
                        "views_count": views,
                        "followers_count": followers,
                        "target_engagement_rate": engagement_rate
                    })
            except Exception as e:
                print(f"[ml-storage] Warning parsing {pf}: {e}")

    if rows:
        print(f"[ml-storage] Loaded {len(rows)} posts from local disk for training (filter: {clean_handle or 'all'}).")
        return pd.DataFrame(rows)

    # Fallback to Supabase if local files are missing
    try:
        supabase = get_supabase()
        acc_query = supabase.table("accounts").select("id, handle, followers_count")
        if clean_handle:
            acc_query = acc_query.eq("handle", clean_handle)
        
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

        db_rows = []
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

            db_rows.append({
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

        return pd.DataFrame(db_rows)
    except Exception as e:
        print(f"[ml-db] Supabase training data fetch failed: {e}")
        return pd.DataFrame()

def upload_model_artifact(local_file_path: str, storage_path: str) -> str:
    """
    Saves model artifact directly to local disk in storage/model-artifacts/
    eliminating Supabase Storage quota usage and network overhead.
    """
    dest_path = os.path.join(MODEL_ARTIFACTS_DIR, storage_path)
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    if os.path.abspath(local_file_path) != os.path.abspath(dest_path):
        shutil.copy2(local_file_path, dest_path)
    print(f"[ml-storage] Successfully saved model artifact to local disk: {dest_path}")
    return storage_path

def download_model_artifact(storage_path: str, local_file_path: str):
    """
    Retrieves model artifact from local disk in storage/model-artifacts/
    with fallback to Supabase Storage only if not found locally.
    """
    local_source = os.path.join(MODEL_ARTIFACTS_DIR, storage_path)
    os.makedirs(os.path.dirname(local_file_path), exist_ok=True)
    
    if os.path.exists(local_source):
        if os.path.abspath(local_source) != os.path.abspath(local_file_path):
            shutil.copy2(local_source, local_file_path)
        print(f"[ml-storage] Loaded model artifact from local disk: {local_source}")
        return

    # Fallback to Supabase if local not present
    try:
        supabase = get_supabase()
        data = supabase.storage.from_("model-artifacts").download(storage_path)
        with open(local_file_path, "wb") as f:
            f.write(data)
        # Also cache locally to MODEL_ARTIFACTS_DIR
        os.makedirs(os.path.dirname(local_source), exist_ok=True)
        with open(local_source, "wb") as f:
            f.write(data)
    except Exception as e:
        raise FileNotFoundError(f"Model artifact not found locally at {local_source} and download failed: {e}")
