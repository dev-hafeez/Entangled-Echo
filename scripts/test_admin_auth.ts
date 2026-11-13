import http from 'http';
import app from '../apps/api/src/index.js';

async function run() {
  console.log('================================================================');
  console.log('   FR-06: Role-Based Access Control (403 on Admin Routes) Test  ');
  console.log('================================================================\n');

  // Start express app on ephemeral port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Test 1: GET /api/admin/status without credentials -> 403 Forbidden
    console.log('Test 1: Requesting /api/admin/status without credentials...');
    const res1 = await fetch(`${baseUrl}/api/admin/status`);
    console.log(`  HTTP Status: ${res1.status} (expected 403)`);
    const body1 = await res1.json();
    console.log('  Response body:', body1);
    if (res1.status !== 403) {
      throw new Error(`Expected HTTP 403, got ${res1.status}`);
    }
    console.log('  [PASS] Unauthenticated request correctly rejected with 403 Forbidden.\n');

    // Test 2: GET /api/admin/queue with invalid password -> 403 Forbidden
    console.log('Test 2: Requesting /api/admin/queue with wrong password...');
    const res2 = await fetch(`${baseUrl}/api/admin/queue`, {
      headers: { 'x-admin-password': 'wrong_password_123' },
    });
    console.log(`  HTTP Status: ${res2.status} (expected 403)`);
    if (res2.status !== 403) {
      throw new Error(`Expected HTTP 403, got ${res2.status}`);
    }
    console.log('  [PASS] Invalid credentials correctly rejected with 403 Forbidden.\n');

    // Test 3: GET /api/admin/status with valid x-admin-password header -> 200 OK
    console.log('Test 3: Requesting /api/admin/status with valid x-admin-password header...');
    const res3 = await fetch(`${baseUrl}/api/admin/status`, {
      headers: { 'x-admin-password': 'admin123' },
    });
    console.log(`  HTTP Status: ${res3.status} (expected 200)`);
    const body3 = await res3.json();
    console.log('  Admin metrics response:', {
      status: body3.status,
      admin: body3.admin,
      totalAccountsTracked: body3.totalAccountsTracked,
    });
    if (res3.status !== 200 || !body3.admin) {
      throw new Error(`Expected HTTP 200 with admin=true, got ${res3.status}`);
    }
    console.log('  [PASS] Valid admin credentials accepted with 200 OK.\n');

    // Test 4: GET /api/admin/queue with admin_auth=true cookie -> 200 OK
    console.log('Test 4: Requesting /api/admin/queue with admin_auth=true cookie...');
    const res4 = await fetch(`${baseUrl}/api/admin/queue`, {
      headers: { cookie: 'admin_auth=true' },
    });
    console.log(`  HTTP Status: ${res4.status} (expected 200)`);
    const body4 = await res4.json();
    if (res4.status !== 200 || !body4.summary) {
      throw new Error(`Expected HTTP 200 with queue summary, got ${res4.status}`);
    }
    console.log('  [PASS] Valid admin cookie accepted with 200 OK.\n');

    console.log('================================================================');
    console.log('   FR-06 VERIFICATION COMPLETE: ALL 4 ROLE-ACCESS TESTS PASSED   ');
    console.log('================================================================');
    process.exit(0);
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('FR-06 test failed:', err);
  process.exit(1);
});
