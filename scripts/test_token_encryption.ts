import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  encryptToken,
  decryptToken,
  storeEncryptedToken,
  getDecryptedToken,
  getEncryptionKey,
} from '../apps/api/src/lib/crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function run() {
  console.log('================================================================');
  console.log('   FR-08: Token Security & AES-256-GCM Encryption at Rest Test   ');
  console.log('================================================================\n');

  const testToken = 'EAABwbz..._long_lived_meta_graph_api_access_token_xyz987654321';
  const customKey = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');

  // Test 1: Basic roundtrip encrypt / decrypt
  console.log('Test 1: Roundtrip encryption and decryption (AES-256-GCM)...');
  const enc1 = encryptToken(testToken, customKey);
  console.log('  Ciphertext length:', enc1.ciphertext.length / 2, 'bytes');
  console.log('  IV (hex):', enc1.iv);
  console.log('  Auth Tag (hex):', enc1.authTag);
  console.log('  Serialized format:', enc1.serialized.substring(0, 40) + '...');

  const dec1 = decryptToken(enc1.serialized, customKey);
  if (dec1 !== testToken) {
    throw new Error(`Roundtrip failed! Expected "${testToken}", got "${dec1}"`);
  }
  console.log('  [PASS] Decrypted matches original token exactly.\n');

  // Test 2: Ciphertext non-determinism (distinct IV per call)
  console.log('Test 2: Ciphertext non-determinism (distinct IVs per call)...');
  const enc2 = encryptToken(testToken, customKey);
  if (enc1.iv === enc2.iv) {
    throw new Error('Collision in random IV generation!');
  }
  if (enc1.ciphertext === enc2.ciphertext) {
    throw new Error('Identical ciphertext produced for identical plaintext! IV reuse vulnerability detected.');
  }
  console.log('  Call 1 IV:', enc1.iv);
  console.log('  Call 2 IV:', enc2.iv);
  console.log('  [PASS] Ciphertexts differ per call due to random 96-bit IV.\n');

  // Test 3: Authenticated integrity check (tampering detection)
  console.log('Test 3: Authentication and tampering detection...');
  let tamperDetected = false;
  try {
    // Flip a bit in the ciphertext
    const tamperedParts = enc1.serialized.split(':');
    const corruptedCiphertext =
      (tamperedParts[3][0] === 'a' ? 'b' : 'a') + tamperedParts[3].substring(1);
    const tamperedSerialized = `${tamperedParts[0]}:${tamperedParts[1]}:${tamperedParts[2]}:${corruptedCiphertext}`;
    decryptToken(tamperedSerialized, customKey);
  } catch (err: any) {
    tamperDetected = true;
    console.log('  Correctly caught authentication failure on tampered ciphertext:', err.message);
  }

  if (!tamperDetected) {
    throw new Error('Security failure: Tampered ciphertext was decrypted without error!');
  }
  console.log('  [PASS] GCM authentication tag correctly rejected tampered ciphertext.\n');

  // Test 4: Wrong key failure
  console.log('Test 4: Decryption with wrong key...');
  const wrongKey = Buffer.from('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');
  let wrongKeyFailed = false;
  try {
    decryptToken(enc1.serialized, wrongKey);
  } catch (err: any) {
    wrongKeyFailed = true;
    console.log('  Correctly caught authentication failure on wrong key:', err.message);
  }
  if (!wrongKeyFailed) {
    throw new Error('Security failure: Decrypted with wrong key!');
  }
  console.log('  [PASS] Wrong encryption key rejected.\n');

  // Test 5: Storage at rest
  console.log('Test 5: Storage at rest in storage/tokens/{handle}.enc.json...');
  const testHandle = 'test_creator_secure_handle';
  storeEncryptedToken(testHandle, testToken, customKey);

  const storedPath = path.join(projectRoot, 'storage', 'tokens', `${testHandle}.enc.json`);
  if (!fs.existsSync(storedPath)) {
    throw new Error(`Encrypted token file not found at ${storedPath}`);
  }

  const storedContent = JSON.parse(fs.readFileSync(storedPath, 'utf-8'));
  console.log('  File exists at:', storedPath);
  console.log('  Plaintext token in file?', JSON.stringify(storedContent).includes(testToken) ? 'FAIL (LEAK)' : 'NO (SECURE)');
  if (JSON.stringify(storedContent).includes(testToken)) {
    throw new Error('Plaintext token leaked into storage file!');
  }

  const retrievedToken = getDecryptedToken(testHandle, customKey);
  if (retrievedToken !== testToken) {
    throw new Error(`Retrieved token does not match: ${retrievedToken}`);
  }
  console.log('  [PASS] Stored at rest as encrypted JSON; retrieved and decrypted successfully.\n');

  // Clean up test file
  fs.unlinkSync(storedPath);

  console.log('================================================================');
  console.log('   FR-08 VERIFICATION COMPLETE: ALL 5 CRYPTO TESTS PASSED       ');
  console.log('================================================================');
}

run().catch((err) => {
  console.error('FR-08 test failed:', err);
  process.exit(1);
});
