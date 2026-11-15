import http from 'http';
import { NextRequest } from 'next/server';
import { signAdminSessionToken } from '../apps/web/src/lib/admin-auth.js';

interface CapturedRequest {
  url: string;
  method: string;
  headers: http.IncomingHttpHeaders;
}

let mockUpstream: http.Server;
let mockPort: number;
let lastCaptured: CapturedRequest | null = null;

async function startMockUpstream(): Promise<number> {
  return new Promise((resolve) => {
    mockUpstream = http.createServer((req, res) => {
      lastCaptured = {
        url: req.url || '',
        method: req.method || '',
        headers: req.headers,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
    mockUpstream.listen(0, '127.0.0.1', () => {
      const addr = mockUpstream.address() as any;
      mockPort = addr.port;
      resolve(mockPort);
    });
  });
}

async function run() {
  const port = await startMockUpstream();
  const TEST_ADMIN_SECRET = 'proxy_test_admin_secret_key_123';
  process.env.API_URL = `http://127.0.0.1:${port}`;
  process.env.ADMIN_SECRET_KEY = TEST_ADMIN_SECRET;

  const { GET, POST } = await import('../apps/web/src/app/api/proxy/[...path]/route.js');
  const validAdminToken = await signAdminSessionToken(TEST_ADMIN_SECRET);

  console.log('================================================================');
  console.log('   🔒 Post-Fix Proxy Audit: Verifying Allowlist & Header Strip  ');
  console.log('================================================================\n');

  let passedCount = 0;
  let totalCount = 0;

  function assertTest(name: string, condition: boolean, detail?: string) {
    totalCount++;
    if (condition) {
      passedCount++;
      console.log(`✅ PASS: ${name}${detail ? ` (${detail})` : ''}`);
    } else {
      console.error(`❌ FAIL: ${name}${detail ? ` (${detail})` : ''}`);
    }
  }

  // --- GROUP 1: Default Deny & Forbidden Routes ---
  console.log('--- GROUP 1: Path Allowlist & Default Deny ---');

  // 1a. Arbitrary unlisted path
  lastCaptured = null;
  let req = new NextRequest('http://localhost:3000/api/proxy/arbitrary/unlisted/route');
  let res = await GET(req, { params: { path: ['arbitrary', 'unlisted', 'route'] } });
  assertTest('Arbitrary path blocked by default deny (403)', res.status === 403 && lastCaptured === null, `Status: ${res.status}`);

  // 1b. /internal/tick strictly blocked for unauthenticated
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/internal/tick');
  res = await POST(req, { params: { path: ['internal', 'tick'] } });
  assertTest('Non-admin /internal/tick blocked through proxy (403)', res.status === 403 && lastCaptured === null);

  // 1c. /api/calendar/tick strictly blocked for unauthenticated
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/calendar/tick');
  res = await POST(req, { params: { path: ['api', 'calendar', 'tick'] } });
  assertTest('Non-admin /api/calendar/tick blocked through proxy (403)', res.status === 403 && lastCaptured === null);

  // 1d. /internal/tick strictly blocked even if admin session cookie present
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/internal/tick', {
    headers: { Cookie: `admin_session=${validAdminToken}` },
  });
  res = await POST(req, { params: { path: ['internal', 'tick'] } });
  assertTest('/internal/tick blocked through proxy even for admin (403)', res.status === 403 && lastCaptured === null);

  // --- GROUP 2: Non-Admin Privilege Escalation Prevention ---
  console.log('\n--- GROUP 2: Non-Admin Privilege Escalation Blocked ---');

  // 2a. /api/admin/* blocked for unauthenticated session
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/admin/status');
  res = await GET(req, { params: { path: ['api', 'admin', 'status'] } });
  assertTest('Non-admin /api/admin/* blocked through proxy (403)', res.status === 403 && lastCaptured === null);

  // 2b. /api/jobs/* blocked for unauthenticated session
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/jobs');
  res = await GET(req, { params: { path: ['api', 'jobs'] } });
  assertTest('Non-admin /api/jobs/* blocked through proxy (403)', res.status === 403 && lastCaptured === null);

  // 2c. /api/models/* blocked for unauthenticated session
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/models');
  res = await GET(req, { params: { path: ['api', 'models'] } });
  assertTest('Non-admin /api/models/* blocked through proxy (403)', res.status === 403 && lastCaptured === null);

  // 2d. /api/session/* blocked for unauthenticated session
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/session/status');
  res = await GET(req, { params: { path: ['api', 'session', 'status'] } });
  assertTest('Non-admin /api/session/* blocked through proxy (403)', res.status === 403 && lastCaptured === null);

  // 2e. Regular Clerk user session (not admin) attempting admin routes -> blocked (403)
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/admin/queue', {
    headers: {
      Authorization: 'Bearer clerk_regular_user_token_not_admin',
      Cookie: '__session=clerk_sess_123',
    },
  });
  res = await GET(req, { params: { path: ['api', 'admin', 'queue'] } });
  assertTest('Regular Clerk user cannot reach /api/admin/* through proxy (403)', res.status === 403 && lastCaptured === null);

  // --- GROUP 3: Header Stripping ---
  console.log('\n--- GROUP 3: Client Header Stripping ---');

  // 3a. Client-supplied Authorization is stripped
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/accounts', {
    headers: { Authorization: 'Bearer malicious_token_should_be_dropped' },
  });
  res = await GET(req, { params: { path: ['api', 'accounts'] } });
  assertTest('Client Authorization header stripped', lastCaptured?.headers['authorization'] === undefined);

  // 3b. Client-supplied x-admin-password is stripped
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/accounts', {
    headers: { 'x-admin-password': 'injected_admin_pass' },
  });
  res = await GET(req, { params: { path: ['api', 'accounts'] } });
  assertTest('Client x-admin-password header stripped', lastCaptured?.headers['x-admin-password'] === undefined);

  // 3c. Client-supplied x-forwarded-* headers are stripped
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/accounts', {
    headers: {
      'x-forwarded-for': '1.2.3.4',
      'x-forwarded-host': 'evil.com',
      'x-forwarded-proto': 'https',
    },
  });
  res = await GET(req, { params: { path: ['api', 'accounts'] } });
  const hasForwarded =
    lastCaptured?.headers['x-forwarded-for'] !== undefined ||
    lastCaptured?.headers['x-forwarded-host'] !== undefined ||
    lastCaptured?.headers['x-forwarded-proto'] !== undefined;
  assertTest('Client x-forwarded-* headers stripped', !hasForwarded);

  // 3d. Client-supplied arbitrary cookie headers are stripped
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/accounts', {
    headers: { Cookie: 'admin_auth=true; session_bypass=true' },
  });
  res = await GET(req, { params: { path: ['api', 'accounts'] } });
  assertTest('Client raw cookie header stripped', lastCaptured?.headers['cookie'] === undefined);

  // --- GROUP 4: Legitimate Verified Admin Requests ---
  console.log('\n--- GROUP 4: Legitimate Admin Session Through Proxy ---');

  // 4a. Verified admin session accesses /api/admin/status -> succeeds (200) and carries only admin_session
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/admin/status', {
    headers: { Cookie: `admin_session=${validAdminToken}` },
  });
  res = await GET(req, { params: { path: ['api', 'admin', 'status'] } });
  assertTest('Verified admin session reaches /api/admin/status (200)', res.status === 200 && lastCaptured?.url === '/api/admin/status');
  assertTest(
    'Upstream receives ONLY server-verified admin_session cookie',
    lastCaptured?.headers['cookie'] === `admin_session=${validAdminToken}`
  );

  // 4b. Verified admin session accesses /api/jobs -> succeeds (200)
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/jobs', {
    headers: { Cookie: `admin_session=${validAdminToken}` },
  });
  res = await GET(req, { params: { path: ['api', 'jobs'] } });
  assertTest('Verified admin session reaches /api/jobs (200)', res.status === 200 && lastCaptured?.url === '/api/jobs');

  mockUpstream.close();

  // --- GROUP 5: Real Admin Request Through Browser Route & Proxy to Live Express API ---
  console.log('\n--- GROUP 5: Real Admin Request Through Proxy to Live Express API ---');

  const REAL_ADMIN_SECRET = 'task2_live_express_admin_secret_987';
  process.env.ADMIN_SECRET_KEY = REAL_ADMIN_SECRET;
  process.env.ADMIN_PASSWORD = REAL_ADMIN_SECRET;

  // 5a. Start real Express application
  const { default: expressApp } = await import('../apps/api/src/index.js');
  let realExpressServer: http.Server;
  let realExpressPort: number;

  await new Promise<void>((resolve) => {
    realExpressServer = expressApp.listen(0, '127.0.0.1', () => {
      const addr = realExpressServer.address() as any;
      realExpressPort = addr.port;
      resolve();
    });
  });

  process.env.API_URL = `http://127.0.0.1:${realExpressPort}`;

  // 5b. Log in as admin through Next.js browser route POST /api/auth/login
  const { POST: loginRoutePost } = await import('../apps/web/src/app/api/auth/login/route.js');
  const loginReq = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password: REAL_ADMIN_SECRET }),
  });
  const loginRes = await loginRoutePost(loginReq);
  const loginBody = await loginRes.json();
  const rawSetCookie = loginRes.headers.get('set-cookie') || '';
  const matchCookie = rawSetCookie.match(/admin_session=([^;]+)/);
  const browserAdminCookie = matchCookie ? matchCookie[1] : '';

  assertTest('POST /api/auth/login returns 200 with { success: true }', loginRes.status === 200 && loginBody.success === true);
  assertTest('POST /api/auth/login issues HttpOnly admin_session cookie', browserAdminCookie.length > 0 && rawSetCookie.includes('HttpOnly'));

  // 5c. Send real admin request GET /api/proxy/api/admin/status with browser-issued cookie
  const proxyReq = new NextRequest('http://localhost:3000/api/proxy/api/admin/status', {
    headers: {
      Cookie: `admin_session=${browserAdminCookie}`,
    },
  });
  const proxyRes = await GET(proxyReq, { params: { path: ['api', 'admin', 'status'] } });
  const realExpressBody = await proxyRes.json();

  assertTest(
    'GET /api/proxy/api/admin/status returns 200 with real Express body',
    proxyRes.status === 200 &&
    realExpressBody.status === 'ok' &&
    realExpressBody.admin === true &&
    typeof realExpressBody.totalAccountsTracked === 'number' &&
    typeof realExpressBody.serverUptime === 'number'
  );
  console.log('   [Express Access Proof] Upstream payload received:', JSON.stringify(realExpressBody));

  // 5d. Missing admin cookie fails with 403 and body contains no secret
  const unauthProxyReq = new NextRequest('http://localhost:3000/api/proxy/api/admin/status');
  const unauthProxyRes = await GET(unauthProxyReq, { params: { path: ['api', 'admin', 'status'] } });
  const unauthBody = await unauthProxyRes.json();
  const unauthBodyStr = JSON.stringify(unauthBody);

  assertTest(
    'GET /api/proxy/api/admin/status with missing cookie returns 403',
    unauthProxyRes.status === 403
  );
  assertTest(
    'Missing cookie 403 response contains no secrets',
    !unauthBodyStr.includes(REAL_ADMIN_SECRET) && !unauthBodyStr.includes(browserAdminCookie)
  );

  // 5e. Tampered admin cookie fails with 403 and body contains no secret
  const tamperedProxyReq = new NextRequest('http://localhost:3000/api/proxy/api/admin/status', {
    headers: {
      Cookie: 'admin_session=tampered.token.value',
    },
  });
  const tamperedProxyRes = await GET(tamperedProxyReq, { params: { path: ['api', 'admin', 'status'] } });
  const tamperedBody = await tamperedProxyRes.json();
  const tamperedBodyStr = JSON.stringify(tamperedBody);

  assertTest(
    'GET /api/proxy/api/admin/status with tampered cookie returns 403',
    tamperedProxyRes.status === 403
  );
  assertTest(
    'Tampered cookie 403 response contains no secrets',
    !tamperedBodyStr.includes(REAL_ADMIN_SECRET) && !tamperedBodyStr.includes('tampered.token.value')
  );

  realExpressServer.close();

  console.log('\n================================================================');
  console.log(`Summary: ${passedCount} / ${totalCount} Proxy Security Tests Passed`);
  console.log('================================================================');

  if (passedCount !== totalCount) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(err);
  if (mockUpstream) mockUpstream.close();
  process.exit(1);
});
