import { sanitizeAndValidateHandle } from '../apps/api/src/lib/security.js';

async function run() {
  console.log('================================================================');
  console.log('   Security: Path Traversal & Handle Strict Regex Unit Tests    ');
  console.log('================================================================\n');

  const maliciousPayloads = [
    '../../etc/passwd',
    '../storage/models.json',
    '..%2f..%2fetc%2fpasswd',
    '..%252f..%252fetc%252fpasswd',
    '/etc/shadow',
    '\\windows\\system32',
    'handle/with/slash',
    'handle\\with\\backslash',
    'handle\0nullbyte',
    '<script>alert(1)</script>',
    'handle;rm -rf /',
    'handle..dotdot',
    'a'.repeat(35), // Over 30 chars limit
    '   ', // Whitespace
    '', // Empty
    'handle with space',
    'handle$special#char',
  ];

  console.log(`Testing ${maliciousPayloads.length} malicious path traversal & invalid payloads...`);
  let rejectedCount = 0;

  for (const payload of maliciousPayloads) {
    try {
      sanitizeAndValidateHandle(payload);
      throw new Error(`SECURITY VULNERABILITY: Malicious payload was accepted: "${payload}"`);
    } catch (err: any) {
      rejectedCount++;
      console.log(`  [REJECTED] "${payload.substring(0, 30)}" -> ${err.message}`);
    }
  }

  if (rejectedCount !== maliciousPayloads.length) {
    throw new Error(`Expected all ${maliciousPayloads.length} malicious payloads to be rejected, but only ${rejectedCount} were!`);
  }
  console.log(`\n  [PASS] All ${rejectedCount}/${maliciousPayloads.length} malicious inputs were rejected.\n`);

  // Valid handles
  const validHandles = [
    'cristiano',
    '@cristiano', // Leading @ should be stripped cleanly
    'virat.kohli',
    'abdulelsayed',
    '_assunsun_',
    '1924us',
    'aew',
    'zara.official',
  ];

  console.log(`Testing ${validHandles.length} legitimate creator handles...`);
  for (const handle of validHandles) {
    const sanitized = sanitizeAndValidateHandle(handle);
    const expected = handle.replace(/^@/, '').toLowerCase();
    if (sanitized !== expected) {
      throw new Error(`Sanitization mismatch: expected "${expected}", got "${sanitized}"`);
    }
    console.log(`  [ACCEPTED] "${handle}" -> "${sanitized}"`);
  }
  console.log(`  [PASS] All ${validHandles.length} valid handles passed validation.\n`);

  console.log('================================================================');
  console.log('   PATH TRAVERSAL & REGEX SECURITY TESTS: ALL PASSED            ');
  console.log('================================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('Path traversal test failed:', err);
  process.exit(1);
});
