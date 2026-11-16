import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../../../');

// Load .env from root, apps/web/.env.local, or apps/api
dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env') });
dotenv.config({ path: path.resolve(PROJECT_ROOT, 'apps/web/.env.local') });
dotenv.config(); // fallback to local directory

function parseAuthorizedParties(): string[] {
  const raw = process.env.CLERK_AUTHORIZED_PARTIES;
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    if (!raw || raw.trim().length === 0) {
      throw new Error(
        'FATAL CONFIGURATION ERROR: CLERK_AUTHORIZED_PARTIES must be explicitly configured when NODE_ENV=production. Failing closed to prevent unauthorized token acceptance.'
      );
    }
    const parties = raw.split(',').map((p) => p.trim()).filter(Boolean);
    const hasOnlyLocalhost = parties.every((p) => {
      try {
        const u = new URL(p);
        return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
      } catch {
        return p.includes('localhost') || p.includes('127.0.0.1');
      }
    });

    if (hasOnlyLocalhost) {
      throw new Error(
        `FATAL CONFIGURATION ERROR: CLERK_AUTHORIZED_PARTIES cannot contain only localhost origins in production (found: "${raw}"). Configure your production frontend domain.`
      );
    }
    return parties;
  }

  // Development / test fallback
  return (raw || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

export const config = {
  supabaseUrl: process.env.SUPABASE_URL || 'https://pndypqsppmgumamaeuef.supabase.co',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  databaseUrl: process.env.DATABASE_URL || '',
  port: parseInt(process.env.PORT || '4000', 10),
  apiUrl: process.env.API_URL || 'http://localhost:4000',
  clerkSecretKey: process.env.CLERK_SECRET_KEY || '',
  clerkPublishableKey:
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    process.env.CLERK_PUBLISHABLE_KEY ||
    '',
  clerkJwtKey: process.env.CLERK_JWT_KEY || '',
  clerkAuthorizedParties: parseAuthorizedParties(),
  tokenEncKey: process.env.TOKEN_ENC_KEY || '',
  adminPassword: process.env.ADMIN_SECRET_KEY || process.env.ADMIN_PASSWORD || '',
  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8001',
  playwrightHeadless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
  playwrightProfileDir: path.resolve(
    PROJECT_ROOT,
    process.env.PLAYWRIGHT_PROFILE_DIR || '.chromium-profile'
  ),
  localStorageDir: path.resolve(
    process.env.LOCAL_STORAGE_DIR || path.resolve(PROJECT_ROOT, 'storage')
  ),
  recSimilarityThreshold: parseFloat(process.env.REC_SIMILARITY_THRESHOLD || '0.15'),
  projectRoot: PROJECT_ROOT,
};

if (!config.supabaseServiceRoleKey) {
  console.warn('WARNING: SUPABASE_SERVICE_ROLE_KEY is not set in environment.');
}
