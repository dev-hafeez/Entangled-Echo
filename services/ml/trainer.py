import os
import time
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from scipy.stats import spearmanr
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold
from sklearn.linear_model import Ridge
import lightgbm as lgb

from db import fetch_training_data, upload_model_artifact, get_supabase
from features import FeatureExtractor

ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), "artifacts")
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

class ModelTrainer:
    def __init__(self):
        pass

    def train_global_model(self) -> dict:
        """
        Trains the Global Model across all accounts using real data only.
        Uses LightGBM (or Ridge if rows < 500). Evaluates with GroupKFold by account.
        """
        df = fetch_training_data()
        if df.empty or len(df) < 4:
            raise ValueError(
                f"Insufficient real training data: found {len(df)} usable rows. "
                "Minimum 4 real posts with likes, comments, and followers required to train."
            )

        X_accounts = df["account_id"].values
        y = df["target_engagement_rate"].values

        extractor = FeatureExtractor(n_pca_components=min(8, len(df)))
        extractor.fit(df)
        X = extractor.transform_df(df)
        feature_names = extractor.get_feature_names()

        # Group K-Fold by account
        unique_accounts = np.unique(X_accounts)
        n_splits = min(5, len(unique_accounts))
        
        y_preds_cv = np.zeros(len(y))
        
        if n_splits > 1:
            gkf = GroupKFold(n_splits=n_splits)
            for train_idx, val_idx in gkf.split(X, y, groups=X_accounts):
                X_train, y_train = X[train_idx], y[train_idx]
                X_val = X[val_idx]

                if len(df) >= 500:
                    fold_model = lgb.LGBMRegressor(
                        n_estimators=100, learning_rate=0.05, verbose=-1, random_state=42
                    )
                else:
                    fold_model = Ridge(alpha=1.0)

                fold_model.fit(X_train, y_train)
                y_preds_cv[val_idx] = fold_model.predict(X_val)
        else:
            # Fallback for single account in database
            ridge = Ridge(alpha=1.0)
            ridge.fit(X, y)
            y_preds_cv = ridge.predict(X)

        # Metrics
        mae = float(mean_absolute_error(y, y_preds_cv))
        r2 = float(r2_score(y, y_preds_cv)) if len(y) > 1 else 0.0
        sp_corr, _ = spearmanr(y, y_preds_cv)
        spearman = float(sp_corr) if not np.isnan(sp_corr) else 0.0

        # Fit final model on full dataset
        algorithm = "lightgbm" if len(df) >= 500 else "ridge"
        if algorithm == "lightgbm":
            final_model = lgb.LGBMRegressor(
                n_estimators=100, learning_rate=0.05, verbose=-1, random_state=42
            )
            final_model.fit(X, y)
            importances = dict(zip(feature_names, [float(x) for x in final_model.feature_importances_]))
        else:
            final_model = Ridge(alpha=1.0)
            final_model.fit(X, y)
            importances = dict(zip(feature_names, [float(abs(x)) for x in final_model.coef_]))

        version = f"v_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
        bundle = {
            "model": final_model,
            "extractor": extractor,
            "feature_names": feature_names,
            "algorithm": algorithm,
            "version": version,
            "metrics": {"mae": mae, "r2": r2, "spearman": spearman},
            "training_rows_count": len(df),
        }

        local_file = os.path.join(ARTIFACTS_DIR, f"global_{version}.joblib")
        joblib.dump(bundle, local_file)

        # Upload to Supabase Storage
        storage_path = f"global/{version}/model.joblib"
        upload_model_artifact(local_file, storage_path)

        # Persist to `models` table
        supabase = get_supabase()
        db_res = supabase.table("models").insert({
            "model_type": "global",
            "account_id": None,
            "version": version,
            "algorithm": algorithm,
            "metrics": {"mae": mae, "r2": r2, "spearman": spearman},
            "feature_importances": importances,
            "artifact_path": storage_path,
            "training_rows_count": len(df),
            "trained_at": datetime.utcnow().isoformat()
        }).execute()

        created_model = db_res.data[0] if db_res.data else {}

        return {
            "success": True,
            "model": created_model,
            "version": version,
            "algorithm": algorithm,
            "rows_used": len(df),
            "metrics": {"mae": mae, "r2": r2, "spearman": spearman},
            "top_features": sorted(importances.items(), key=lambda x: x[1], reverse=True)[:5]
        }

    def train_personal_model(self, handle: str) -> dict:
        """
        Trains a Personal Model for a single account using stacking and shrinkage toward Global model.
        """
        clean_handle = handle.lower().replace("@", "")
        df = fetch_training_data(clean_handle)

        if df.empty or len(df) < 4:
            raise ValueError(
                f"Insufficient real training data for @{clean_handle}: found {len(df)} usable rows. "
                "Minimum 4 real posts with likes and comments required to train a personal model."
            )

        account_id = df["account_id"].iloc[0]

        # Fetch latest global model for stacking
        supabase = get_supabase()
        g_model_res = (
            supabase.table("models")
            .select("*")
            .eq("model_type", "global")
            .order("trained_at", desc=True)
            .limit(1)
            .execute()
        )
        if not g_model_res.data:
            # Train global model first if none exists
            self.train_global_model()
            g_model_res = (
                supabase.table("models")
                .select("*")
                .eq("model_type", "global")
                .order("trained_at", desc=True)
                .limit(1)
                .execute()
            )

        g_model_info = g_model_res.data[0]
        # Load global model artifact
        g_local_path = os.path.join(ARTIFACTS_DIR, f"global_{g_model_info['version']}.joblib")
        if not os.path.exists(g_local_path):
            from db import download_model_artifact
            download_model_artifact(g_model_info["artifact_path"], g_local_path)
        g_bundle = joblib.load(g_local_path)
        global_model = g_bundle["model"]
        global_extractor = g_bundle["extractor"]

        # Time-ordered sort
        df["dt"] = pd.to_datetime(df["posted_at"], errors="coerce")
        df = df.sort_values(by="dt")

        y = df["target_engagement_rate"].values

        # Base features from global extractor
        X_base = global_extractor.transform_df(df)
        # Stack global predictions as a feature
        global_preds = global_model.predict(X_base).reshape(-1, 1)
        X_stacked = np.hstack([X_base, global_preds])

        # Time-ordered split (80% train, 20% test)
        n = len(df)
        split_idx = max(int(n * 0.8), 2)
        X_train, y_train = X_stacked[:split_idx], y[:split_idx]
        X_val, y_val = X_stacked[split_idx:], y[split_idx:]

        personal_reg = Ridge(alpha=1.0)
        personal_reg.fit(X_train, y_train)

        if len(X_val) > 0:
            val_preds = personal_reg.predict(X_val)
            mae = float(mean_absolute_error(y_val, val_preds))
            r2 = float(r2_score(y_val, val_preds)) if len(y_val) > 1 else 0.0
            sp_corr, _ = spearmanr(y_val, val_preds)
            spearman = float(sp_corr) if not np.isnan(sp_corr) else 0.0
        else:
            mae, r2, spearman = 0.0, 0.0, 0.0

        # Fit on full data
        personal_reg.fit(X_stacked, y)

        # Blend weight: below 30 usable posts, shrink toward global prediction
        blend_weight = min(1.0, max(0.0, (n - 10) / 20.0))

        version = f"v_personal_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
        bundle = {
            "personal_model": personal_reg,
            "global_model": global_model,
            "global_extractor": global_extractor,
            "blend_weight": blend_weight,
            "version": version,
            "sample_count": n,
            "algorithm": "stacked_ridge",
            "metrics": {"mae": mae, "r2": r2, "spearman": spearman},
        }

        local_file = os.path.join(ARTIFACTS_DIR, f"personal_{clean_handle}_{version}.joblib")
        joblib.dump(bundle, local_file)

        storage_path = f"personal/{clean_handle}/{version}/model.joblib"
        upload_model_artifact(local_file, storage_path)

        db_res = supabase.table("models").insert({
            "model_type": "personal",
            "account_id": account_id,
            "version": version,
            "algorithm": "stacked_ridge",
            "metrics": {"mae": mae, "r2": r2, "spearman": spearman, "blend_weight": blend_weight},
            "feature_importances": {"global_prediction_weight": blend_weight},
            "artifact_path": storage_path,
            "training_rows_count": n,
            "trained_at": datetime.utcnow().isoformat()
        }).execute()

        created_model = db_res.data[0] if db_res.data else {}

        return {
            "success": True,
            "model": created_model,
            "version": version,
            "handle": clean_handle,
            "rows_used": n,
            "blend_weight": blend_weight,
            "metrics": {"mae": mae, "r2": r2, "spearman": spearman}
        }
