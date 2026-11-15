/**
 * Admin Authentication Utilities using Web Crypto API.
 * Compatible with Edge runtime (Next.js middleware) and Node.js runtime (Route Handlers).
 */

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function signAdminSessionToken(secret: string, expiresInSeconds: number = 86400): Promise<string> {
  if (!secret) throw new Error('Cannot sign admin session token: secret key is missing');

  const enc = new TextEncoder();
  const payload = {
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  const sigB64 = base64UrlEncode(sigBuf);

  return `${payloadB64}.${sigB64}`;
}

export async function verifyAdminSessionToken(
  token: string,
  secret: string
): Promise<{ valid: boolean; payload?: any; reason?: string }> {
  if (!token || !secret) {
    return { valid: false, reason: 'missing-token-or-secret' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'malformed-token' };
  }

  const [payloadB64, sigB64] = parts;
  const enc = new TextEncoder();

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = base64UrlDecode(sigB64);
    const validSig = await crypto.subtle.verify('HMAC', key, sigBytes as unknown as BufferSource, enc.encode(payloadB64));

    if (!validSig) {
      return { valid: false, reason: 'invalid-signature' };
    }

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson);

    if (payload.role !== 'admin') {
      return { valid: false, reason: 'invalid-role' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, reason: 'token-expired' };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, reason: 'verification-error' };
  }
}
