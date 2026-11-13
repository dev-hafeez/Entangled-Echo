import sharp from 'sharp';
import { validateImageBuffer, sanitizeAndReencodeImage } from '../apps/api/src/lib/security.js';

async function run() {
  console.log('================================================================');
  console.log('   Security: Upload Validation (Magic Bytes, Size, Sharp) Test  ');
  console.log('================================================================\n');

  // Test 1: Oversize File (> 8 MB)
  console.log('Test 1: Rejecting oversize file (> 8 MB)...');
  const oversizeBuf = Buffer.alloc(9 * 1024 * 1024); // 9 MB
  const oversizeRes = validateImageBuffer(oversizeBuf);
  console.log(`  Valid: ${oversizeRes.valid} | Error: "${oversizeRes.error}"`);
  if (oversizeRes.valid || !oversizeRes.error?.includes('exceeds max allowed size')) {
    throw new Error('Security failure: Oversize buffer was not rejected!');
  }
  console.log('  [PASS] Oversize upload rejected.\n');

  // Test 2: Fake extension / Invalid magic bytes (plain text file renamed as .jpg)
  console.log('Test 2: Rejecting invalid magic bytes (fake image)...');
  const fakeImageBuf = Buffer.from('This is a malicious shell script pretending to be image.jpg\n#!/bin/bash\nrm -rf /', 'utf-8');
  const fakeRes = validateImageBuffer(fakeImageBuf);
  console.log(`  Valid: ${fakeRes.valid} | Error: "${fakeRes.error}"`);
  if (fakeRes.valid || !fakeRes.error?.includes('magic bytes do not match')) {
    throw new Error('Security failure: Fake image with invalid magic bytes was accepted!');
  }
  console.log('  [PASS] Invalid file signature rejected.\n');

  // Test 3: Polyglot image (valid JPEG header + embedded PHP / script payload)
  console.log('Test 3: Rejecting polyglot executable script payload embedded in image...');
  // Construct JPEG SOI (FF D8 FF E0) followed by embedded PHP script
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const polyglotPayload = Buffer.from("<?php system($_GET['cmd']); ?> <script>alert('xss')</script>", 'utf-8');
  const polyglotBuf = Buffer.concat([jpegHeader, polyglotPayload]);

  const polyglotRes = validateImageBuffer(polyglotBuf);
  console.log(`  Valid: ${polyglotRes.valid} | Error: "${polyglotRes.error}"`);
  if (polyglotRes.valid || !polyglotRes.error?.includes('embedded script')) {
    throw new Error('Security failure: Polyglot file was accepted!');
  }
  console.log('  [PASS] Polyglot script injection detected and rejected.\n');

  // Test 4: Valid PNG image converted and re-encoded cleanly via Sharp (SRDS D9)
  console.log('Test 4: Sanitizing and re-encoding valid image via Sharp...');
  // Generate a 100x100 clean PNG in-memory using Sharp
  const validPng = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r: 55, g: 62, b: 62, alpha: 1 },
    },
  }).png().toBuffer();

  const validRes = validateImageBuffer(validPng);
  console.log(`  Initial validation: valid=${validRes.valid}, format=${validRes.format}`);
  if (!validRes.valid) {
    throw new Error(`Valid PNG failed initial check: ${validRes.error}`);
  }

  const sanitizedJpeg = await sanitizeAndReencodeImage(validPng);
  console.log(`  Original PNG size : ${validPng.length} bytes`);
  console.log(`  Sanitized JPEG size: ${sanitizedJpeg.length} bytes`);

  // Verify sanitized output is valid JPEG
  const sanitizedCheck = validateImageBuffer(sanitizedJpeg);
  console.log(`  Sanitized check: valid=${sanitizedCheck.valid}, format=${sanitizedCheck.format}`);
  if (!sanitizedCheck.valid || sanitizedCheck.format !== 'jpeg') {
    throw new Error(`Sanitized buffer is not valid JPEG: ${sanitizedCheck.error}`);
  }
  console.log('  [PASS] Image safely validated, stripped of metadata, and re-encoded via Sharp.\n');

  console.log('================================================================');
  console.log('   UPLOAD SECURITY TESTS: ALL 4 VERIFICATION STEPS PASSED       ');
  console.log('================================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('Upload security test failed:', err);
  process.exit(1);
});
