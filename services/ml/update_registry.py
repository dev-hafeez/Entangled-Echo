import os
import json

STORAGE_DIR = "storage"
MODELS_JSON = os.path.join(STORAGE_DIR, "models.json")

def update_models():
    with open(MODELS_JSON, "r", encoding="utf-8") as f:
        models = json.load(f)
    
    for m in models:
        # Ranking model promoted to experimental per verified H2 & H3 passing Holm-Bonferroni
        if m.get("model_type") == "ranking_deployable":
            m["status"] = "experimental"
            m["notes"] = "Promoted to experimental after H2 (p=0.000) and H3 (p=0.015) passed Holm-Bonferroni at alpha=0.05 on age-adjusted benchmark."
        elif m.get("model_id") == "model-v_20261103_154510":
            m["status"] = "provisional"
            m["notes"] = "Level deviation model. Baseline MAE = 0.8833 out-of-fold."

    with open(MODELS_JSON, "w", encoding="utf-8") as f:
        json.dump(models, f, indent=2)
    print("Updated models.json successfully.")

if __name__ == "__main__":
    update_models()
