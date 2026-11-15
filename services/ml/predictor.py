import os
import json
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from db import get_supabase
from config import LOCAL_STORAGE_DIR

def get_follower_bucket(followers: int) -> str:
    if followers < 10000:
        return "under 10K"
    elif followers <= 100000:
        return "10K-100K"
    elif followers <= 1000000:
        return "100K-1M"
    else:
        return "over 1M"

def get_local_models_list():
    models_path = os.path.join(LOCAL_STORAGE_DIR, "models.json")
    if os.path.exists(models_path):
        try:
            with open(models_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []

class Predictor:
    def predict(
        self,
        handle: str,
        caption: str = "",
        media_type: str = "image",
        planned_time: str = None
    ) -> dict:
        clean_handle = handle.lower().replace("@", "")
        followers = 10000

        # 1. Load creator profile for followers
        local_prof_path = os.path.join(LOCAL_STORAGE_DIR, "profiles", f"{clean_handle}.json")
        if os.path.exists(local_prof_path):
            try:
                with open(local_prof_path, "r", encoding="utf-8") as f:
                    prof_data = json.load(f)
                    followers = prof_data.get("followers_count") or prof_data.get("followersCount") or 10000
            except Exception:
                pass

        follower_bucket = get_follower_bucket(followers)

        # 2. Check latest model in models.json
        local_models = get_local_models_list()
        latest_model_info = None
        for m in local_models:
            if m.get("model_type") == "global" and m.get("algorithm") == "lightgbm_deviation":
                latest_model_info = m
                break

        if not latest_model_info:
            # Fallback to any global model
            for m in local_models:
                if m.get("model_type") == "global":
                    latest_model_info = m
                    break

        if not latest_model_info:
            raise ValueError("No trained global model available in storage/models.json.")

        # Load artifact
        artifact_path = os.path.join(LOCAL_STORAGE_DIR, "model-artifacts", latest_model_info["artifact_path"])
        bundle = joblib.load(artifact_path)
        model = bundle["model"]
        feature_names = bundle.get("feature_names", [])
        bucket_means = bundle.get("bucket_means", {})
        fallback_bucket_mean = bucket_means.get(follower_bucket, -4.5)

        # 3. Calculate trailing history features strictly from prior posts of this creator
        posts_file = os.path.join(LOCAL_STORAGE_DIR, "posts", f"{clean_handle}.json")
        prior_log_ers = []
        last_post_dt = None

        if os.path.exists(posts_file):
            try:
                with open(posts_file, "r", encoding="utf-8") as f:
                    creator_posts = json.load(f)
                if isinstance(creator_posts, list) and len(creator_posts) > 0:
                    # Sort chronologically
                    df_p = pd.DataFrame(creator_posts)
                    df_p["dt"] = pd.to_datetime(df_p.get("postedAt", df_p.get("posted_at")), utc=True, errors="coerce")
                    df_p = df_p.dropna(subset=["dt"]).sort_values(by="dt")

                    for _, p in df_p.iterrows():
                        l = p.get("likesCount") if p.get("likesCount") is not None else p.get("likes_count")
                        c = p.get("commentsCount") if p.get("commentsCount") is not None else p.get("comments_count")
                        if l is not None and c is not None and followers > 0:
                            er = float(l + c) / float(followers)
                            prior_log_ers.append(np.log(er) if er > 0 else -10.0)
                    if len(df_p) > 0:
                        last_post_dt = df_p["dt"].iloc[-1]
            except Exception:
                pass

        num_prior = len(prior_log_ers)
        if num_prior >= 3:
            has_history = True
            prev_10 = prior_log_ers[-10:]
            prev_3 = prior_log_ers[-3:]
            prev_10_mean = float(np.mean(prev_10))
            prev_10_std = float(np.std(prev_10)) if len(prev_10) > 1 else 0.0
            prev_3_mean = float(np.mean(prev_3))
        else:
            has_history = False
            prev_10_mean = fallback_bucket_mean
            prev_10_std = 0.0
            prev_3_mean = fallback_bucket_mean

        # Planned date / time
        if planned_time:
            dt = pd.to_datetime(planned_time, utc=True, errors="coerce")
            if pd.isna(dt):
                dt = pd.to_datetime(datetime.utcnow(), utc=True)
        else:
            dt = pd.to_datetime(datetime.utcnow(), utc=True)

        post_hour = dt.hour
        post_weekday = dt.weekday()
        hour_sin = np.sin(2 * np.pi * post_hour / 24.0)
        hour_cos = np.cos(2 * np.pi * post_hour / 24.0)

        if last_post_dt is not None:
            diff_sec = (dt - last_post_dt).total_seconds()
            days_since_prev = max(0.0, float(diff_sec) / 86400.0)
        else:
            days_since_prev = 1.0

        # Caption & hashtags
        cap_str = str(caption or "")
        caption_len = len(cap_str)
        hashtag_cnt = len([t for t in cap_str.split() if t.startswith("#")])

        # Media type one-hot
        m_lower = str(media_type or "image").lower()
        media_image = 1 if m_lower in ["image", "photo"] else 0
        media_reel = 1 if m_lower == "reel" else 0
        media_video = 1 if m_lower in ["video", "clip"] else 0
        media_carousel = 1 if m_lower == "carousel" else 0
        media_story = 1 if m_lower == "story" else 0

        feature_dict = {
            "media_image": media_image,
            "media_reel": media_reel,
            "media_video": media_video,
            "media_carousel": media_carousel,
            "media_story": media_story,
            "hour_sin": hour_sin,
            "hour_cos": hour_cos,
            "post_weekday": post_weekday,
            "caption_length": caption_len,
            "hashtag_count": hashtag_cnt,
            "prev_10_std": prev_10_std,
            "prev_3_mean": prev_3_mean,
            "num_prior_posts": num_prior,
            "days_since_prev": days_since_prev,
            "has_history": 1 if has_history else 0
        }

        X_input = pd.DataFrame([[feature_dict.get(fn, 0.0) for fn in feature_names]], columns=feature_names)
        pred_deviation = float(model.predict(X_input)[0])
        pred_log_er = prev_10_mean + pred_deviation
        pred_er = float(np.exp(pred_log_er))

        if has_history:
            confidence_note = f"Prediction anchored on creator's previous {min(10, num_prior)} posts (mean log(ER): {prev_10_mean:.3f}) with AI schedule/content deviation adjustment ({pred_deviation:+.3f})."
        else:
            confidence_note = f"Low creator history ({num_prior} prior posts). Anchored on {follower_bucket} follower bucket mean ({prev_10_mean:.3f}) with AI schedule/content deviation adjustment ({pred_deviation:+.3f})."

        return {
            "predicted_engagement_rate": round(pred_er, 6),
            "predicted_log_er": round(pred_log_er, 4),
            "predicted_deviation": round(pred_deviation, 4),
            "previous_10_mean": round(prev_10_mean, 4),
            "model_id": latest_model_info.get("id"),
            "model_used": latest_model_info.get("algorithm", "lightgbm_deviation"),
            "model_version": latest_model_info.get("version"),
            "has_history": has_history,
            "num_prior_posts": num_prior,
            "follower_bucket": follower_bucket,
            "confidence_note": confidence_note
        }
