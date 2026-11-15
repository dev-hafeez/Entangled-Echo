import http from 'http';
import { NextRequest } from 'next/server';

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
      res.end(JSON.stringify({ ok: true }));
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
  process.env.API_URL = `http://127.0.0.1:${port}`;
  process.env.ADMIN_SECRET_KEY = 'test_secret_for_proxy_audit';

  const { GET, POST } = await import('../apps/web/src/app/api/proxy/[...path]/route.js');

  console.log('================================================================');
  console.log('   🚨 Pre-Fix Proxy Audit: Probing Existing Route Handler      ');
  console.log('================================================================\n');

  // Test 1: Arbitrary Path Forwarding
  lastCaptured = null;
  let req = new NextRequest('http://localhost:3000/api/proxy/arbitrary/path');
  let res = await GET(req, { params: { path: ['arbitrary', 'path'] } });
  console.log(`Probe 1 [Arbitrary Path]: Status=${res.status}, ForwardedTo=${lastCaptured?.url}`);

  // Test 2: Internal / Tick Forwarding
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/internal/tick');
  res = await POST(req, { params: { path: ['internal', 'tick'] } });
  console.log(`Probe 2 [Internal Tick]: Status=${res.status}, ForwardedTo=${lastCaptured?.url}`);

  // Test 3: Calendar Tick Forwarding
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/calendar/tick');
  res = await POST(req, { params: { path: ['api', 'calendar', 'tick'] } });
  console.log(`Probe 3 [Calendar Tick]: Status=${res.status}, ForwardedTo=${lastCaptured?.url}`);

  // Test 4: Admin route without admin session
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/admin/status');
  res = await GET(req, { params: { path: ['api', 'admin', 'status'] } });
  console.log(`Probe 4 [Admin Status without Session]: Status=${res.status}, ForwardedTo=${lastCaptured?.url}`);

  // Test 5: Client-supplied Authorization header
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/accounts', {
    headers: { Authorization: 'Bearer client_injected_attacker_token' },
  });
  res = await GET(req, { params: { path: ['api', 'accounts'] } });
  console.log(`Probe 5 [Client Authorization Header]: ForwardedAuth=${lastCaptured?.headers['authorization']}`);

  // Test 6: Client-supplied Cookie header
  lastCaptured = null;
  req = new NextRequest('http://localhost:3000/api/proxy/api/accounts', {
    headers: { Cookie: 'admin_auth=true; injected_cookie=malicious' },
  });
  res = await GET(req, { params: { path: ['api', 'accounts'] } });
  console.log(`Probe 6 [Client Cookie Header]: ForwardedCookie=${lastCaptured?.headers['cookie']}`);

  mockUpstream.close();
}

run().catch((err) => {
  console.error(err);
  if (mockUpstream) mockUpstream.close();
  process.exit(1);
});
