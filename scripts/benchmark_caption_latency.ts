import fs from 'fs';
import path from 'path';
import http from 'http';
import { performance } from 'perf_hooks';
import app from '../apps/api/src/index.js';
import { config } from '../apps/api/src/config.js';

async function run() {
  console.log('================================================================');
  console.log('   NFR 4.1.4: Caption Generation Latency (Cold Cache, 20 Calls) ');
  console.log('================================================================\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const N_CALLS = 20;
  const testHandle = 'cristiano';
  const recsCacheFile = path.join(config.localStorageDir, 'recommendations', `${testHandle}.json`);
  const latencies: number[] = [];

  console.log(`Executing ${N_CALLS} cold-cache caption recommendation generations for @${testHandle}...`);
  console.log(`SRDS 4.1.4 Target: < 5.0 s (5,000 ms)\n`);

  try {
    for (let i = 1; i <= N_CALLS; i++) {
      // 1. Force cold cache by removing cached file before every request
      if (fs.existsSync(recsCacheFile)) {
        fs.unlinkSync(recsCacheFile);
      }

      const t0 = performance.now();
      const res = await fetch(`${baseUrl}/api/recommendations/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': config.adminPassword,
        },
        body: JSON.stringify({ handle: testHandle, platform: 'instagram' }),
      });
      const t1 = performance.now();
      const durationMs = t1 - t0;

      if (!res.ok) {
        throw new Error(`Call ${i} failed with HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.recommendations || data.recommendations.length < 1) {
        throw new Error(`Call ${i} returned invalid recommendation payload`);
      }

      latencies.push(durationMs);
      console.log(`  Call ${i.toString().padStart(2, '0')}/${N_CALLS}: ${durationMs.toFixed(2)} ms (Captions generated: ${data.recommendations.length})`);
    }

    // Statistics
    latencies.sort((a, b) => a - b);
    const sum = latencies.reduce((acc, v) => acc + v, 0);
    const mean = sum / latencies.length;
    const variance = latencies.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / latencies.length;
    const std = Math.sqrt(variance);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const min = latencies[0];
    const max = latencies[latencies.length - 1];

    const passed = mean < 5000 && p95 < 5000;

    console.log('\n----------------------------------------------------------------');
    console.log('Latency Statistics (Cold Cache across 20 calls):');
    console.log(`  Mean : ${mean.toFixed(2)} ms`);
    console.log(`  Std  : ${std.toFixed(2)} ms`);
    console.log(`  p50  : ${p50.toFixed(2)} ms`);
    console.log(`  p95  : ${p95.toFixed(2)} ms`);
    console.log(`  Min  : ${min.toFixed(2)} ms`);
    console.log(`  Max  : ${max.toFixed(2)} ms`);
    console.log(`  Status: ${passed ? 'PASS (< 5,000 ms)' : 'FAIL'}`);
    console.log('----------------------------------------------------------------\n');

    const resultPayload = {
      nfr_id: '4.1.4',
      target: '< 5000 ms',
      calls: N_CALLS,
      handle: testHandle,
      mean_ms: Number(mean.toFixed(2)),
      std_ms: Number(std.toFixed(2)),
      p50_ms: Number(p50.toFixed(2)),
      p95_ms: Number(p95.toFixed(2)),
      min_ms: Number(min.toFixed(2)),
      max_ms: Number(max.toFixed(2)),
      passed,
      individual_latencies_ms: latencies.map((v) => Number(v.toFixed(2))),
      timestamp: new Date().toISOString(),
    };

    const outPath = path.join(process.cwd(), 'reports', 'benchmark_caption_latency.json');
    fs.writeFileSync(outPath, JSON.stringify(resultPayload, null, 2));
    console.log(`Saved benchmark results to ${outPath}`);

    process.exit(0);
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('Caption latency benchmark failed:', err);
  process.exit(1);
});
