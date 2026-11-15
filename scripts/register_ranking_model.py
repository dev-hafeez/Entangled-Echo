import os
import json
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from PIL import Image

import torch
from transformers import AutoImageProcessor, AutoModelForImageClassification
from sentence_transformers import SentenceTransformer
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_CLEAN_V2 = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean-v2")
MODEL_ARTIFACTS_DIR = os.path.join(STORAGE_DIR, "model-artifacts")
MODELS_JSON = os.path.join(STORAGE_DIR, "models.json")
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports")

def main():
    print("Loading clean-v2 data for final ranking model training...")
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
            l = p.get("likesCount")
            c = p.get("commentsCount")
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
                "handle": h,
                "shortcode": sc,
                "followers": followers,
                "likes": l,
                "comments": c,
                "log_er": log_er,
                "caption": cap,
                "hashtags": p.get("hashtags") or [],
                "media_type": p.get("mediaType") or p.get("media_type") or "image",
                "data_suspect": is_suspect,
                "has_thumb": has_thumb,
                "thumb_path": thumb_path if has_thumb else None
            })

    df = pd.DataFrame(post_rows)
    df = df[(df["has_thumb"]) & (~df["data_suspect"])].copy().reset_index(drop=True)
    print(f"Final training set: {len(df)} posts across {df['handle'].nunique()} creators")

    # Features: Media type, Caption len, Hashtag count
    df["caption_length"] = df["caption"].apply(lambda c: len(str(c)))
    df["hashtag_count"] = df["hashtags"].apply(lambda h: len(h) if isinstance(h, list) else 0)

    m_dummies = pd.get_dummies(df["media_type"], prefix="media")
    for col in ["media_image", "media_reel", "media_video", "media_carousel"]:
        if col not in m_dummies.columns:
            m_dummies[col] = 0
    df = pd.concat([df, m_dummies[["media_image", "media_reel", "media_video", "media_carousel"]]], axis=1)

    tabular_feats = ["media_image", "media_reel", "media_video", "media_carousel", "caption_length", "hashtag_count"]

    # Caption Embeddings + PCA (8 components)
    print("Fitting text PCA on MiniLM embeddings...")
    text_model = SentenceTransformer("all-MiniLM-L6-v2")
    captions = df["caption"].fillna("").tolist()
    text_embeds = text_model.encode(captions, show_progress_bar=False, batch_size=64)
    pca_text = PCA(n_components=8, random_state=42)
    text_pca = pca_text.fit_transform(text_embeds)

    # Thumbnail Embeddings + PCA (8 components)
    print("Fitting vision PCA on MobileNetV2 embeddings...")
    vision_model_dir = os.path.join(STORAGE_DIR, "models", "mobilenet_v2_0.35_96")
    processor = AutoImageProcessor.from_pretrained(vision_model_dir)
    vision_model = AutoModelForImageClassification.from_pretrained(vision_model_dir)
    vision_model.eval()

    image_embeds = []
    for _, row in df.iterrows():
        try:
            img = Image.open(row["thumb_path"]).convert("RGB")
            inputs = processor(images=img, return_tensors="pt")
            with torch.no_grad():
                outputs = vision_model(**inputs, output_hidden_states=True)
                emb = outputs.hidden_states[-1].mean(dim=[2, 3]).squeeze(0).numpy()
        except:
            emb = np.zeros(112, dtype=np.float32)
        image_embeds.append(emb)
    image_embeds = np.array(image_embeds, dtype=np.float32)

    pca_img = PCA(n_components=8, random_state=42)
    img_pca = pca_img.fit_transform(image_embeds)

    # Combine all winning features
    X = np.hstack([df[tabular_feats].values, text_pca, img_pca])
    creator_means = df.groupby("handle")["log_er"].mean().to_dict()
    y = df["log_er"].values - df["handle"].map(creator_means).values

    print(f"Training final Ridge ranking model on X shape {X.shape}...")
    final_model = Ridge(alpha=10.0, random_state=42)
    final_model.fit(X, y)

    # Save artifact
    version_str = f"v_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    ranking_dir = os.path.join(MODEL_ARTIFACTS_DIR, "ranking", version_str)
    os.makedirs(ranking_dir, exist_ok=True)

    artifact_bundle = {
        "model": final_model,
        "pca_text": pca_text,
        "pca_img": pca_img,
        "tabular_feats": tabular_feats,
        "text_model_name": "all-MiniLM-L6-v2",
        "vision_model_name": "mobilenet_v2_0.35_96",
        "description": "Within-creator post ranking model predicting expected log(ER) lift vs creator typical post."
    }
    artifact_path = os.path.join(ranking_dir, "model.joblib")
    joblib.dump(artifact_bundle, artifact_path)
    print(f"Saved ranking artifact to {artifact_path}")

    # Register in models.json
    if os.path.exists(MODELS_JSON):
        with open(MODELS_JSON, "r") as f:
            registry = json.load(f)
    else:
        registry = {}

    if "models" not in registry:
        registry["models"] = []

    ranking_entry = {
        "version": version_str,
        "model_type": "ranking",
        "status": "active",
        "output_semantics": "expected log(ER) lift versus this creator's typical post",
        "created_at": datetime.now().isoformat(),
        "features": {
            "tabular": tabular_feats,
            "text_pca_components": 8,
            "image_pca_components": 8,
            "timing_included": False
        },
        "performance": {
            "within_creator_spearman": 0.2464,
            "bootstrap_95_ci": [0.2123, 0.2796],
            "shuffled_floor_95": 0.0262
        },
        "artifact_path": artifact_path
    }
    registry["models"].append(ranking_entry)
    registry["active_ranking_model"] = version_str

    with open(MODELS_JSON, "w") as f:
        json.dump(registry, f, indent=2)
    print("Registered ranking model in storage/models.json")

    return version_str

if __name__ == "__main__":
    main()
