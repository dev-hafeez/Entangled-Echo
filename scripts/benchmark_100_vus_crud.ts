import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { performance } from 'perf_hooks';
import app from '../apps/api/src/index.js';
import { config } from '../apps/api/src/config.js';

// Setup hermetic RSA verification keys for load testing
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
config.clerkJwtKey = publicKey;
config.clerkAuthorizedParties = ['http://localhost:3000', 'http://127.0.0.1:3000'];

const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function createToken(userId: string): string {
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const payload = b64({
    sub: userId,
    sid: `sess_${Date.now()}_${userId}`,
    azp: 'http://localhost:3000',
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  });
  const data = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data);
  return `${data}.${sign.sign(privateKey).toString('base64url')}`;
}

async function run() {
  console.log('================================================================');
  console.log('   NFR 4.1.2: 100 Concurrent Virtual Users (VUs) CRUD Benchmark ');
  console.log('================================================================\n');

  // Start express app on ephemeral port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const CONCURRENT_VUS = 100;
  const ITERATIONS_PER_VU = 5;
  const TOTAL_PLANNED_OPS = CONCURRENT_VUS * ITERATIONS_PER_VU * 4; // 4 CRUD operations per iteration = 2,000 ops

  console.log(`Launching ${CONCURRENT_VUS} concurrent Virtual Users (VUs)...`);
  console.log(`Iterations per VU: ${ITERATIONS_PER_VU} | Target: 2,000 total CRUD operations`);
  console.log(`Target SLA: p95 latency < 500 ms | Error rate < 1.0%\n`);

  const latencies: number[] = [];
  let successfulOps = 0;
  let failedOps = 0;

  const vuWorkers = Array.from({ length: CONCURRENT_VUS }, async (_, vuId) => {
    const userId = `vu_user_${vuId.toString().padStart(3, '0')}`;
    const token = createToken(userId);
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    for (let iter = 0; iter < ITERATIONS_PER_VU; iter++) {
      // 1. CREATE: Schedule a post
      let createdPostId = '';
      try {
        const t0 = performance.now();
        const createRes = await fetch(`${baseUrl}/api/calendar/posts`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            userId,
            accountHandle: 'cristiano',
            caption: `Load test post from VU ${vuId} iter ${iter}`,
            hashtags: ['loadtest', 'nfr412'],
            mediaType: 'image',
            platform: 'instagram',
            scheduledTime: new Date(Date.now() + 3600000 + iter * 60000).toISOString(),
            status: 'SCHEDULED',
          }),
        });
        const t1 = performance.now();
        latencies.push(t1 - t0);

        if (createRes.ok) {
          const body = await createRes.json();
          createdPostId = body.post?.id || '';
          successfulOps++;
        } else {
          failedOps++;
        }
      } catch {
        failedOps++;
      }

      // 2. READ: Fetch scheduled posts
      try {
        const t0 = performance.now();
        const readRes = await fetch(`${baseUrl}/api/calendar/posts`, {
          headers: authHeaders,
        });
        const t1 = performance.now();
        latencies.push(t1 - t0);

        if (readRes.ok) successfulOps++;
        else failedOps++;
      } catch {
        failedOps++;
      }

      // 3. UPDATE: Reschedule post
      if (createdPostId) {
        try {
          const t0 = performance.now();
          const updateRes = await fetch(`${baseUrl}/api/calendar/posts/${createdPostId}/reschedule`, {
            method: 'PATCH',
            headers: authHeaders,
            body: JSON.stringify({
              userId,
              newScheduledTime: new Date(Date.now() + 7200000).toISOString(),
            }),
          });
          const t1 = performance.now();
          latencies.push(t1 - t0);

          if (updateRes.ok) successfulOps++;
          else failedOps++;
        } catch {
          failedOps++;
        }

        // 4. DELETE: Cancel/delete scheduled post
        try {
          const t0 = performance.now();
          const deleteRes = await fetch(`${baseUrl}/api/calendar/posts/${createdPostId}`, {
            method: 'DELETE',
            headers: authHeaders,
          });
          const t1 = performance.now();
          latencies.push(t1 - t0);

          if (deleteRes.ok) successfulOps++;
          else failedOps++;
        } catch {
          failedOps++;
        }
      }
    }
  });

  const wallClockStart = performance.now();
  await Promise.all(vuWorkers);
  const wallClockDurationMs = performance.now() - wallClockStart;

  // Compute metrics
  latencies.sort((a, b) => a - b);
  const totalOps = successfulOps + failedOps;
  const errorRatePct = totalOps > 0 ? (failedOps / totalOps) * 100 : 0;
  const meanLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const variance = latencies.reduce((acc, v) => acc + Math.pow(v - meanLatency, 2), 0) / latencies.length;
  const stdLatency = Math.sqrt(variance);

  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p90 = latencies[Math.floor(latencies.length * 0.90)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const throughputRps = (totalOps / (wallClockDurationMs / 1000.0));

  const passed = p95 < 500 && errorRatePct < 1.0;

  console.log('----------------------------------------------------------------');
  console.log('Load Test Execution Results:');
  console.log(`  Concurrent VUs       : ${CONCURRENT_VUS}`);
  console.log(`  Total CRUD Operations: ${totalOps}`);
  console.log(`  Successful Ops       : ${successfulOps}`);
  console.log(`  Failed Ops           : ${failedOps}`);
  console.log(`  Error Rate           : ${errorRatePct.toFixed(2)}% (Target < 1.0%: ${errorRatePct < 1.0 ? 'PASS' : 'FAIL'})`);
  console.log(`  Wall-Clock Duration  : ${(wallClockDurationMs / 1000.0).toFixed(2)} s`);
  console.log(`  Throughput           : ${throughputRps.toFixed(1)} req/sec`);
  console.log('\nLatency Distribution:');
  console.log(`  Mean : ${meanLatency.toFixed(2)} ms`);
  console.log(`  Std  : ${stdLatency.toFixed(2)} ms`);
  console.log(`  p50  : ${p50.toFixed(2)} ms`);
  console.log(`  p90  : ${p90.toFixed(2)} ms`);
  console.log(`  p95  : ${p95.toFixed(2)} ms (Target < 500 ms: ${p95 < 500 ? 'PASS' : 'FAIL'})`);
  console.log(`  p99  : ${p99.toFixed(2)} ms`);
  console.log(`  Min  : ${latencies[0].toFixed(2)} ms`);
  console.log(`  Max  : ${latencies[latencies.length - 1].toFixed(2)} ms`);
  console.log(`\nOverall NFR 4.1.2 Verdict: ${passed ? 'PASS' : 'FAIL'}`);
  console.log('----------------------------------------------------------------\n');

  const report = {
    nfr_id: '4.1.2',
    concurrent_vus: CONCURRENT_VUS,
    total_operations: totalOps,
    successful_operations: successfulOps,
    failed_operations: failedOps,
    error_rate_pct: Number(errorRatePct.toFixed(2)),
    wall_clock_seconds: Number((wallClockDurationMs / 1000.0).toFixed(2)),
    throughput_rps: Number(throughputRps.toFixed(1)),
    latency_ms: {
      mean: Number(meanLatency.toFixed(2)),
      std: Number(stdLatency.toFixed(2)),
      p50: Number(p50.toFixed(2)),
      p90: Number(p90.toFixed(2)),
      p95: Number(p95.toFixed(2)),
      p99: Number(p99.toFixed(2)),
      min: Number(latencies[0].toFixed(2)),
      max: Number(latencies[latencies.length - 1].toFixed(2)),
    },
    passed,
    timestamp: new Date().toISOString(),
  };

  const outPath = path.join(process.cwd(), 'reports', 'benchmark_100_vus_crud.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Saved benchmark report to ${outPath}`);

  // Also write the standalone k6 test script
  const k6ScriptPath = path.join(process.cwd(), 'scripts', 'k6_crud_script.js');
  const k6ScriptContent = `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 100,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.API_BASE || 'http://localhost:4000';

export default function () {
  const userId = 'k6_user_' + __VU;
  
  // Create
  const createPayload = JSON.stringify({
    userId,
    accountHandle: 'cristiano',
    caption: 'k6 test post',
    hashtags: ['k6', 'loadtest'],
    mediaType: 'image',
    platform: 'instagram',
    scheduledTime: new Date(Date.now() + 3600000).toISOString(),
    status: 'SCHEDULED',
  });
  
  const createRes = http.post(\`\${BASE_URL}/api/calendar/posts\`, createPayload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(createRes, { 'create post status 201': (r) => r.status === 201 });
  
  // Read
  const listRes = http.get(\`\${BASE_URL}/api/calendar/posts?userId=\${userId}\`);
  check(listRes, { 'list posts status 200': (r) => r.status === 200 });

  sleep(0.1);
}
`;
  fs.writeFileSync(k6ScriptPath, k6ScriptContent);
  console.log(`Saved k6 test script to ${k6ScriptPath}`);

  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('NFR 4.1.2 test failed:', err);
  process.exit(1);
});
