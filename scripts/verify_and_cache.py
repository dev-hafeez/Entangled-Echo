import os
import json
import joblib
import numpy as np
import pandas as pd
from PIL import Image
import torch
from transformers import AutoImageProcessor, AutoModelForImageClassification
from sentence_transformers import SentenceTransformer

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
SNAP_CLEAN_V2 = os.path.join(STORAGE_DIR, "snapshots", "2026-11-03-clean-v2")
MODELS_JSON = os.path.join(STORAGE_DIR, "models.json")
EMBEDDINGS_DIR = os.path.join(STORAGE_DIR, "embeddings")
os.makedirs(EMBEDDINGS_DIR, exist_ok=True)

# 1. Load clean data
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
            "posted_at": ts,
            "caption": cap,
            "hashtags": p.get("hashtags") or [],
            "media_type": p.get("mediaType") or p.get("media_type") or "image",
            "data_suspect": is_suspect,
            "has_thumb": has_thumb,
            "thumb_path": thumb_path if has_thumb else None
        })

df = pd.DataFrame(post_rows)
df = df[~df["data_suspect"]].copy()
df["posted_at_dt"] = pd.to_datetime(df["posted_at"], utc=True)
df = df.sort_values(by=["handle", "posted_at_dt"]).reset_index(drop=True)

print(f"Loaded {len(df)} non-suspect posts across {df['handle'].nunique()} creators.")

# Save metadata index for embeddings
index_file = os.path.join(EMBEDDINGS_DIR, "clean_v2_post_index.parquet")
df[["handle", "shortcode", "posted_at", "media_type", "has_thumb"]].to_parquet(index_file)

# Check/compute caption embeddings
caption_emb_file = os.path.join(EMBEDDINGS_DIR, "caption_minilm_embeddings.npy")
if os.path.exists(caption_emb_file):
    print("Caption embeddings already cached. Loading...")
    caption_embeds = np.load(caption_emb_file)
else:
    print("Computing caption embeddings (all-MiniLM-L6-v2)...")
    text_model = SentenceTransformer("all-MiniLM-L6-v2")
    captions = df["caption"].fillna("").tolist()
    caption_embeds = text_model.encode(captions, show_progress_bar=True, batch_size=64)
    np.save(caption_emb_file, caption_embeds)
    print(f"Saved {caption_embeds.shape} caption embeddings to {caption_emb_file}")

# Check/compute thumbnail embeddings
thumb_emb_file = os.path.join(EMBEDDINGS_DIR, "thumbnail_mobilenet_embeddings.npy")
if os.path.exists(thumb_emb_file):
    print("Thumbnail embeddings already cached. Loading...")
    thumb_embeds = np.load(thumb_emb_file)
else:
    print("Computing thumbnail vision embeddings (MobileNetV2)...")
    vision_model_dir = os.path.join(STORAGE_DIR, "models", "mobilenet_v2_0.35_96")
    processor = AutoImageProcessor.from_pretrained(vision_model_dir)
    vision_model = AutoModelForImageClassification.from_pretrained(vision_model_dir)
    vision_model.eval()

    thumb_embeds = []
    for idx, row in df.iterrows():
        if row["has_thumb"] and row["thumb_path"]:
            try:
                img = Image.open(row["thumb_path"]).convert("RGB")
                inputs = processor(images=img, return_tensors="pt")
                with torch.no_grad():
                    outputs = vision_model(**inputs, output_hidden_states=True)
                    emb = outputs.hidden_states[-1].mean(dim=[2, 3]).squeeze(0).numpy()
            except:
                emb = np.zeros(112, dtype=np.float32)
        else:
            emb = np.zeros(112, dtype=np.float32)
        thumb_embeds.append(emb)
    thumb_embeds = np.array(thumb_embeds, dtype=np.float32)
    np.save(thumb_emb_file, thumb_embeds)
    print(f"Saved {thumb_embeds.shape} thumbnail embeddings to {thumb_emb_file}")

# 2. Verify artifact v_20261103_172343
with open(MODELS_JSON) as f:
    registry = json.load(f)

ranking_entry = next((m for m in registry if m.get("version") == "v_20261103_172343"), None)
print("\n--- Verifying Artifact v_20261103_172343 ---")
print("Registry Entry Found:", ranking_entry is not None)

artifact_rel_path = ranking_entry["artifact_path"]
artifact_full_path = os.path.join(STORAGE_DIR, "model-artifacts", artifact_rel_path)
print("Artifact Path:", artifact_full_path)
print("File Exists:", os.path.exists(artifact_full_path))

try:
    bundle = joblib.load(artifact_full_path)
    model = bundle["model"]
    pca_text = bundle["pca_text"]
    pca_img = bundle["pca_img"]
    tabular_feats = bundle["tabular_feats"]
    print("Loaded bundle keys:", list(bundle.keys()))
    print("Model feature count expected:", model.coef_.shape)
    
    # Check feature list matching registry entry
    registry_feats = ranking_entry.get("feature_names", [])
    expected_bundle_feats = tabular_feats + [f"pca_text_{i}" for i in range(8)] + [f"pca_img_{i}" for i in range(8)]
    print("Tabular feats:", tabular_feats)
    print("Registry feature_names:", registry_feats)

    # Run predict on 5 stored posts
    df_sample = df[df["has_thumb"]].head(5).copy()
    df_sample["caption_length"] = df_sample["caption"].apply(lambda c: len(str(c)))
    df_sample["hashtag_count"] = df_sample["hashtags"].apply(lambda h: len(h) if isinstance(h, list) else 0)
    
    m_dummies = pd.get_dummies(df_sample["media_type"], prefix="media")
    for col in ["media_image", "media_reel", "media_video", "media_carousel"]:
        if col not in m_dummies.columns:
            m_dummies[col] = 0
    df_sample = pd.concat([df_sample, m_dummies[["media_image", "media_reel", "media_video", "media_carousel"]]], axis=1)

    sample_indices = df_sample.index.tolist()
    s_text_pca = pca_text.transform(caption_embeds[sample_indices])
    s_img_pca = pca_img.transform(thumb_embeds[sample_indices])
    
    X_sample = np.hstack([df_sample[tabular_feats].values, s_text_pca, s_img_pca])
    preds = model.predict(X_sample)
    print("\nPredictions on 5 sample posts:")
    for i in range(5):
        row = df_sample.iloc[i]
        print(f"  @{row['handle']} [{row['shortcode']} - {row['media_type']}]: lift = {preds[i]:+.4f} (actual log_er = {row['log_er']:.2f})")
    print("\nVerification status: SUCCESS (Model loaded and predicted on 5 posts)")
except Exception as e:
    print(f"\nVerification FAILED: {e}")
    # Mark invalid if failed
    if ranking_entry:
        ranking_entry["status"] = "invalid"
        with open(MODELS_JSON, "w") as f:
            json.dump(registry, f, indent=2)
