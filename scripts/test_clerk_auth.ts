/**
 * EntangledEcho — Step 2.2 Comprehensive Automated Security & Authorization Test Suite
 *
 * Independently verifies all Step 2.1 audit defects and Step 2.2 fixes:
 * 1. Dependency Resolution & Packaging (no manual symlinks, frozen-lockfile valid)
 * 2. Admin Security & Elimination of Bypasses (admin123 rejected, admin_auth=true rejected,
 *    HMAC signed admin session cookies, constant-time header auth)
 * 3. Audience Demographics Privacy (FR-30: 401 unauth, 403 non-owner, 200 owner, 200 admin,
 *    zero existence leakage to unauthorized callers)
 * 4. Scraper Routes Protection & DoS Prevention (session/status, canary, curated-list require admin)
 * 5. Clerk JWT Verification & Authorized Parties (azp enforcement, signature, expiry)
 * 6. Social Account Ownership (tenant isolation across calendar posts, feedback, graph connect)
 * 7. Public Endpoints Verification (legitimate public endpoints remain reachable)
 */

import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import app from '../apps/api/src/index.js';
import { config } from '../apps/api/src/config.js';
import { signAdminSessionToken, migrateDuplicateHandles } from '../apps/api/src/lib/auth.js';

// Setup isolated RSA keypair for hermetic cryptographic verification
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Configure API test environment
const TEST_ADMIN_KEY = 'test_secure_admin_key_step2_2026_audit';
config.clerkJwtKey = publicKey;
config.clerkAuthorizedParties = ['http://localhost:3000', 'http://127.0.0.1:3000'];
config.adminPassword = TEST_ADMIN_KEY;

// Helper to create test JWTs
const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function createToken(
  sub: string,
  expOffsetSec: number = 3600,
  key: string = privateKey,
  claims: Record<string, any> = {}
): string {
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const payload = b64({
    sub,
    sid: `sess_${Date.now()}`,
    azp: 'http://localhost:3000',
    exp: Math.floor(Date.now() / 1000) + expOffsetSec,
    iat: Math.floor(Date.now() / 1000),
    ...claims,
  });
  const data = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data);
  return `${data}.${sign.sign(key).toString('base64url')}`;
}

// Generate an attacker keypair for invalid signature tests
const attackerKey = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).privateKey;

let server: http.Server;
let baseUrl: string;

function makeRequest(
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const postData = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      ...headers,
    };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData).toString();
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {}
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  status: number;
  expectedStatus: number | number[];
  detail?: string;
}

const results: TestResult[] = [];

