import os
import json
from typing import Dict, Any, Optional, List

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage")
MODELS_JSON = os.path.join(STORAGE_DIR, "models.json")
FORMAT_EFFECTS_JSON = os.path.join(STORAGE_DIR, "format_effects.json")

class ScorerInterface:
    def __init__(self, scorer_type: str = "format_effects", mode: Optional[str] = None):
        self.scorer_type = mode or scorer_type
        if self.scorer_type == "ranking_model":
            # Check models.json status
            if os.path.exists(MODELS_JSON):
                with open(MODELS_JSON, "r", encoding="utf-8") as f:
                    models = json.load(f)
                active_ranking = next((m for m in models if m.get("model_type") == "ranking_deployable" and m.get("status") == "production"), None)
                if not active_ranking:
                    raise PermissionError("ranking_model cannot be used: deployable ranking model is currently provisional. Default to format_effects.")

        with open(FORMAT_EFFECTS_JSON, "r", encoding="utf-8") as f:
            self.format_effects = json.load(f)

    def score_candidate(self, candidate: Dict[str, Any], creator_profile: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        creator_profile = creator_profile or {}
        followers = candidate.get("follower_count") or creator_profile.get("followers_count") or creator_profile.get("followersCount") or 0
        if followers < 10000:
            bucket = "under 10K"
        elif followers <= 100000:
            bucket = "10K-100K"
        elif followers <= 1000000:
            bucket = "100K-1M"
        else:
            bucket = "over 1M"

        mtype = candidate.get("media_type") or candidate.get("mediaType") or "image"
        bucket_data = self.format_effects.get(bucket, {})
        fmt_info = bucket_data.get(mtype)

        is_validated = (bucket in ["100K-1M", "over 1M"])
        historical_formats = creator_profile.get("historical_formats") or []
        is_single_format = (len(historical_formats) == 1)

        notes = []
        if not is_validated:
            notes.append("not validated: insufficient sample size or power for under-100K follower creators.")
        if is_single_format:
            notes.append("single format creator: format lever does not apply based on historical posting.")

        lift = fmt_info["mean_lift"] if fmt_info else 0.0
        ci_95 = fmt_info.get("ci_95", [-0.2, 0.2]) if fmt_info else [-0.2, 0.2]

        # Explicitly declare generic timing prior since timing features carry zero predictive validation
        notes.append("timing signal unvalidated: using generic prior for schedule timing distribution.")

        return {
            "relative_lift": lift,
            "ci_95": ci_95,
            "uncertainty_interval": ci_95,
            "unit": "expected log(ER) association versus creator historical baseline",
            "scorer": "format_effects_association",
            "media_type": mtype,
            "follower_bucket": bucket,
            "is_validated": is_validated,
            "validation_status": "validated" if is_validated else "not validated",
            "notes": notes,
            "timing_status": "generic_prior"
        }

    def score_candidates(self, candidates: List[Dict[str, Any]], creator_profile: Optional[Dict[str, Any]] = None) -> List[float]:
        return [float(self.score_candidate(c, creator_profile)["relative_lift"]) for c in candidates]
