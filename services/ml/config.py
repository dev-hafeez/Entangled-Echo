import os
from dotenv import load_dotenv

# Look for .env in current dir, or project root
load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://pndypqsppmgumamaeuef.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ML_PORT = int(os.getenv("ML_PORT", "8001"))
ML_HOST = os.getenv("ML_HOST", "0.0.0.0")

if not SUPABASE_SERVICE_ROLE_KEY:
    print("WARNING: SUPABASE_SERVICE_ROLE_KEY not configured in environment.")
