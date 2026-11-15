import http from 'http';
import path from 'path';
import { execSync } from 'child_process';
import { NextRequest } from 'next/server';
import { POST as loginPost } from '../apps/web/src/app/api/auth/login/route.js';
import { verifyTickSecret } from '../apps/api/src/lib/auth.js';

async function main() {
  console.log('================================================================');
  console.log('   ⚙️ TASK 4: Production Config Defaults & Secret Secrecy Audit  ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assertTest(name: string, ok: boolean, detail?: string) {
    total++;
    if (ok) {
      passed++;
      console.log(`✅ PASS: ${name}${detail ? ` (${detail})` : ''}`);
    } else {
      console.error(`❌ FAIL: ${name}${detail ? ` (${detail})` : ''}`);
    }
  }

  const tsxBin = path.resolve(process.cwd(), 'apps/api/node_modules/.bin/tsx');

  // --- SUBTASK A: CLERK_AUTHORIZED_PARTIES in production ---
  console.log('--- SUBTASK A: CLERK_AUTHORIZED_PARTIES Production Fail-Closed ---');

  // 1. Unset in production -> throws fatal startup error
  let threwUnset = false;
  let unsetMsg = '';
  try {
    execSync(
      `NODE_ENV=production CLERK_AUTHORIZED_PARTIES="" "${tsxBin}" -e "import('./apps/api/src/config.ts')"`,
      { stdio: 'pipe' }
    );
  } catch (err: any) {
    threwUnset = true;
    unsetMsg = err.stderr?.toString() || err.message;
  }
  assertTest(
    'Unset CLERK_AUTHORIZED_PARTIES in production throws fatal startup error',
    threwUnset && unsetMsg.includes('FATAL CONFIGURATION ERROR: CLERK_AUTHORIZED_PARTIES must be explicitly configured'),
    'Exit code != 0'
  );

  // 2. Localhost-only in production -> throws fatal error
  let threwLocalhost = false;
  let localhostMsg = '';
  try {
    execSync(
      `NODE_ENV=production CLERK_AUTHORIZED_PARTIES="http://localhost:3000,http://127.0.0.1:3000" "${tsxBin}" -e "import('./apps/api/src/config.ts')"`,
      { stdio: 'pipe' }
    );
  } catch (err: any) {
    threwLocalhost = true;
    localhostMsg = err.stderr?.toString() || err.message;
  }
  assertTest(
    'Localhost-only CLERK_AUTHORIZED_PARTIES in production throws fatal error',
    threwLocalhost && localhostMsg.includes('cannot contain only localhost origins in production'),
    'Exit code != 0'
  );

  // 3. Valid production domain -> succeeds
  let prodSuccess = false;
  try {
    execSync(
      `NODE_ENV=production CLERK_AUTHORIZED_PARTIES="https://app.entangled-echo.com" "${tsxBin}" -e "import('./apps/api/src/config.ts').then(m => console.log('Loaded:', m.config.clerkAuthorizedParties))"`,
      { stdio: 'pipe' }
    );
    prodSuccess = true;
  } catch {}
  assertTest('Valid production domain in CLERK_AUTHORIZED_PARTIES loads successfully', prodSuccess);

  // --- SUBTASK B: Secrets Never Logged or Returned in 503 Responses ---
  console.log('\n--- SUBTASK B: Secrets Never Returned in 503 Responses or Logs ---');

  // 1. POST /api/auth/login 503 path inspection
  const oldSecret = process.env.ADMIN_SECRET_KEY;
  const oldPass = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_SECRET_KEY;
  delete process.env.ADMIN_PASSWORD;

  const req = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password: 'attempted_secret_guess_123' }),
  });
  const res = await loginPost(req);
  const data = await res.json();

  const bodyStr = JSON.stringify(data);
  const leaksSecret = bodyStr.includes('attempted_secret_guess_123') || bodyStr.includes(oldSecret || '___none___');
  assertTest('POST /api/auth/login returns exact 503 when secret is unconfigured', res.status === 503);
  assertTest('POST /api/auth/login body does not leak secret or attempt value', !leaksSecret && data.error === 'Admin access disabled: ADMIN_SECRET_KEY is not configured in environment');

  // 2. /internal/tick 503 path inspection
  const oldTick = process.env.INTERNAL_TICK_SECRET;
  delete process.env.INTERNAL_TICK_SECRET;

  const dummyReq: any = {
    headers: {
      'x-tick-secret': 'client_guess_secret_456',
    },
  };
  const result = verifyTickSecret(dummyReq);
  const leaks = JSON.stringify(result).includes('client_guess_secret_456') || JSON.stringify(result).includes(oldTick || '___none___');

  assertTest('verifyTickSecret returns exact status 503 when secret unset', result.status === 503);
  assertTest('verifyTickSecret error body does not leak secret values', !leaks && result.error === 'Service Unavailable: INTERNAL_TICK_SECRET is not configured');

  if (oldTick) process.env.INTERNAL_TICK_SECRET = oldTick;
  if (oldSecret) process.env.ADMIN_SECRET_KEY = oldSecret;
  if (oldPass) process.env.ADMIN_PASSWORD = oldPass;

  console.log('\n================================================================');
  console.log(`Task 4 Summary: ${passed} / ${total} Tests Passed`);
  console.log('================================================================');

  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal in test runner:', err);
  process.exit(1);
});