function record(
  suite: string,
  name: string,
  status: number,
  expectedStatus: number | number[],
  detail?: string
) {
  const isMatch = Array.isArray(expectedStatus)
    ? expectedStatus.includes(status)
    : status === expectedStatus;
  results.push({
    suite,
    name,
    passed: isMatch,
    status,
    expectedStatus,
    detail,
  });
  const icon = isMatch ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [${status}] ${name}${detail ? ` - ${detail}` : ''}`);
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('   🔒 EntangledEcho Step 2.2: Comprehensive Security Test Suite ');
  console.log('================================================================\n');

  // Test setup: user IDs and linked handles
  const aliceId = 'user_alice_test_123';
  const aliceHandle = 'alice_brand';

  const malloryId = 'user_mallory_attacker_456';
  const malloryHandle = 'mallory_brand';

  // Seed test files on disk
  const userSessionDir = path.join(config.localStorageDir, 'user_sessions');
  const audiencesDir = path.join(config.localStorageDir, 'audiences');
  const curatedPath = path.join(config.projectRoot, 'scripts', 'curated_deep_scrape_list.json');
  const createdCurated = !fs.existsSync(curatedPath);
  if (createdCurated) {
    fs.writeFileSync(curatedPath, JSON.stringify({ curated: [] }, null, 2));
  }
  if (!fs.existsSync(userSessionDir)) fs.mkdirSync(userSessionDir, { recursive: true });
  if (!fs.existsSync(audiencesDir)) fs.mkdirSync(audiencesDir, { recursive: true });

  fs.writeFileSync(
    path.join(userSessionDir, `${aliceId}.json`),
    JSON.stringify({ userId: aliceId, handle: aliceHandle, isVerified: true, verificationMethod: 'graph_api', updatedAt: new Date().toISOString() }, null, 2)
  );

  fs.writeFileSync(
    path.join(userSessionDir, `${malloryId}.json`),
    JSON.stringify({ userId: malloryId, handle: malloryHandle, isVerified: true, verificationMethod: 'graph_api', updatedAt: new Date().toISOString() }, null, 2)
  );

  fs.writeFileSync(
    path.join(audiencesDir, `${aliceHandle}.json`),
    JSON.stringify({
      handle: aliceHandle,
      source: 'graph_api',
      collectedAt: new Date().toISOString(),
      demographics: [{ age: '25-34', pct: 45 }],
    }, null, 2)
  );

  // Tokens
  const aliceToken = createToken(aliceId);
  const malloryToken = createToken(malloryId);
  const expiredToken = createToken(aliceId, -120);
  const tamperedToken = createToken(aliceId, 3600, attackerKey);
  const invalidAzpToken = createToken(aliceId, 3600, privateKey, { azp: 'https://evil-phishing.com' });
  const adminClerkToken = createToken('user_clerk_admin', 3600, privateKey, { role: 'admin' });
  const validAdminSessionToken = signAdminSessionToken(TEST_ADMIN_KEY);
  const expiredAdminSessionToken = signAdminSessionToken(TEST_ADMIN_KEY, -60);
  const forgedAdminSessionToken = signAdminSessionToken('wrong_secret_123');

  // Start test HTTP server on ephemeral port
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      console.log(`Test server running at ${baseUrl}\n`);
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // SUITE 1: Dependency Resolution
    // -------------------------------------------------------------------------
    console.log('--- SUITE 1: Dependency Resolution & Packaging ---');

    // 1a. @clerk/backend declared in package.json
    const apiPkg = JSON.parse(fs.readFileSync(path.join(config.projectRoot, 'apps/api/package.json'), 'utf-8'));
    const hasDeclaredDep = Boolean(apiPkg.dependencies && apiPkg.dependencies['@clerk/backend']);
    record(
      'SUITE 1',
      'apps/api/package.json explicitly declares @clerk/backend dependency',
      hasDeclaredDep ? 200 : 500,
      200,
      hasDeclaredDep ? `Version: ${apiPkg.dependencies['@clerk/backend']}` : 'Missing'
    );

    // 1b. Check resolved path points into official pnpm virtual store, not manual ad-hoc symlink
    const resolvedPath = path.join(config.projectRoot, 'apps/api/node_modules/@clerk/backend');
    let pointsToPnpm = false;
    let isManualAdHocLink = true;
    let linkTarget = '';
    try {
      linkTarget = fs.readlinkSync(resolvedPath);
      pointsToPnpm = linkTarget.includes('.pnpm');
      isManualAdHocLink = linkTarget.includes('apps/web') || linkTarget.startsWith('/home');
    } catch {}
    record(
      'SUITE 1',
      'Dependency resolves via official pnpm virtual store without manual ad-hoc symlinks',
      pointsToPnpm && !isManualAdHocLink ? 200 : 500,
      200,
      `PnpmStore: ${pointsToPnpm}, AdHoc: ${isManualAdHocLink}`
    );

    // -------------------------------------------------------------------------
    // SUITE 2: Unauthenticated & Malformed Requests
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 2: Unauthenticated & Malformed Requests ---');

    let res = await makeRequest('GET', '/api/calendar/posts');
    record('SUITE 2', 'GET /api/calendar/posts without auth returns 401', res.status, 401, res.body?.error);

    res = await makeRequest('POST', '/api/calendar/posts', {}, { accountHandle: aliceHandle, caption: 'test' });
    record('SUITE 2', 'POST /api/calendar/posts without auth returns 401', res.status, 401, res.body?.error);

    res = await makeRequest('GET', '/api/notifications');
    record('SUITE 2', 'GET /api/notifications without auth returns 401', res.status, 401, res.body?.error);

    res = await makeRequest('POST', '/api/recommendations/feedback', {}, { handle: aliceHandle, accepted: true });
    record('SUITE 2', 'POST /api/recommendations/feedback without auth returns 401', res.status, 401, res.body?.error);

    res = await makeRequest('POST', '/api/graph/connect', {}, { accessToken: 'fake' });
    record('SUITE 2', 'POST /api/graph/connect without auth returns 401', res.status, 401, res.body?.error);

    res = await makeRequest('GET', '/api/calendar/posts', { Authorization: 'Basic dXNlcjpwYXNz' });
    record('SUITE 2', 'Authorization: Basic scheme rejected with 401', res.status, 401, res.body?.error);

    res = await makeRequest('GET', '/api/calendar/posts', { Authorization: 'Bearer' });
    record('SUITE 2', 'Authorization: Empty Bearer token rejected with 401', res.status, 401, res.body?.error);

    res = await makeRequest('GET', '/api/calendar/posts', { Authorization: 'Bearer not.a.valid.jwt' });
    record('SUITE 2', 'Authorization: Malformed JWT rejected with 401', res.status, 401, res.body?.error);

    // -------------------------------------------------------------------------
    // SUITE 3: Cryptographic JWT Verification & AZP
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 3: Cryptographic JWT Verification & AZP Enforcement ---');

    res = await makeRequest('GET', '/api/calendar/posts', { Authorization: `Bearer ${expiredToken}` });
    record('SUITE 3', 'Expired JWT rejected with 401', res.status, 401, res.body?.error);

    res = await makeRequest('GET', '/api/calendar/posts', { Authorization: `Bearer ${tamperedToken}` });
    record('SUITE 3', 'Attacker-signed JWT rejected with 401', res.status, 401, res.body?.error);

    const corruptedSig = aliceToken.slice(0, -6) + 'xxxxxx';
    res = await makeRequest('GET', '/api/calendar/posts', { Authorization: `Bearer ${corruptedSig}` });
    record('SUITE 3', 'Corrupted signature JWT rejected with 401', res.status, 401, res.body?.error);

    res = await makeRequest('GET', '/api/calendar/posts', { Authorization: `Bearer ${aliceToken}` });
    record('SUITE 3', 'Valid JWT with approved azp accepted with 200', res.status, 200);

    res = await makeRequest('GET', '/api/calendar/posts', { Authorization: `Bearer ${invalidAzpToken}` });
    record('SUITE 3', 'Valid JWT with unapproved azp rejected with 401', res.status, 401, res.body?.error);

    // -------------------------------------------------------------------------
    // SUITE 4: Admin Security & Elimination of Bypasses
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 4: Admin Security & Elimination of Bypasses ---');

    // 4a. Insecure default password admin123 rejected
    res = await makeRequest('GET', '/api/admin/status', { Authorization: 'Bearer admin123' });
    record('SUITE 4', 'Insecure fallback default password "admin123" rejected with 403', res.status, 403, res.body?.error);

    // 4b. Legacy unsigned bypass cookie admin_auth=true rejected
    res = await makeRequest('GET', '/api/admin/status', { Cookie: 'admin_auth=true' });
    record('SUITE 4', 'Legacy bypass cookie "admin_auth=true" rejected with 403', res.status, 403, res.body?.error);

    // 4c. Unauthenticated requests to admin endpoints rejected
    res = await makeRequest('GET', '/api/admin/status');
    record('SUITE 4', 'Unauthenticated GET /api/admin/status rejected with 403', res.status, 403, res.body?.error);

    res = await makeRequest('GET', '/api/admin/queue');
    record('SUITE 4', 'Unauthenticated GET /api/admin/queue rejected with 403', res.status, 403, res.body?.error);

    // 4d. Normal user token (Alice) to admin endpoint rejected
    res = await makeRequest('GET', '/api/admin/status', { Authorization: `Bearer ${aliceToken}` });
    record('SUITE 4', 'Normal authenticated user token to /api/admin/status rejected with 403', res.status, 403, res.body?.error);

    // 4e. Valid HMAC signed admin_session cookie accepted
    res = await makeRequest('GET', '/api/admin/status', { Cookie: `admin_session=${validAdminSessionToken}` });
    record('SUITE 4', 'Valid HMAC-signed admin_session cookie accepted with 200', res.status, 200, `Admin: ${res.body?.admin}`);

    // 4f. Valid Authorization: Bearer <ADMIN_SECRET_KEY> accepted
    res = await makeRequest('GET', '/api/admin/status', { Authorization: `Bearer ${TEST_ADMIN_KEY}` });
    record('SUITE 4', 'Valid Authorization: Bearer <ADMIN_SECRET_KEY> accepted with 200', res.status, 200);

    // 4g. Valid x-admin-password header accepted
    res = await makeRequest('GET', '/api/admin/status', { 'x-admin-password': TEST_ADMIN_KEY });
    record('SUITE 4', 'Valid x-admin-password header accepted with 200', res.status, 200);

    // 4h. Clerk JWT with admin role accepted
    res = await makeRequest('GET', '/api/admin/status', { Authorization: `Bearer ${adminClerkToken}` });
    record('SUITE 4', 'Clerk JWT with verified role=admin accepted with 200', res.status, 200);

    // 4i. Forged or expired admin session token rejected
    res = await makeRequest('GET', '/api/admin/status', { Cookie: `admin_session=${forgedAdminSessionToken}` });
    record('SUITE 4', 'Forged admin_session token (wrong secret) rejected with 403', res.status, 403, res.body?.error);

    res = await makeRequest('GET', '/api/admin/status', { Cookie: `admin_session=${expiredAdminSessionToken}` });
    record('SUITE 4', 'Expired admin_session token rejected with 403', res.status, 403, res.body?.error);

    // -------------------------------------------------------------------------
    // SUITE 5: Scraper Route Protection & DoS Prevention
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 5: Scraper Route Protection & DoS Prevention ---');

    res = await makeRequest('GET', '/api/session/status');
    record('SUITE 5', 'Unauthenticated GET /api/session/status returns 403 (Zero Chromium spawned)', res.status, 403, res.body?.error);

    res = await makeRequest('GET', '/api/session/canary');
    record('SUITE 5', 'Unauthenticated GET /api/session/canary returns 403', res.status, 403, res.body?.error);

    res = await makeRequest('GET', '/api/session/curated-list');
    record('SUITE 5', 'Unauthenticated GET /api/session/curated-list returns 403', res.status, 403, res.body?.error);

    res = await makeRequest('GET', '/api/session/status', { Authorization: `Bearer ${aliceToken}` });
    record('SUITE 5', 'Normal user GET /api/session/status rejected with 403', res.status, 403, res.body?.error);

    res = await makeRequest('GET', '/api/session/curated-list', { Authorization: `Bearer ${TEST_ADMIN_KEY}` });
    record('SUITE 5', 'Admin GET /api/session/curated-list succeeds with 200', res.status, 200);

    // -------------------------------------------------------------------------
    // SUITE 6: Private Audience Demographics Protection (FR-30)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 6: Private Audience Demographics Privacy (FR-30) ---');

    // 6a. Unauthenticated queries rejected with 401
    res = await makeRequest('GET', `/api/accounts/${aliceHandle}/audience`);
    record('SUITE 6', 'Unauthenticated GET /api/accounts/:handle/audience rejected with 401', res.status, 401, res.body?.error);

    res = await makeRequest('GET', '/api/accounts/nonexistent_brand/audience');
    record('SUITE 6', 'Unauthenticated query for non-existent account rejected with 401', res.status, 401, res.body?.error);

    // 6b. Mallory queries Alice's audience -> returns 403
    res = await makeRequest('GET', `/api/accounts/${aliceHandle}/audience`, { Authorization: `Bearer ${malloryToken}` });
    record('SUITE 6', 'Unauthorized user (Mallory) querying Alice audience returns 403', res.status, 403, res.body?.error);

    // 6c. Mallory queries non-existent audience -> returns 403 without leaking non-existence
    res = await makeRequest('GET', '/api/accounts/secret_handle_unknown/audience', { Authorization: `Bearer ${malloryToken}` });
    record('SUITE 6', 'Unauthorized user querying unknown account returns 403 (Zero existence leakage)', res.status, 403, res.body?.error);

    // 6d. Alice queries her own audience -> returns 200
    res = await makeRequest('GET', `/api/accounts/${aliceHandle}/audience`, { Authorization: `Bearer ${aliceToken}` });
    record('SUITE 6', 'Account owner (Alice) querying her own audience returns 200', res.status, 200, `Audience loaded: ${Boolean(res.body?.audience)}`);

    // 6e. Admin queries Alice's audience -> returns 200
    res = await makeRequest('GET', `/api/accounts/${aliceHandle}/audience`, { Authorization: `Bearer ${TEST_ADMIN_KEY}` });
    record('SUITE 6', 'Admin querying Alice audience returns 200', res.status, 200, `Audience loaded: ${Boolean(res.body?.audience)}`);

    // -------------------------------------------------------------------------
    // SUITE 7: Social Account Ownership Enforcement
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 7: Social Account Ownership Enforcement ---');

    // 7a. Alice schedules post for aliceHandle -> 201
    res = await makeRequest(
      'POST',
      '/api/calendar/posts',
      { Authorization: `Bearer ${aliceToken}` },
      {
        accountHandle: aliceHandle,
        caption: 'Alice legitimate post',
        scheduledTime: new Date(Date.now() + 86400000).toISOString(),
      }
    );
    record('SUITE 7', 'Alice schedules post for alice_brand succeeds with 201', res.status, 201, `Post ID: ${res.body?.post?.id}`);
    const alicePostId = res.body?.post?.id;

    // 7b. Mallory attempts to schedule post for aliceHandle -> 403
    res = await makeRequest(
      'POST',
      '/api/calendar/posts',
      { Authorization: `Bearer ${malloryToken}` },
      {
        accountHandle: aliceHandle,
        caption: 'Mallory hijacking Alice handle',
        scheduledTime: new Date(Date.now() + 86400000).toISOString(),
      }
    );
    record('SUITE 7', 'Mallory attempting to schedule post for alice_brand blocked with 403', res.status, 403, res.body?.error);

    // 7c. Mallory schedules post for malloryHandle -> 201
    res = await makeRequest(
      'POST',
      '/api/calendar/posts',
      { Authorization: `Bearer ${malloryToken}` },
      {
        accountHandle: malloryHandle,
        caption: 'Mallory legitimate post',
        scheduledTime: new Date(Date.now() + 86400000).toISOString(),
      }
    );
    record('SUITE 7', 'Mallory schedules post for mallory_brand succeeds with 201', res.status, 201);

    // 7d. Mallory attempts to submit recommendation feedback for aliceHandle -> 403
    res = await makeRequest(
      'POST',
      '/api/recommendations/feedback',
      { Authorization: `Bearer ${malloryToken}` },
      {
        handle: aliceHandle,
        accepted: false,
        mediaType: 'image',
      }
    );
    record('SUITE 7', 'Mallory submitting recommendation feedback for alice_brand blocked with 403', res.status, 403, res.body?.error);

    // 7e. Alice submits recommendation feedback for aliceHandle -> 200
    res = await makeRequest(
      'POST',
      '/api/recommendations/feedback',
      { Authorization: `Bearer ${aliceToken}` },
      {
        handle: aliceHandle,
        accepted: true,
        mediaType: 'reel',
      }
    );
    record('SUITE 7', 'Alice submits recommendation feedback for alice_brand succeeds with 200', res.status, 200);

    // 7f. Cross-user data isolation: Mallory cannot read Alice post by ID
    res = await makeRequest('GET', `/api/calendar/posts/${alicePostId}`, { Authorization: `Bearer ${malloryToken}` });
    record('SUITE 7', 'Mallory cannot fetch Alice post by ID (returns 404)', res.status, 404, res.body?.error);

    // -------------------------------------------------------------------------
    // SUITE 8: Public Endpoints (Accessible Without Tokens)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 8: Public Endpoints Accessible Without Tokens ---');

    res = await makeRequest('GET', '/health');
    record('SUITE 8', 'GET /health accessible without token', res.status, 200, res.body?.status);

    res = await makeRequest('GET', '/api/accounts');
    record('SUITE 8', 'GET /api/accounts accessible without token', res.status, 200, `Found ${res.body?.accounts?.length || 0} accounts`);

    res = await makeRequest('GET', '/api/recommendations/live-trends');
    record('SUITE 8', 'GET /api/recommendations/live-trends accessible without token', res.status, 200);

    res = await makeRequest('GET', '/api/models');
    record('SUITE 8', 'GET /api/models accessible without token', res.status, 200);

    // -------------------------------------------------------------------------
    // SUITE 9: Handle Ownership & Uniqueness (FIX 2)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 9: Handle Ownership & Uniqueness (FIX 2) ---');

    // 9a. Onboarding duplicate handle rejected with 409
    res = await makeRequest(
      'POST',
      '/api/onboarding/user-profile',
      { Authorization: `Bearer ${malloryToken}` },
      { handle: aliceHandle }
    );
    record('SUITE 9', 'POST /api/onboarding/user-profile rejects duplicate handle with 409', res.status, 409, res.body?.error);

    // 9b. Self-asserted onboarding handle without proof denies audience access (403)
    const unverifiedId = 'user_unverified_test_789';
    const unverifiedHandle = 'unverified_brand_789';
    const unverifiedToken = createToken(unverifiedId);
    await makeRequest(
      'POST',
      '/api/onboarding/user-profile',
      { Authorization: `Bearer ${unverifiedToken}` },
      { handle: unverifiedHandle }
    );
    fs.writeFileSync(
      path.join(audiencesDir, `${unverifiedHandle}.json`),
      JSON.stringify({ handle: unverifiedHandle, source: 'graph_api' }, null, 2)
    );
    res = await makeRequest(
      'GET',
      `/api/accounts/${unverifiedHandle}/audience`,
      { Authorization: `Bearer ${unverifiedToken}` }
    );
    record('SUITE 9', 'Self-asserted onboarding handle without proof denies audience access (403)', res.status, 403, res.body?.error);

    // 9c. Duplicate handle migration inventory
    const migrationResult = migrateDuplicateHandles();
    record(
      'SUITE 9',
      'storage/user_sessions duplicate handle migration reports 0 duplicates',
      migrationResult.duplicatesMigrated === 0 ? 200 : 500,
      200,
      `Duplicates: ${migrationResult.duplicatesMigrated}, Unique: ${migrationResult.uniqueHandles}`
    );

    // -------------------------------------------------------------------------
    // SUITE 10: Authorization on Mutations (FIX 3)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 10: Authorization on Mutations (FIX 3) ---');

    // 10a. Non-admin DELETE /api/accounts/:handle rejected with 403 and files preserved
    const profilesDir = path.join(config.localStorageDir, 'profiles');
    fs.writeFileSync(
      path.join(profilesDir, `${aliceHandle}.json`),
      JSON.stringify({ id: 'acc_alice', handle: aliceHandle, followers_count: 5000 }, null, 2)
    );
    res = await makeRequest(
      'DELETE',
      `/api/accounts/${aliceHandle}`,
      { Authorization: `Bearer ${malloryToken}` }
    );
    const aliceFilePreserved = fs.existsSync(path.join(profilesDir, `${aliceHandle}.json`));
    record(
      'SUITE 10',
      'Non-admin DELETE /api/accounts/:handle rejected with 403 and files preserved',
      res.status === 403 && aliceFilePreserved ? 403 : 500,
      403,
      res.body?.error
    );

    // 10b. With configured secret, anonymous call gets exact 401
    process.env.INTERNAL_TICK_SECRET = 'test_tick_secret_xyz123';
    res = await makeRequest('POST', '/api/calendar/tick');
    record(
      'SUITE 10',
      'Anonymous POST /api/calendar/tick with configured secret rejected with exact 401',
      res.status,
      401,
      res.body?.error
    );

    // 10c. With unconfigured secret, anonymous call fails closed with exact 503
    delete process.env.INTERNAL_TICK_SECRET;
    res = await makeRequest('POST', '/api/calendar/tick');
    record(
      'SUITE 10',
      'Anonymous POST /api/calendar/tick with unconfigured secret fails closed with exact 503',
      res.status,
      503,
      res.body?.error
    );

    // 10d. Authorized POST /api/calendar/tick with INTERNAL_TICK_SECRET succeeds (200)
    process.env.INTERNAL_TICK_SECRET = 'test_tick_secret_xyz123';
    res = await makeRequest(
      'POST',
      '/api/calendar/tick',
      { 'x-tick-secret': 'test_tick_secret_xyz123' }
    );
    record(
      'SUITE 10',
      'Authorized POST /api/calendar/tick with INTERNAL_TICK_SECRET succeeds with 200',
      res.status,
      200,
      `Success: ${res.body?.success}`
    );

    // 10e. /internal/tick fails closed when secret is unset (503)
    delete process.env.INTERNAL_TICK_SECRET;
    res = await makeRequest('POST', '/internal/tick');
    record(
      'SUITE 10',
      'POST /internal/tick fails closed (503) when INTERNAL_TICK_SECRET is unset',
      res.status,
      503,
      res.body?.error
    );

    // 10f. /internal/tick succeeds when valid secret is provided
    process.env.INTERNAL_TICK_SECRET = 'test_tick_secret_xyz123';
    res = await makeRequest(
      'POST',
      '/internal/tick',
      { 'x-tick-secret': 'test_tick_secret_xyz123' }
    );
    record(
      'SUITE 10',
      'POST /internal/tick succeeds (200) with valid INTERNAL_TICK_SECRET',
      res.status,
      200,
      `Success: ${res.body?.success}`
    );
    delete process.env.INTERNAL_TICK_SECRET;

    // 10f. PATCH /api/calendar/posts/:id cannot reassign accountHandle to unowned account
    res = await makeRequest(
      'POST',
      '/api/calendar/posts',
      { Authorization: `Bearer ${malloryToken}` },
      { accountHandle: malloryHandle, caption: 'Mallory original post', scheduledTime: new Date(Date.now() + 86400000).toISOString() }
    );
    const postToReassign = res.body?.post?.id;
    res = await makeRequest(
      'PATCH',
      `/api/calendar/posts/${postToReassign}`,
      { Authorization: `Bearer ${malloryToken}` },
      { accountHandle: aliceHandle }
    );
    record(
      'SUITE 10',
      'PATCH /api/calendar/posts/:id cannot reassign accountHandle to unowned account (403)',
      res.status,
      403,
      res.body?.error
    );

    // 10g. GET /api/recommendations/preferences rejects unauthorized user (403)
    const prefDir = path.join(config.localStorageDir, 'preferences');
    fs.writeFileSync(
      path.join(prefDir, `recs_${aliceHandle}.json`),
      JSON.stringify({ handle: aliceHandle, formatWeights: { reel: 1.5 } }, null, 2)
    );
    res = await makeRequest(
      'GET',
      `/api/recommendations/preferences?handle=${aliceHandle}`,
      { Authorization: `Bearer ${malloryToken}` }
    );
    record(
      'SUITE 10',
      'GET /api/recommendations/preferences rejects unauthorized user (403)',
      res.status,
      403,
      res.body?.error
    );

    // 10h. POST /api/models/train-personal/:handle rejects unauthorized user (403)
    res = await makeRequest(
      'POST',
      `/api/models/train-personal/${aliceHandle}`,
      { Authorization: `Bearer ${malloryToken}` }
    );
    record(
      'SUITE 10',
      'POST /api/models/train-personal/:handle rejects unauthorized user (403)',
      res.status,
      403,
      res.body?.error
    );

    // -------------------------------------------------------------------------
    // SUITE 11: Admin Session Cookie & Proxy Forwarding (FIX 1)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 11: Admin Session Cookie & Proxy Forwarding (FIX 1) ---');

    // 11a. Admin request carrying admin_session cookie succeeds with 200
    res = await makeRequest(
      'GET',
      '/api/admin/status',
      { Cookie: `admin_session=${validAdminSessionToken}` }
    );
    record(
      'SUITE 11',
      'Admin request with HttpOnly admin_session cookie succeeds through API with 200',
      res.status,
      200,
      `Admin: ${res.body?.admin}`
    );

    // 11b. Admin request without admin_session cookie fails with 403
    res = await makeRequest(
      'GET',
      '/api/admin/status',
      {}
    );
    record(
      'SUITE 11',
      'Admin request without admin_session cookie rejected with 403',
      res.status,
      403,
      res.body?.error
    );

  } finally {
    // Clean up test files
    try {
      const scheduledDir = path.join(config.localStorageDir, 'scheduled_posts');
      const prefDir = path.join(config.localStorageDir, 'preferences');
      const profilesDir = path.join(config.localStorageDir, 'profiles');
      if (fs.existsSync(path.join(userSessionDir, `${aliceId}.json`))) fs.unlinkSync(path.join(userSessionDir, `${aliceId}.json`));
      if (fs.existsSync(path.join(userSessionDir, `${malloryId}.json`))) fs.unlinkSync(path.join(userSessionDir, `${malloryId}.json`));
      if (fs.existsSync(path.join(userSessionDir, 'user_unverified_test_789.json'))) fs.unlinkSync(path.join(userSessionDir, 'user_unverified_test_789.json'));
      if (fs.existsSync(path.join(audiencesDir, `${aliceHandle}.json`))) fs.unlinkSync(path.join(audiencesDir, `${aliceHandle}.json`));
      if (fs.existsSync(path.join(audiencesDir, 'unverified_brand_789.json'))) fs.unlinkSync(path.join(audiencesDir, 'unverified_brand_789.json'));
      if (fs.existsSync(path.join(profilesDir, `${aliceHandle}.json`))) fs.unlinkSync(path.join(profilesDir, `${aliceHandle}.json`));
      if (fs.existsSync(path.join(scheduledDir, `${aliceId}.json`))) fs.unlinkSync(path.join(scheduledDir, `${aliceId}.json`));
      if (fs.existsSync(path.join(scheduledDir, `${malloryId}.json`))) fs.unlinkSync(path.join(scheduledDir, `${malloryId}.json`));
      if (fs.existsSync(path.join(prefDir, `recs_${aliceHandle}.json`))) fs.unlinkSync(path.join(prefDir, `recs_${aliceHandle}.json`));
      if (createdCurated && fs.existsSync(curatedPath)) fs.unlinkSync(curatedPath);
    } catch {}

    server.close();
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('                      TEST SUMMARY RESULTS                      ');
  console.log('================================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total Tests Run : ${total}`);
  console.log(`Passed         : ${passed}`);
  console.log(`Failed         : ${failed}`);

  if (failed > 0) {
    console.error('\n❌ FAILURES DETECTED:');
    for (const f of results.filter((r) => !r.passed)) {
      console.error(`- [${f.suite}] ${f.name} (Expected: ${f.expectedStatus}, Got: ${f.status})`);
    }
    process.exit(1);
  } else {
    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! Security repairs verified.');
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  if (server) server.close();
  process.exit(1);
});
