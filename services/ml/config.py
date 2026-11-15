import os
from dotenv import load_dotenv

# Look for .env in current dir, or project root
load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://pndypqsppmgumamaeuef.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ML_PORT = int(os.getenv("ML_PORT", "8001"))
ML_HOST = os.getenv("ML_HOST", "0.0.0.0")

LOCAL_STORAGE_DIR = os.getenv(
    "LOCAL_STORAGE_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../../storage"))
)
MODEL_ARTIFACTS_DIR = os.path.join(LOCAL_STORAGE_DIR, "model-artifacts")
os.makedirs(MODEL_ARTIFACTS_DIR, exist_ok=True)

if not SUPABASE_SERVICE_ROLE_KEY:
    print("WARNING: SUPABASE_SERVICE_ROLE_KEY not configured in environment.")
