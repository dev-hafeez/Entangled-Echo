from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import os
import glob
import subprocess
import json
from trainer import ModelTrainer
from predictor import Predictor
from db import get_supabase
from config import ML_PORT, ML_HOST, LOCAL_STORAGE_DIR
from candidate_generator import CandidateGenerator
from optimizer import ScheduleOptimizer
from scorer import ScorerInterface
import uvicorn

app = FastAPI(title="EntangledEcho ML Service", version="1.0.0")

trainer = ModelTrainer()
predictor = Predictor()
cand_gen = CandidateGenerator(seed=42)
scorer = ScorerInterface(mode="format_effects")
optimizer = ScheduleOptimizer(scorer=scorer)

class PredictRequest(BaseModel):
    handle: str
    caption: Optional[str] = ""
    media_type: Optional[str] = "image"
    planned_time: Optional[str] = None

class EvalRunRequest(BaseModel):
    snapshot: Optional[str] = "2026-11-03-clean-v2"
    min_personal: Optional[int] = 30

class CandidateGenerateRequest(BaseModel):
    handle: str
    topic: Optional[str] = "Engagement growth strategies"
    n_candidates: Optional[int] = Field(default=6, ge=3, le=20)
    language: Optional[str] = None

class OptimizeRequest(BaseModel):
    handle: str
    candidates: List[Dict[str, Any]]
    posts_per_week: Optional[int] = 4
    min_spacing_hours: Optional[int] = 18
    solver: Optional[str] = "simulated_annealing"

@app.get("/health")
def health():
    return {"status": "ok", "service": "entangled-echo-ml"}

def get_creator_followers(handle: str) -> int:
    profiles_dir = os.path.join(LOCAL_STORAGE_DIR, "snapshots", "2026-11-03-clean-v2", "profiles")
    pf = os.path.join(profiles_dir, f"{handle}.json")
    if os.path.exists(pf):
        with open(pf, "r", encoding="utf-8") as f:
            d = json.load(f)
            return d.get("followers_count") or d.get("followersCount") or 0
    return 150000

def get_creator_language(handle: str) -> str:
    # Try reading from stored niche profile first
    niche_file = os.path.join(LOCAL_STORAGE_DIR, "niches", f"{handle}.json")
    if os.path.exists(niche_file):
        try:
            with open(niche_file, "r", encoding="utf-8") as f:
                d = json.load(f)
                return d.get("language_preference") or d.get("language") or "English"
        except Exception:
            pass
    return "English"

@app.post("/api/candidates/generate")
def generate_candidates(req: CandidateGenerateRequest):
    """
    Candidate generation endpoint wrapping LLM generator with schema validation.
    Guarantees format coverage (image, reel, carousel) and user preferred language.
    """
    followers = get_creator_followers(req.handle)
    language = req.language or get_creator_language(req.handle)
    candidates = cand_gen.generate_candidates_llm(
        topic=req.topic or "Growth",
        n_candidates=req.n_candidates,
        creator_handle=req.handle,
        follower_count=followers,
        language_preference=language
    )
    return {
        "handle": req.handle,
        "topic": req.topic,
        "language": language,
        "count": len(candidates),
        "candidates": candidates
    }

@app.post("/api/optimize")
def optimize_schedule(req: OptimizeRequest):
    """
    Schedule optimization endpoint.
    QUBO simulated annealing / greedy optimization returning calendar with validation labels.
    """
    followers = get_creator_followers(req.handle)
    # Ensure follower_count is present on all candidates
    for c in req.candidates:
        if "follower_count" not in c:
            c["follower_count"] = followers

    opt = ScheduleOptimizer(
        scorer=scorer,
        posts_per_week=req.posts_per_week or 4,
        min_spacing_hours=req.min_spacing_hours or 18
    )

    if req.solver == "greedy":
        res = opt.solve_greedy(req.candidates)
    else:
        res = opt.solve_simulated_annealing(req.candidates, num_reads=100, num_sweeps=300, seed=42)

    # Format calendar output
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    scheduled_posts = []
    for i, p in enumerate(res["selected_posts"]):
        day_idx = (p.get("preferred_day", i)) % 7
        hour = p.get("preferred_hour", 12)
        score_info = scorer.score_candidate(p, {"followers_count": followers})
        scheduled_posts.append({
            "candidate_id": p.get("id"),
            "assigned_day": day_names[day_idx],
            "assigned_time": f"{hour:02d}:00",
            "media_type": p.get("media_type"),
            "caption": p.get("caption"),
            "hashtags": p.get("hashtags"),
            "predicted_lift": score_info["relative_lift"],
            "validation_status": score_info["validation_status"],
            "notes": score_info["notes"]
        })

    return {
        "handle": req.handle,
        "solver": res["solver"],
        "energy": res["energy"],
        "feasible": res["feasible"],
        "validation_status": res["validation_status"],
        "scheduled_posts": scheduled_posts
    }

