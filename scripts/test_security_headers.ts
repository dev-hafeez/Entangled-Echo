import fs from 'fs';
import path from 'path';

async function run() {
  console.log('================================================================');
  console.log('   Security: Next.js Production Security Headers Test           ');
  console.log('================================================================\n');

  // 1. Verify next.config.mjs exists and contains expected security headers
  const configPath = path.join(process.cwd(), 'apps', 'web', 'next.config.mjs');
  if (!fs.existsSync(configPath)) {
    throw new Error(`next.config.mjs missing at ${configPath}`);
  }

  const configModule = await import(configPath);
  const nextConfig = configModule.default;

  if (typeof nextConfig.headers !== 'function') {
    throw new Error('next.config.mjs does not export an async headers() function');
  }

  const headerRules = await nextConfig.headers();
  const globalRule = headerRules.find((r: any) => r.source === '/:path*');

  if (!globalRule) {
    throw new Error('Global /:path* security header rule missing');
  }

  const headersMap = new Map<string, string>();
  for (const h of globalRule.headers) {
    headersMap.set(h.key.toLowerCase(), h.value);
  }

  const expectedHeaders = [
    { key: 'x-frame-options', expected: 'DENY', name: 'Clickjacking Protection (X-Frame-Options)' },
    { key: 'x-content-type-options', expected: 'nosniff', name: 'MIME-Sniffing Prevention (X-Content-Type-Options)' },
    { key: 'referrer-policy', expected: 'strict-origin-when-cross-origin', name: 'Referrer Information Leak Prevention' },
    { key: 'strict-transport-security', expected: 'max-age=63072000; includeSubDomains; preload', name: 'HSTS (Strict-Transport-Security)' },
    { key: 'permissions-policy', expected: 'camera=(), microphone=(), geolocation=(), browsing-topics=()', name: 'Browser Feature Isolation (Permissions-Policy)' },
  ];

  console.log('Verifying required production security headers...');
  for (const item of expectedHeaders) {
    const val = headersMap.get(item.key);
    console.log(`  Checking ${item.name}...`);
    console.log(`    Header: ${item.key}: "${val}"`);

    if (!val) {
      throw new Error(`Missing required security header: ${item.key}`);
    }
    if (val !== item.expected) {
      throw new Error(`Header mismatch for ${item.key}! Expected "${item.expected}", got "${val}"`);
    }
    console.log(`    [PASS] ${item.key} is correctly configured.\n`);
  }

  console.log('================================================================');
  console.log('   SECURITY HEADERS VERIFICATION: ALL 5 HEADERS STRICTLY PASS   ');
  console.log('================================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('Security headers test failed:', err);
  process.exit(1);
});
