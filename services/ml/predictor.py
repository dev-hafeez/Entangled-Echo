import os
import joblib
import numpy as np
from db import get_supabase, download_model_artifact

ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), "artifacts")
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

class Predictor:
    def predict(
        self,
        handle: str,
        caption: str = "",
        media_type: str = "image",
        planned_time: str = None
    ) -> dict:
        clean_handle = handle.lower().replace("@", "")
        supabase = get_supabase()

        # Check account followers in DB
        acc_res = (
            supabase.table("accounts")
            .select("id, followers_count")
            .eq("handle", clean_handle)
            .limit(1)
            .execute()
        )
        followers = 10000
        account_id = None
        if acc_res.data and len(acc_res.data) > 0:
            account_id = acc_res.data[0]["id"]
            followers = acc_res.data[0].get("followers_count") or 10000

        # Check if personal model exists
        p_model_res = None
        if account_id:
            p_model_res = (
                supabase.table("models")
                .select("*")
                .eq("model_type", "personal")
                .eq("account_id", account_id)
                .order("trained_at", desc=True)
                .limit(1)
                .execute()
            )

        post_input = {
            "caption": caption,
            "media_type": media_type,
            "posted_at": planned_time,
            "hashtags": [t.replace("#", "") for t in caption.split() if t.startswith("#")],
            "mentions": [m.replace("@", "") for m in caption.split() if m.startswith("@")],
            "carousel_size": 2 if media_type == "carousel" else 0,
            "days_since_prev": 1.0,
        }

        # 1. If personal model exists
        if p_model_res and p_model_res.data:
            p_info = p_model_res.data[0]
            p_local = os.path.join(ARTIFACTS_DIR, f"personal_{clean_handle}_{p_info['version']}.joblib")
            if not os.path.exists(p_local):
                download_model_artifact(p_info["artifact_path"], p_local)

            p_bundle = joblib.load(p_local)
            personal_model = p_bundle["personal_model"]
            global_model = p_bundle["global_model"]
            extractor = p_bundle["global_extractor"]
            blend_w = p_bundle["blend_weight"]
            sample_count = p_bundle.get("sample_count", 10)

            x_base = extractor.transform_single(post_input, account_followers=followers).reshape(1, -1)
            y_global = float(global_model.predict(x_base)[0])

            x_stacked = np.hstack([x_base, np.array([[y_global]])])
            y_personal = float(personal_model.predict(x_stacked)[0])

            if sample_count < 10:
                y_final = y_global
                confidence_note = f"Returned global prediction: account has only {sample_count} usable posts (<10)."
                model_used = "global_fallback"
            elif sample_count < 30:
                y_final = blend_w * y_personal + (1.0 - blend_w) * y_global
                confidence_note = (
                    f"Blended prediction: personal model ({int(blend_w * 100)}%) shrunk toward global prior "
                    f"due to limited sample size ({sample_count} posts)."
                )
                model_used = f"personal_stacked_blended_{p_info['version']}"
            else:
                y_final = y_personal
                confidence_note = f"Personal model prediction based on {sample_count} historical posts."
                model_used = f"personal_stacked_{p_info['version']}"

            feature_names = extractor.get_feature_names()
            top_features = {"caption_length": len(caption), "media_type": media_type, "followers": followers}

            pred_result = {
                "predicted_engagement_rate": max(0.0, float(y_final)),
                "model_id": p_info["id"],
                "model_used": model_used,
                "confidence_note": confidence_note,
                "top_features": top_features,
            }

            # Log prediction to Supabase predictions table
            try:
                supabase.table("predictions").insert({
                    "model_id": p_info["id"],
                    "account_id": account_id,
                    "input_features": {
                        "handle": clean_handle,
                        "caption": caption,
                        "media_type": media_type,
                        "planned_time": planned_time,
                        "followers": followers
                    },
                    "predicted_engagement_rate": pred_result["predicted_engagement_rate"],
                    "model_used": pred_result["model_used"],
                    "confidence_note": pred_result["confidence_note"],
                    "top_features": pred_result["top_features"]
                }).execute()
            except Exception as e:
                print(f"Warning: failed to log prediction: {e}")

            return pred_result

        # 2. Otherwise use latest Global Model
        g_model_res = (
            supabase.table("models")
            .select("*")
            .eq("model_type", "global")
            .order("trained_at", desc=True)
            .limit(1)
            .execute()
        )

        if not g_model_res.data:
            # Auto-train global model if not yet trained
            from trainer import ModelTrainer
            trainer = ModelTrainer()
            trainer.train_global_model()
            g_model_res = (
                supabase.table("models")
                .select("*")
                .eq("model_type", "global")
                .order("trained_at", desc=True)
                .limit(1)
                .execute()
            )

        g_info = g_model_res.data[0]
        g_local = os.path.join(ARTIFACTS_DIR, f"global_{g_info['version']}.joblib")
        if not os.path.exists(g_local):
            download_model_artifact(g_info["artifact_path"], g_local)

        g_bundle = joblib.load(g_local)
        global_model = g_bundle["model"]
        extractor = g_bundle["extractor"]
        feature_names = g_bundle["feature_names"]

        x_base = extractor.transform_single(post_input, account_followers=followers).reshape(1, -1)
        y_pred = float(global_model.predict(x_base)[0])

        confidence_note = (
            "Global regression model trained across accounts. "
            f"Evaluated with Group K-Fold (MAE: {g_info.get('metrics', {}).get('mae', 0):.4f})."
        )

        top_features = {
            "caption_length": len(caption),
            "media_type": media_type,
            "followers": followers,
            "cta_presence": bool(post_input.get("cta_presence", False)),
        }

        pred_result = {
            "predicted_engagement_rate": max(0.0, float(y_pred)),
            "model_id": g_info["id"],
            "model_used": f"global_{g_info['algorithm']}_{g_info['version']}",
            "confidence_note": confidence_note,
            "top_features": top_features,
        }

        # Log prediction to Supabase predictions table
        try:
            supabase.table("predictions").insert({
                "model_id": g_info["id"],
                "account_id": account_id,
                "input_features": {
                    "handle": clean_handle,
                    "caption": caption,
                    "media_type": media_type,
                    "planned_time": planned_time,
                    "followers": followers
                },
                "predicted_engagement_rate": pred_result["predicted_engagement_rate"],
                "model_used": pred_result["model_used"],
                "confidence_note": pred_result["confidence_note"],
                "top_features": pred_result["top_features"]
            }).execute()
        except Exception as e:
            print(f"Warning: failed to log prediction: {e}")

        return pred_result