@app.get("/eval/runs")
def list_eval_runs():
    eval_dir = os.path.join(LOCAL_STORAGE_DIR, "eval_runs")
    if not os.path.exists(eval_dir):
        return {"runs": []}
    files = sorted(glob.glob(os.path.join(eval_dir, "eval_*.json")), reverse=True)
    runs = []
    for f in files:
        try:
            with open(f, "r", encoding="utf-8") as fp:
                data = json.load(fp)
                runs.append({
                    "run_id": data.get("run_id"),
                    "snapshot": data.get("snapshot"),
                    "created_at": data.get("created_at"),
                    "posts_count": data.get("posts_count"),
                    "creators_count": data.get("creators_count"),
                    "runtime_s": data.get("runtime_s"),
                    "verdict": data.get("verdict"),
                    "global_model": data.get("global_model"),
                    "baselines": data.get("baselines")
                })
        except Exception:
            continue
    return {"runs": runs}

@app.get("/eval/latest")
def get_latest_eval():
    eval_dir = os.path.join(LOCAL_STORAGE_DIR, "eval_runs")
    reports_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "reports")
    if not os.path.exists(eval_dir):
        raise HTTPException(status_code=404, detail="No evaluation runs found")
    files = sorted(glob.glob(os.path.join(eval_dir, "eval_*.json")), key=os.path.getmtime, reverse=True)
    if not files:
        raise HTTPException(status_code=404, detail="No evaluation runs found")
    
    latest_file = files[0]
    with open(latest_file, "r", encoding="utf-8") as f:
        run_data = json.load(f)
        
    report_filename = f"{run_data.get('run_id')}.md"
    report_path = os.path.join(reports_dir, report_filename)
    markdown_content = ""
    if os.path.exists(report_path):
        with open(report_path, "r", encoding="utf-8") as rf:
            markdown_content = rf.read()
            
    return {
        "run": run_data,
        "markdown": markdown_content
    }

@app.post("/train/global")
def train_global():
    try:
        return trainer.train_global_model()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Training error: {str(e)}")

@app.post("/train/personal/{handle}")
def train_personal(handle: str):
    try:
        return trainer.train_personal_model(handle)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Personal model training error: {str(e)}")

def _run_eval_job(snapshot: str, min_personal: int):
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    script_path = os.path.join(root_dir, "scripts", "run_evaluation.py")
    log_path = os.path.join(LOCAL_STORAGE_DIR, "eval_runs", "eval_latest.log")
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "w", encoding="utf-8") as log_file:
        subprocess.run(
            ["python3", script_path, "--snapshot", snapshot, "--min-personal", str(min_personal)],
            cwd=root_dir,
            stdout=log_file,
            stderr=subprocess.STDOUT
        )

@app.post("/eval/run")
def trigger_eval(req: EvalRunRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_eval_job, req.snapshot, req.min_personal)
    return {
        "status": "started",
        "message": f"Evaluation harness triggered in background for snapshot '{req.snapshot}'. Check /eval/latest or reports/."
    }

@app.get("/models")
def get_models():
    models_path = os.path.join(LOCAL_STORAGE_DIR, "models.json")
    if not os.path.exists(models_path):
        return []
    with open(models_path, "r", encoding="utf-8") as f:
        return json.load(f)

@app.post("/predict")
def predict(req: PredictRequest):
    return predictor.predict(
        handle=req.handle,
        caption=req.caption,
        media_type=req.media_type,
        planned_time=req.planned_time
    )

if __name__ == "__main__":
    uvicorn.run("main:app", host=ML_HOST, port=ML_PORT, reload=True)
