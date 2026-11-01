from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
from trainer import ModelTrainer
from predictor import Predictor
from db import get_supabase
from config import ML_PORT, ML_HOST
import uvicorn

app = FastAPI(title="EntangledEcho ML Service", version="1.0.0")

trainer = ModelTrainer()
predictor = Predictor()

class PredictRequest(BaseModel):
    handle: str
    caption: Optional[str] = ""
    media_type: Optional[str] = "image"
    planned_time: Optional[str] = None

@app.get("/health")
def health():
    return {"status": "ok", "service": "entangled-echo-ml"}

@app.get("/models")
def get_models():
    supabase = get_supabase()
    res = supabase.table("models").select("*").order("trained_at", desc=True).execute()
    return {"models": res.data or []}

@app.post("/train/global")
def train_global():
    try:
        result = trainer.train_global_model()
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Training error: {str(e)}")

@app.post("/train/personal/{handle}")
def train_personal(handle: str):
    try:
        result = trainer.train_personal_model(handle)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Personal model training error: {str(e)}")

@app.post("/predict")
def predict(req: PredictRequest):
    try:
        res = predictor.predict(
            handle=req.handle,
            caption=req.caption or "",
            media_type=req.media_type or "image",
            planned_time=req.planned_time
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host=ML_HOST, port=ML_PORT, reload=False)
