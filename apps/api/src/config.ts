import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root or apps/api
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config(); // fallback to local directory

export const config = {
  supabaseUrl: process.env.SUPABASE_URL || 'https://pndypqsppmgumamaeuef.supabase.co',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  databaseUrl: process.env.DATABASE_URL || '',
  port: parseInt(process.env.PORT || '4000', 10),
  apiUrl: process.env.API_URL || 'http://localhost:4000',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8001',
  localStorageDir: process.env.LOCAL_STORAGE_DIR || path.resolve(__dirname, '../../../storage'),
  playwrightHeadless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
  playwrightProfileDir: path.resolve(
    process.env.PLAYWRIGHT_PROFILE_DIR || path.resolve(__dirname, '../../../.chromium-profile')
  ),
};

if (!config.supabaseServiceRoleKey) {
  console.warn('WARNING: SUPABASE_SERVICE_ROLE_KEY is not set in environment.');
}
