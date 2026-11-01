import os
os.environ["OMP_NUM_THREADS"] = "2"
os.environ["MKL_NUM_THREADS"] = "2"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

try:
    import torch
    torch.set_num_threads(2)
except Exception:
    pass

import re
import math
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.decomposition import PCA
from sklearn.feature_extraction.text import TfidfVectorizer

_SHARED_TRANSFORMER = None

def get_shared_embedding_model():
    global _SHARED_TRANSFORMER
    if _SHARED_TRANSFORMER is None:
        try:
            from sentence_transformers import SentenceTransformer
            _SHARED_TRANSFORMER = SentenceTransformer("all-MiniLM-L6-v2")
        except Exception:
            _SHARED_TRANSFORMER = None
    return _SHARED_TRANSFORMER

CTA_KEYWORDS = [
  "comment", "link in bio", "tap", "share", "tag a friend", "tag someone", 
  "check out", "tell us", "click link", "save this", "double tap", "read more"
]

def count_emojis(text: str) -> int:
    if not text:
        return 0
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"
        "\U0001F300-\U0001F5FF"
        "\U0001F680-\U0001F6FF"
        "\U0001F1E0-\U0001F1FF"
        "\U00002702-\U000027B0"
        "\U000024C2-\U0001F251"
        "\U0001F900-\U0001F9FF"
        "]+",
        flags=re.UNICODE,
    )
    return len(emoji_pattern.findall(text))

def has_question_or_cta(text: str) -> float:
    if not text:
        return 0.0
    lower = text.lower()
    if "?" in lower:
        return 1.0
    for kw in CTA_KEYWORDS:
        if kw in lower:
            return 1.0
    return 0.0

class FeatureExtractor:
    def __init__(self, n_pca_components: int = 8):
        self.n_pca_components = n_pca_components
        self.tfidf = TfidfVectorizer(max_features=64, stop_words="english")
        self.pca = PCA(n_components=n_pca_components)
        self.is_fitted = False

    def fit(self, df: pd.DataFrame):
        captions = df["caption"].fillna("").tolist()
        if len(captions) == 0:
            captions = [""]

        model = get_shared_embedding_model()
        if model is not None:
            embeddings = model.encode(captions, batch_size=32, show_progress_bar=False)
        else:
            embeddings = self.tfidf.fit_transform(captions).toarray()

        n_samples = embeddings.shape[0]
        n_features = embeddings.shape[1]
        n_comp = min(self.n_pca_components, n_samples, n_features)
        if n_comp > 0:
            self.pca = PCA(n_components=n_comp)
            self.pca.fit(embeddings)
        self.is_fitted = True
        return self

    def _extract_base_features(self, post: dict, account_followers: int = 1000) -> list:
        caption = post.get("caption") or ""
        hashtags = post.get("hashtags") or []
        mentions = post.get("mentions") or []
        media_type = post.get("media_type") or "image"
        carousel_size = post.get("carousel_size") or 0
        posted_at_str = post.get("posted_at")

        cap_len = float(len(caption))
        word_count = float(len(caption.split()))
        hashtag_count = float(len(hashtags))
        mention_count = float(len(mentions))
        emoji_count = float(count_emojis(caption))
        cta_presence = has_question_or_cta(caption)

        is_image = 1.0 if media_type == "image" else 0.0
        is_video = 1.0 if media_type == "video" else 0.0
        is_reel = 1.0 if media_type == "reel" else 0.0
        is_carousel = 1.0 if media_type == "carousel" else 0.0

        if posted_at_str:
            try:
                dt = datetime.fromisoformat(posted_at_str.replace("Z", "+00:00"))
                post_hour = float(dt.hour)
                weekday = float(dt.weekday())
                has_time = 1.0
            except Exception:
                post_hour = 12.0
                weekday = 3.0
                has_time = 0.0
        else:
            post_hour = 12.0
            weekday = 3.0
            has_time = 0.0

        followers = max(account_followers or 1000, 1)
        log_followers = math.log10(followers + 1.0)
        days_since_prev = float(post.get("days_since_prev", 1.0))

        return [
            cap_len,
            word_count,
            hashtag_count,
            mention_count,
            emoji_count,
            cta_presence,
            is_image,
            is_video,
            is_reel,
            is_carousel,
            float(carousel_size),
            post_hour,
            weekday,
            has_time,
            days_since_prev,
            log_followers,
        ]

    def transform_single(self, post: dict, account_followers: int = 1000) -> np.ndarray:
        base = self._extract_base_features(post, account_followers)
        caption = post.get("caption") or ""

        model = get_shared_embedding_model()
        if model is not None:
            emb = model.encode([caption], show_progress_bar=False)
        else:
            if hasattr(self.tfidf, "vocabulary_"):
                emb = self.tfidf.transform([caption]).toarray()
            else:
                emb = np.zeros((1, 64))

        if self.is_fitted and hasattr(self.pca, "components_"):
            pca_emb = self.pca.transform(emb)[0]
            if len(pca_emb) < self.n_pca_components:
                pca_emb = np.pad(pca_emb, (0, self.n_pca_components - len(pca_emb)))
        else:
            pca_emb = np.zeros(self.n_pca_components)

        return np.concatenate([base, pca_emb])

    def transform_df(self, df: pd.DataFrame) -> np.ndarray:
        df_sorted = df.copy()
        df_sorted["dt"] = pd.to_datetime(df_sorted["posted_at"], errors="coerce")
        df_sorted = df_sorted.sort_values(by=["account_id", "dt"])

        df_sorted["days_since_prev"] = (
            df_sorted.groupby("account_id")["dt"].diff().dt.total_seconds() / 86400.0
        ).fillna(1.0)

        captions = df_sorted["caption"].fillna("").tolist()
        model = get_shared_embedding_model()
        if model is not None:
            raw_embs = model.encode(captions, batch_size=32, show_progress_bar=False)
        else:
            raw_embs = self.tfidf.transform(captions).toarray()

        if self.is_fitted and hasattr(self.pca, "components_"):
            pca_embs = self.pca.transform(raw_embs)
            if pca_embs.shape[1] < self.n_pca_components:
                pad_width = ((0, 0), (0, self.n_pca_components - pca_embs.shape[1]))
                pca_embs = np.pad(pca_embs, pad_width)
        else:
            pca_embs = np.zeros((len(df_sorted), self.n_pca_components))

        base_list = []
        for _, row in df_sorted.iterrows():
            base = self._extract_base_features(row.to_dict(), account_followers=row.get("followers_count", 1000))
            base_list.append(base)

        base_matrix = np.array(base_list)
        return np.hstack([base_matrix, pca_embs])

    def get_feature_names(self) -> list:
        base = [
            "caption_length",
            "word_count",
            "hashtag_count",
            "mention_count",
            "emoji_count",
            "cta_presence",
            "is_image",
            "is_video",
            "is_reel",
            "is_carousel",
            "carousel_size",
            "post_hour",
            "weekday",
            "has_timestamp",
            "days_since_prev_post",
            "log_followers",
        ]
        pca_names = [f"caption_pca_{i}" for i in range(self.n_pca_components)]
        return base + pca_names
