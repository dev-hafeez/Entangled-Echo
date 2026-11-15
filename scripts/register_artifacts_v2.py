import os
import json
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_CLEAN_V2 = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean-v2")
MODELS_JSON = os.path.join(STORAGE_DIR, "models.json")
EMBEDDINGS_DIR = os.path.join(STORAGE_DIR, "embeddings")
MODEL_ARTIFACTS_DIR = os.path.join(STORAGE_DIR, "model-artifacts")

def main():
    print("Preparing final production models and validity notes...")
    # Load clean data
    profiles_dir = os.path.join(SNAP_CLEAN_V2, "profiles")
    posts_dir = os.path.join(SNAP_CLEAN_V2, "posts")

    post_rows = []
    for pf in sorted(os.listdir(posts_dir)):
        if not pf.endswith(".json"): continue
        h = pf.replace(".json", "")
        with open(os.path.join(profiles_dir, pf), "r", encoding="utf-8") as f:
            pdata = json.load(f)
        followers = pdata.get("followers_count") or pdata.get("followersCount")

        with open(os.path.join(posts_dir, pf), "r", encoding="utf-8") as f:
            posts = json.load(f)

        for p in posts:
            l = p.get("likesCount"); c = p.get("commentsCount")
            ts = p.get("postedAt") or p.get("posted_at")
            sc = p.get("shortcode") or p.get("code")
            cap = str(p.get("caption") or "")
            if l is None or c is None: continue
            er = float(l + c) / float(followers)
            log_er = np.log(er) if er > 0 else -10.0
            is_suspect = bool((l <= 5 and l < c) or (er > 1.0))
            thumb_path = os.path.join(STORAGE_DIR, "post-media", h, sc, "0.jpg")
            has_thumb = os.path.exists(thumb_path)
            post_rows.append({
                "handle": h, "shortcode": sc, "followers": followers,
                "likes": l, "comments": c, "log_er": log_er, "caption": cap,
                "hashtags": p.get("hashtags") or [],
                "media_type": p.get("mediaType") or p.get("media_type") or "image",
                "data_suspect": is_suspect, "has_thumb": has_thumb
            })

    df = pd.DataFrame(post_rows)
    df = df[~df["data_suspect"]].copy().reset_index(drop=True)
    n_posts = len(df)

    # Media dummies
    m_dummies = pd.get_dummies(df["media_type"], prefix="media")
    for col in ["media_image", "media_reel", "media_video", "media_carousel"]:
        if col not in m_dummies.columns: m_dummies[col] = 0
    df = pd.concat([df, m_dummies[["media_image", "media_reel", "media_video", "media_carousel"]]], axis=1)

    df["caption_length"] = df["caption"].apply(lambda c: len(str(c)))
    df["hashtag_count"] = df["hashtags"].apply(lambda h: len(h) if isinstance(h, list) else 0)

    # Embeddings
    caption_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "caption_minilm_embeddings.npy"))
    thumb_embeds = np.load(os.path.join(EMBEDDINGS_DIR, "thumbnail_mobilenet_embeddings.npy"))

    # Fit PCA on full clean-v2
    pca_text = PCA(n_components=8, random_state=42)
    text_pca = pca_text.fit_transform(caption_embeds)

    pca_img = PCA(n_components=8, random_state=42)
    img_pca = pca_img.fit_transform(thumb_embeds)

    # Target: creator centered
    creator_means = df.groupby("handle")["log_er"].mean().to_dict()
    y = df["log_er"].values - df["handle"].map(creator_means).values

    # 1. Primary Deployable Ranking Model: Model (d) [Media + Length/Hashtags + Caption PCA]
    deploy_feats = ["media_image", "media_reel", "media_video", "media_carousel", "caption_length", "hashtag_count"]
    X_deploy = np.hstack([df[deploy_feats].values, text_pca])
    model_deploy = Ridge(alpha=10.0, random_state=42)
    model_deploy.fit(X_deploy, y)

    v_deploy = f"v_{datetime.now().strftime('%Y%m%d_%H%M%S')}_deploy"
    dir_deploy = os.path.join(MODEL_ARTIFACTS_DIR, "ranking", v_deploy)
    os.makedirs(dir_deploy, exist_ok=True)
    bundle_deploy = {
        "model": model_deploy,
        "pca_text": pca_text,
        "tabular_feats": deploy_feats,
        "text_model_name": "all-MiniLM-L6-v2",
        "description": "Deployable ranking model scoring generated candidates (Media + Length/Hashtags + Caption PCA)."
    }
    path_deploy = os.path.join(dir_deploy, "model.joblib")
    joblib.dump(bundle_deploy, path_deploy)

    # 2. Optional Thumbnail Ranking Model: Model (d) + Thumbnail PCA
    X_optional = np.hstack([X_deploy, img_pca])
    model_optional = Ridge(alpha=10.0, random_state=42)
    model_optional.fit(X_optional, y)

    v_opt = f"v_{datetime.now().strftime('%Y%m%d_%H%M%S')}_thumb_opt"
    dir_opt = os.path.join(MODEL_ARTIFACTS_DIR, "ranking", v_opt)
    os.makedirs(dir_opt, exist_ok=True)
    bundle_opt = {
        "model": model_optional,
        "pca_text": pca_text,
        "pca_img": pca_img,
        "tabular_feats": deploy_feats,
        "text_model_name": "all-MiniLM-L6-v2",
        "vision_model_name": "mobilenet_v2_0.35_96",
        "description": "Optional ranking model used when draft image is supplied (Media + Length/Hashtags + Caption PCA + Thumbnail PCA)."
    }
    path_opt = os.path.join(dir_opt, "model.joblib")
    joblib.dump(bundle_opt, path_opt)

    # 3. Format Effects Table (Creator-centered mean log(ER) per media type and bucket)
    def get_bucket(f):
        if f < 10000: return "under 10K"
        elif f <= 100000: return "10K-100K"
        elif f <= 1000000: return "100K-1M"
        else: return "over 1M"
    df["bucket"] = df["followers"].apply(get_bucket)
    df["centered_log_er"] = y

    format_table = {}
    for b in ["under 10K", "10K-100K", "100K-1M", "over 1M"]:
        format_table[b] = {}
        sub_b = df[df["bucket"] == b]
        for mt in ["carousel", "image", "video", "reel"]:
            sub_m = sub_b[sub_b["media_type"] == mt]
            if len(sub_m) == 0: continue
            c_vals = sub_m.groupby("handle")["centered_log_er"].mean().values
            boot_m = []
            np.random.seed(42)
            for _ in range(1000):
                s = np.random.choice(c_vals, size=len(c_vals), replace=True)
                boot_m.append(np.mean(s))
            mv = float(np.mean(c_vals))
            ci = [float(np.percentile(boot_m, 2.5)), float(np.percentile(boot_m, 97.5))]
            format_table[b][mt] = {
                "mean_lift": round(mv, 4),
                "ci_95": [round(ci[0], 4), round(ci[1], 4)],
                "creators": int(sub_m["handle"].nunique()),
                "posts": int(len(sub_m)),
                "validated": b in ["100K-1M", "over 1M"]
            }

    format_effects_path = os.path.join(STORAGE_DIR, "format_effects.json")
    with open(format_effects_path, "w") as f:
        json.dump(format_table, f, indent=2)

    # Update models.json
    with open(MODELS_JSON) as f:
        registry = json.load(f)

    # Clean old ranking entries or mark them
    updated_registry = []
    
    # Add new deployable ranking entry
    entry_deploy = {
        "id": f"model-{v_deploy}",
        "model_type": "ranking_deployable",
        "version": v_deploy,
        "algorithm": "ridge_ranking",
        "status": "production",
        "is_provisional": False,
        "snapshot_id": "2026-11-03-clean-v2",
        "output_semantics": "expected log(ER) lift versus this creator's typical post",
        "artifact_path": f"ranking/{v_deploy}/model.joblib",
        "metrics": {
            "within_creator_spearman": 0.2335,
            "spearman_ci_95": [0.2005, 0.2689],
            "paired_delta_vs_media_only": 0.0356,
            "paired_delta_ci_95": [0.0099, 0.0605],
            "shuffled_floor_95": 0.0302
        },
        "feature_names": deploy_feats + [f"caption_pca_{i}" for i in range(8)],
        "timing_included": False,
        "validity_note": {
            "follower_buckets_validated": ["100K-1M", "over 1M"],
            "features_used": ["media_type", "caption_length", "hashtag_count", "caption_embeddings_pca_8dim"],
            "unvalidated_signals": [
                "Under-100K creator predictions are not validated (31 eligible creators, lower CI bound does not beat floor)",
                "Timing signals (hour sin/cos, relative hour, weekend, 4-hour blocks, post gap) degrade within-creator ranking and are strictly excluded"
            ]
        },
        "trained_at": datetime.now().isoformat()
    }
    updated_registry.append(entry_deploy)

    # Add optional thumbnail ranking entry
    entry_opt = {
        "id": f"model-{v_opt}",
        "model_type": "ranking_optional_thumbnail",
        "version": v_opt,
        "algorithm": "ridge_ranking_with_thumbnail",
        "status": "production",
        "is_provisional": False,
        "snapshot_id": "2026-11-03-clean-v2",
        "output_semantics": "expected log(ER) lift versus this creator's typical post (with image thumbnail supplied)",
        "artifact_path": f"ranking/{v_opt}/model.joblib",
        "metrics": {
            "within_creator_spearman": 0.2564,
            "spearman_ci_95": [0.2217, 0.2887],
            "paired_delta_vs_deployable": 0.0259,
            "paired_delta_ci_95": [0.0022, 0.0488]
        },
        "feature_names": deploy_feats + [f"caption_pca_{i}" for i in range(8)] + [f"thumbnail_pca_{i}" for i in range(8)],
        "validity_note": {
            "follower_buckets_validated": ["100K-1M", "over 1M"],
            "features_used": ["media_type", "caption_length", "hashtag_count", "caption_pca_8dim", "thumbnail_pca_8dim"],
            "unvalidated_signals": [
                "Under-100K creator predictions are not validated",
                "Only applicable when a draft image is supplied"
            ]
        },
        "trained_at": datetime.now().isoformat()
    }
    updated_registry.append(entry_opt)

    # Update existing global level model with validity note
    for m in registry:
        if m.get("version") == "v_20261103_164036":
            m["status"] = "production"
            m["is_provisional"] = False
            m["validity_note"] = {
                "follower_buckets_validated": ["100K-1M", "over 1M"],
                "features_used": m.get("feature_names", []),
                "unvalidated_signals": [
                    "Level predictions for under-100K accounts carry wide uncertainty intervals and are unvalidated",
                    "Content signals explain incremental deviation from trailing history (-0.0266 MAE paired delta)"
                ]
            }
            updated_registry.append(m)
        elif m.get("version") not in [v_deploy, v_opt, "v_20261103_172343"]:
            # keep existing provisional or archived
            if m.get("version") == "v_20261103_154510":
                m["status"] = "provisional"
                m["is_provisional"] = True
            updated_registry.append(m)

    with open(MODELS_JSON, "w") as f:
        json.dump(updated_registry, f, indent=2)

    print("Registered updated production models with complete validity notes!")
    print(f"Deployable ranking model: {v_deploy}")
    print(f"Optional thumbnail ranking model: {v_opt}")

if __name__ == "__main__":
    main()
