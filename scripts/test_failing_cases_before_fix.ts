/**
 * Test suite capturing the vulnerabilities BEFORE fixes are applied.
 * All tests in this suite are expected to FAIL on the unpatched code.
 */

import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import app from '../apps/api/src/index.js';
import { config } from '../apps/api/src/config.js';

// Setup isolated RSA keypair for hermetic cryptographic verification
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

config.clerkJwtKey = publicKey;
config.clerkAuthorizedParties = ['http://localhost:3000', 'http://127.0.0.1:3000'];
config.adminPassword = 'test_secure_admin_key_step2_2026_audit';

const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function createToken(sub: string, claims: Record<string, any> = {}): string {
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const payload = b64({
    sub,
    sid: `sess_${Date.now()}`,
    azp: 'http://localhost:3000',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...claims,
  });
  const data = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data);
  return `${data}.${sign.sign(privateKey).toString('base64url')}`;
}

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
    const reqHeaders: Record<string, string> = { ...headers };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData).toString();
    }

    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed: any = raw;
        try { parsed = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode || 0, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

interface TestResult {
  name: string;
  passed: boolean;
  actualStatus: number;
  expectedStatus: number | number[];
  detail?: string;
}

const results: TestResult[] = [];

function record(name: string, actualStatus: number, expectedStatus: number | number[], passed: boolean, detail?: string) {
  results.push({ name, passed, actualStatus, expectedStatus, detail });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [${actualStatus}] ${name}${detail ? ` - ${detail}` : ''}`);
}

async function runPreFixTests() {
  console.log('================================================================');
  console.log('   🚨 Pre-Remediation Vulnerability Suite (Expecting FAILURES)  ');
  console.log('================================================================\n');

  const aliceId = 'user_alice_test_123';
  const aliceHandle = 'alice_brand';
  const malloryId = 'user_mallory_attacker_456';
  const malloryHandle = 'mallory_brand';

  const aliceToken = createToken(aliceId);
  const malloryToken = createToken(malloryId);

  // Setup test directories
  const userSessionDir = path.join(config.localStorageDir, 'user_sessions');
  const profilesDir = path.join(config.localStorageDir, 'profiles');
  const audiencesDir = path.join(config.localStorageDir, 'audiences');
  const scheduledDir = path.join(config.localStorageDir, 'scheduled_posts');
  const prefDir = path.join(config.localStorageDir, 'preferences');

  if (!fs.existsSync(userSessionDir)) fs.mkdirSync(userSessionDir, { recursive: true });
  if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
  if (!fs.existsSync(audiencesDir)) fs.mkdirSync(audiencesDir, { recursive: true });
  if (!fs.existsSync(prefDir)) fs.mkdirSync(prefDir, { recursive: true });

  // Alice is the legitimate verified owner of alice_brand
  fs.writeFileSync(
    path.join(userSessionDir, `${aliceId}.json`),
    JSON.stringify({ userId: aliceId, handle: aliceHandle, isVerified: true, updatedAt: new Date().toISOString() }, null, 2)
  );

  fs.writeFileSync(
    path.join(profilesDir, `${aliceHandle}.json`),
    JSON.stringify({ id: 'acc_alice', handle: aliceHandle, followers_count: 5000 }, null, 2)
  );

  fs.writeFileSync(
    path.join(audiencesDir, `${aliceHandle}.json`),
    JSON.stringify({ handle: aliceHandle, source: 'graph_api', demographics: [] }, null, 2)
  );

  fs.writeFileSync(
    path.join(prefDir, `recs_${aliceHandle}.json`),
    JSON.stringify({ handle: aliceHandle, formatWeights: { reel: 1.5 }, likedTopics: ['secret_strategy'] }, null, 2)
  );

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
    // VULNERABILITY 1 (FIX 2): Onboarding duplicate handle must be rejected with 409
    // -------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Handle Ownership & Uniqueness (FIX 2) ---');
    let res = await makeRequest(
      'POST',
      '/api/onboarding/user-profile',
      { Authorization: `Bearer ${malloryToken}` },
      { handle: aliceHandle } // Mallory attempts to claim Alice's handle
    );
    const dupHandlePassed = res.status === 409;
    record(
      'FIX 2.1: POST /api/onboarding/user-profile rejects duplicate handle with 409',
      res.status,
      409,
      dupHandlePassed,
      dupHandlePassed ? 'Duplicate rejected' : 'VULNERABILITY: Overwrote or allowed duplicate handle'
    );

    // -------------------------------------------------------------------------
    // VULNERABILITY 2 (FIX 2): Unverified self-asserted handle must not grant access
    // -------------------------------------------------------------------------
    // Mallory sets an unverified handle
    res = await makeRequest(
      'POST',
      '/api/onboarding/user-profile',
      { Authorization: `Bearer ${malloryToken}` },
      { handle: 'mallory_unverified_target' }
    );
    // Now Mallory tries to query audience for mallory_unverified_target
    // Setup dummy audience for mallory_unverified_target
    fs.writeFileSync(
      path.join(audiencesDir, 'mallory_unverified_target.json'),
      JSON.stringify({ handle: 'mallory_unverified_target', source: 'graph_api' }, null, 2)
    );
    res = await makeRequest(
      'GET',
      '/api/accounts/mallory_unverified_target/audience',
      { Authorization: `Bearer ${malloryToken}` }
    );
    const unverifiedAccessPassed = res.status === 403;
    record(
      'FIX 2.2: Self-asserted onboarding handle without proof denies audience access (403)',
      res.status,
      403,
      unverifiedAccessPassed,
      unverifiedAccessPassed ? 'Denied unverified handle' : 'VULNERABILITY: Granted access to unverified handle'
    );

    // -------------------------------------------------------------------------
    // VULNERABILITY 3 (FIX 3): DELETE /api/accounts/:idOrHandle must require admin
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Authorization on Mutations (FIX 3) ---');
    res = await makeRequest(
      'DELETE',
      `/api/accounts/${aliceHandle}`,
      { Authorization: `Bearer ${malloryToken}` } // Mallory is not admin
    );
    const fileStillExists = fs.existsSync(path.join(profilesDir, `${aliceHandle}.json`));
    const deletePassed = res.status === 403 && fileStillExists;
    record(
      'FIX 3.1: Non-admin DELETE /api/accounts/:handle rejected with 403 and files preserved',
      res.status,
      403,
      deletePassed,
      deletePassed ? 'Blocked non-admin' : `VULNERABILITY: File deleted?: ${!fileStillExists}`
    );

    // Restore alice profile file if it was deleted by the vulnerability
    if (!fs.existsSync(path.join(profilesDir, `${aliceHandle}.json`))) {
      fs.writeFileSync(
        path.join(profilesDir, `${aliceHandle}.json`),
        JSON.stringify({ id: 'acc_alice', handle: aliceHandle, followers_count: 5000 }, null, 2)
      );
    }

    // -------------------------------------------------------------------------
    // VULNERABILITY 4 (FIX 3): POST /api/calendar/tick must reject anonymous call
    // -------------------------------------------------------------------------
    res = await makeRequest('POST', '/api/calendar/tick');
    const calendarTickPassed = res.status === 401 || res.status === 404;
    record(
      'FIX 3.2: Anonymous POST /api/calendar/tick rejected (401 or 404)',
      res.status,
      [401, 404],
      calendarTickPassed,
      calendarTickPassed ? 'Anonymous ticker blocked' : 'VULNERABILITY: Anonymous ticker executed'
    );

    // -------------------------------------------------------------------------
    // VULNERABILITY 5 (FIX 3): /internal/tick must fail closed when secret unset
    // -------------------------------------------------------------------------
    const oldSecret = process.env.INTERNAL_TICK_SECRET;
    delete process.env.INTERNAL_TICK_SECRET;
    res = await makeRequest('POST', '/internal/tick');
    if (oldSecret) process.env.INTERNAL_TICK_SECRET = oldSecret;
    const internalTickClosedPassed = res.status === 503 || res.status === 401;
    record(
      'FIX 3.3: POST /internal/tick fails closed (503/401) when secret is unset',
      res.status,
      [503, 401],
      internalTickClosedPassed,
      internalTickClosedPassed ? 'Fails closed' : 'VULNERABILITY: Fails open (executed without secret)'
    );

    // -------------------------------------------------------------------------
    // VULNERABILITY 6 (FIX 3): PATCH post cannot reassign accountHandle to victim
    // -------------------------------------------------------------------------
    // Mallory creates a post for her own verified account
    fs.writeFileSync(
      path.join(userSessionDir, `${malloryId}.json`),
      JSON.stringify({ userId: malloryId, handle: malloryHandle, isVerified: true }, null, 2)
    );
    res = await makeRequest(
      'POST',
      '/api/calendar/posts',
      { Authorization: `Bearer ${malloryToken}` },
      { accountHandle: malloryHandle, caption: 'Mallory post', scheduledTime: new Date(Date.now() + 86400000).toISOString() }
    );
    const malloryPostId = res.body?.post?.id;

    // Mallory tries to PATCH post to aliceHandle
    res = await makeRequest(
      'PATCH',
      `/api/calendar/posts/${malloryPostId}`,
      { Authorization: `Bearer ${malloryToken}` },
      { accountHandle: aliceHandle }
    );
    const patchHandlePassed = res.status === 403;
    record(
      'FIX 3.4: PATCH /api/calendar/posts/:id cannot reassign accountHandle to unowned account (403)',
      res.status,
      403,
      patchHandlePassed,
      patchHandlePassed ? 'Handle reassignment blocked' : 'VULNERABILITY: Reassigned post to unowned handle'
    );

    // -------------------------------------------------------------------------
    // VULNERABILITY 7 (FIX 3): GET /api/recommendations/preferences enforces ownership
    // -------------------------------------------------------------------------
    res = await makeRequest(
      'GET',
      `/api/recommendations/preferences?handle=${aliceHandle}`,
      { Authorization: `Bearer ${malloryToken}` }
    );
    const recPrefsPassed = res.status === 403;
    record(
      'FIX 3.5: GET /api/recommendations/preferences rejects unauthorized user (403)',
      res.status,
      403,
      recPrefsPassed,
      recPrefsPassed ? 'Preferences protected' : 'VULNERABILITY: Leaked victim preferences'
    );

    // -------------------------------------------------------------------------
    // VULNERABILITY 8 (FIX 3): POST /api/models/train-personal/:handle enforces ownership
    // -------------------------------------------------------------------------
    res = await makeRequest(
      'POST',
      `/api/models/train-personal/${aliceHandle}`,
      { Authorization: `Bearer ${malloryToken}` }
    );
    const trainModelPassed = res.status === 403;
    record(
      'FIX 3.6: POST /api/models/train-personal/:handle rejects unauthorized user (403)',
      res.status,
      403,
      trainModelPassed,
      trainModelPassed ? 'Training protected' : 'VULNERABILITY: Triggered training for unowned handle'
    );

  } finally {
    // Clean up
    try {
      if (fs.existsSync(path.join(userSessionDir, `${aliceId}.json`))) fs.unlinkSync(path.join(userSessionDir, `${aliceId}.json`));
      if (fs.existsSync(path.join(userSessionDir, `${malloryId}.json`))) fs.unlinkSync(path.join(userSessionDir, `${malloryId}.json`));
      if (fs.existsSync(path.join(profilesDir, `${aliceHandle}.json`))) fs.unlinkSync(path.join(profilesDir, `${aliceHandle}.json`));
      if (fs.existsSync(path.join(audiencesDir, `${aliceHandle}.json`))) fs.unlinkSync(path.join(audiencesDir, `${aliceHandle}.json`));
      if (fs.existsSync(path.join(audiencesDir, 'mallory_unverified_target.json'))) fs.unlinkSync(path.join(audiencesDir, 'mallory_unverified_target.json'));
      if (fs.existsSync(path.join(prefDir, `recs_${aliceHandle}.json`))) fs.unlinkSync(path.join(prefDir, `recs_${aliceHandle}.json`));
      if (fs.existsSync(path.join(scheduledDir, `${malloryId}.json`))) fs.unlinkSync(path.join(scheduledDir, `${malloryId}.json`));
    } catch {}

    server.close();
  }

  console.log('\n================================================================');
  console.log('                 PRE-REMEDIATION SUMMARY                        ');
  console.log('================================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total Vulnerability Probes : ${total}`);
  console.log(`Passing Security Checks    : ${passed}`);
  console.log(`Failing Security Checks    : ${failed}`);

  console.log('\n--- Confirmed Unpatched Vulnerabilities ---');
  for (const f of results.filter((r) => !r.passed)) {
    console.log(`❌ ${f.name} (Expected: ${f.expectedStatus}, Got: ${f.actualStatus} - ${f.detail})`);
  }
  process.exit(0);
}

runPreFixTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  if (server) server.close();
  process.exit(1);
});
