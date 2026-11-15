import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import app from '../apps/api/src/index.js';
import { config } from '../apps/api/src/config.js';
import {
  findUserByHandle,
  migrateDuplicateHandles,
  getUserLinkedHandleRecord,
  isUserAccountOwnerOrAdmin,
  normalizeHandle,
} from '../apps/api/src/lib/auth.js';

const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// Hermetic RSA keypair for JWT generation
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

config.clerkJwtKey = publicKey;
config.clerkAuthorizedParties = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function createToken(sub: string): string {
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const payload = b64({
    sub,
    sid: `sess_${Date.now()}`,
    azp: 'http://localhost:3000',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
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

function hashFile(filepath: string): string {
  const content = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashDirectory(dirpath: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  if (!fs.existsSync(dirpath)) return hashes;
  const files = fs.readdirSync(dirpath).sort();
  for (const f of files) {
    if (f.endsWith('.json')) {
      hashes[f] = hashFile(path.join(dirpath, f));
    }
  }
  return hashes;
}

async function runTask2Tests() {
  console.log('================================================================');
  console.log('   🧪 TASK 2: Uniqueness, Normalization & Non-Destructive Audit ');
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

  // --- SUBTASK A: Scratch Directory Legacy Duplicate Reproduction ---
  console.log('--- SUBTASK A: Legacy Duplicate Reproduction in Scratch Directory ---');
  const scratchDir = path.join(config.localStorageDir, 'scratch_test_sessions_' + Date.now());
  fs.mkdirSync(scratchDir, { recursive: true });

  const realSessionFile = path.join(config.localStorageDir, 'user_sessions', 'user_3LbIhpWdZgIfGoQoi8h3aKxncvH.json');
  const realSessionContent = JSON.parse(fs.readFileSync(realSessionFile, 'utf-8'));

  // 1. Copy real legitimate binding to scratch
  fs.writeFileSync(
    path.join(scratchDir, 'user_3LbIhpWdZgIfGoQoi8h3aKxncvH.json'),
    JSON.stringify(realSessionContent, null, 2)
  );

  // 2. Create duplicate file binding same handle with a later timestamp
  const dupUserId = 'user_attacker_duplicate_999';
  const dupSessionContent = {
    userId: dupUserId,
    handle: 'nightcreeper24',
    languagePreference: 'English',
    nicheData: null,
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
  };
  fs.writeFileSync(
    path.join(scratchDir, `${dupUserId}.json`),
    JSON.stringify(dupSessionContent, null, 2)
  );

  // Run migration/inventory on scratch directory
  const scratchInventory = migrateDuplicateHandles(scratchDir);
  assertTest(
    'Migration accurately detected 1 duplicate in scratch dataset',
    scratchInventory.duplicatesMigrated === 1,
    `Duplicates: ${scratchInventory.duplicatesMigrated}, Unique: ${scratchInventory.uniqueHandles}`
  );

  assertTest(
    'Canonical user for nightcreeper24 is legitimate original user, not duplicate',
    scratchInventory.duplicateDetails[0]?.canonicalUserId === 'user_3LbIhpWdZgIfGoQoi8h3aKxncvH' &&
    scratchInventory.duplicateDetails[0]?.duplicateUserIds.includes(dupUserId)
  );

  // Authoritative resolver returns original user
  const resolved = findUserByHandle('nightcreeper24', scratchDir);
  assertTest(
    'findUserByHandle resolves strictly to original legitimate user',
    resolved?.userId === 'user_3LbIhpWdZgIfGoQoi8h3aKxncvH'
  );

  // Clean scratch directory
  fs.rmSync(scratchDir, { recursive: true, force: true });

  // --- SUBTASK B: Normalization Invariant Testing (5 Users, 4 Handle Variants) ---
  console.log('\n--- SUBTASK B: Handle Normalization Consistency (5 Users × 4 Variants) ---');

  const testUsers = [
    'user_alpha_1',
    'user_beta_2',
    'user_gamma_3',
    'user_delta_4',
    'user_epsilon_5',
  ];

  const handleVariants = [
    { variant: 'NightCreeper24', type: 'Case variation (mixed uppercase)' },
    { variant: '@nightcreeper24', type: 'Leading @ symbol' },
    { variant: '  nightcreeper24  ', type: 'Leading & trailing whitespace' },
    { variant: 'ｎｉｇｈｔｃｒｅｅｐｅｒ２４', type: 'Unicode NFKC fullwidth characters' },
  ];

  for (const h of handleVariants) {
    const normalized = normalizeHandle(h.variant);
    assertTest(
      `normalizeHandle normalizes [${h.type}] "${h.variant}" -> "nightcreeper24"`,
      normalized === 'nightcreeper24'
    );
  }

  // Verify findUserByHandle with each variant matches the real nightcreeper24
  for (const h of handleVariants) {
    const found = findUserByHandle(h.variant);
    assertTest(
      `findUserByHandle recognizes variant "${h.variant}" as @nightcreeper24`,
      found !== null && found.handle === 'nightcreeper24'
    );
  }

  // --- SUBTASK C: Endpoints Protection Under Live HTTP ---
  console.log('\n--- SUBTASK C: Onboarding & Ownership Protection for Existing Handle ---');

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  try {
    // Test all 5 users attempting to claim variants of nightcreeper24 via onboarding
    for (let i = 0; i < testUsers.length; i++) {
      const uId = testUsers[i];
      const token = createToken(uId);
      const variant = handleVariants[i % handleVariants.length].variant;

      const res = await makeRequest(
        'POST',
        '/api/onboarding/user-profile',
        { Authorization: `Bearer ${token}` },
        { handle: variant }
      );

      assertTest(
        `User ${uId} attempting to claim "${variant}" rejected with 409 Conflict`,
        res.status === 409,
        `Status: ${res.status}`
      );
    }

    // Verify isUserAccountOwnerOrAdmin denies all 5 unauthorized users for each variant
    for (const uId of testUsers) {
      for (const h of handleVariants) {
        const dummyReq: any = {
          auth: { userId: uId, isAdmin: false },
        };
        const isOwner = isUserAccountOwnerOrAdmin(dummyReq, h.variant);
        assertTest(
          `isUserAccountOwnerOrAdmin returns false for ${uId} on "${h.variant}"`,
          isOwner === false
        );
      }
    }
  } finally {
    server.close();
  }

  // --- SUBTASK D: Non-Destructive Guarantee: Hashes Before vs After Migration ---
  console.log('\n--- SUBTASK D: Non-Destructive Migration Proof (Hash Before & After) ---');
  const userSessionsDir = path.join(config.localStorageDir, 'user_sessions');

  const hashesBefore = hashDirectory(userSessionsDir);
  console.log('Hashes BEFORE migration:');
  for (const [file, h] of Object.entries(hashesBefore)) {
    console.log(`  ${file}: ${h}`);
  }

  // Run migration on live user_sessions directory
  const liveResult = migrateDuplicateHandles();
  console.log(`\nMigration output: duplicatesMigrated=${liveResult.duplicatesMigrated}, uniqueHandles=${liveResult.uniqueHandles}`);

  const hashesAfter = hashDirectory(userSessionsDir);
  console.log('Hashes AFTER migration:');
  for (const [file, h] of Object.entries(hashesAfter)) {
    console.log(`  ${file}: ${h}`);
  }

  // Compare file by file
  let allMatched = true;
  for (const file of Object.keys(hashesBefore)) {
    if (hashesBefore[file] !== hashesAfter[file]) {
      allMatched = false;
      console.error(`❌ MISMATCH in ${file}! File was modified!`);
    }
  }

  assertTest(
    'Migration is 100% non-destructive: zero files deleted or rewritten in storage/user_sessions',
    allMatched && Object.keys(hashesBefore).length === Object.keys(hashesAfter).length
  );

  console.log('\n================================================================');
  console.log(`Task 2 Summary: ${passed} / ${total} Tests Passed`);
  console.log('================================================================');

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTask2Tests().catch((err) => {
  console.error('Task 2 execution fatal error:', err);
  if (server) server.close();
  process.exit(1);
});
