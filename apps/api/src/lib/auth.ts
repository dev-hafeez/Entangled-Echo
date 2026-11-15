import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@clerk/backend';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface ClerkAuthContext {
  userId: string;
  sessionId?: string;
  claims: Record<string, any>;
  isAdmin?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      auth?: ClerkAuthContext;
    }
  }
}

/**
 * Constant-time string equality check to protect against timing attacks.
 * Hashes inputs with SHA-256 before timingSafeEqual to avoid length leakage.
 */
export function safeTimingEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Parse HTTP Cookie header into key-value pairs without external dependencies.
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return list;

  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    if (key) {
      try {
        list[key] = decodeURIComponent(val);
      } catch {
        list[key] = val;
      }
    }
  }
  return list;
}

/**
 * Creates an HMAC-SHA256 signed admin session token.
 * Contains role, issuance, and expiration timestamps.
 */
export function signAdminSessionToken(secret: string, expiresInSeconds: number = 86400): string {
  if (!secret) {
    throw new Error('Cannot sign admin session token: secret key is missing');
  }
  const payload = {
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${hmac}`;
}

/**
 * Cryptographically verifies an HMAC-SHA256 signed admin session token.
 * Validates HMAC signature, expiration time, and role claim.
 */
export function verifyAdminSessionToken(
  token: string,
  secret: string
): { valid: boolean; payload?: any; reason?: string } {
  if (!token || !secret) {
    return { valid: false, reason: 'missing-token-or-secret' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'malformed-token' };
  }

  const [payloadB64, signature] = parts;
  const expectedHmac = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedHmac);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'invalid-signature' };
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (payload.role !== 'admin') {
      return { valid: false, reason: 'invalid-role' };
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, reason: 'token-expired' };
    }
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, reason: 'invalid-payload-json' };
  }
}

/**
 * Verifies whether the incoming request is authenticated as an administrator.
 * Supports:
 * 1. Constant-time comparison of ADMIN_PASSWORD / ADMIN_SECRET_KEY in headers.
 * 2. Cryptographically signed `admin_session` cookie or bearer token.
 * 3. Verified Clerk JWT with an administrative role claim.
 * Fails closed if no admin credential is provided or if admin secrets are unconfigured.
 */
export async function verifyAdminContext(
  req: Request
): Promise<{ isAdmin: boolean; userId: string; claims?: Record<string, any> }> {
  const adminSecret = config.adminPassword;
  const sessionSecret = adminSecret || config.tokenEncKey;

  const authHeader = req.headers['authorization'];
  const xAdminPass = req.headers['x-admin-password'];
  const cookies = parseCookies(req.headers['cookie']);
  const sessionCookie = cookies['admin_session'];

  // Check 1: Direct administrative secret header (requires configured non-empty secret)
  if (adminSecret && adminSecret.length > 0) {
    if (typeof xAdminPass === 'string' && safeTimingEqual(xAdminPass, adminSecret)) {
      return { isAdmin: true, userId: 'admin', claims: { role: 'admin' } };
    }
    if (typeof authHeader === 'string') {
      if (safeTimingEqual(authHeader, adminSecret)) {
        return { isAdmin: true, userId: 'admin', claims: { role: 'admin' } };
      }
      if (authHeader.startsWith('Bearer ') && safeTimingEqual(authHeader.slice(7).trim(), adminSecret)) {
        return { isAdmin: true, userId: 'admin', claims: { role: 'admin' } };
      }
    }
  }

  // Check 2: Cryptographically signed admin session token in cookie
  if (sessionCookie && sessionSecret) {
    const verification = verifyAdminSessionToken(sessionCookie, sessionSecret);
    if (verification.valid) {
      return { isAdmin: true, userId: 'admin', claims: verification.payload };
    }
  }

  // Check 3: Cryptographically signed admin session token in Bearer header
  if (authHeader && authHeader.startsWith('Bearer ') && sessionSecret) {
    const token = authHeader.slice(7).trim();
    const verification = verifyAdminSessionToken(token, sessionSecret);
    if (verification.valid) {
      return { isAdmin: true, userId: 'admin', claims: verification.payload };
    }
  }

  // Check 4: Clerk JWT carrying an administrative role claim
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const clerkAuth = await authenticateClerkToken(req);
    if (clerkAuth.success) {
      const claims = clerkAuth.auth.claims;
      const role =
        claims.role ||
        claims.public_metadata?.role ||
        claims.metadata?.role ||
        claims.org_role;

      if (role === 'admin') {
        return {
          isAdmin: true,
          userId: clerkAuth.auth.userId,
          claims,
        };
      }
    }
  }

  // Fail closed
  return { isAdmin: false, userId: '' };
}

/**
 * Synchronous legacy check retained for compatibility, but backed by constant-time
 * and HMAC verification without any fallback default passwords or unsigned bypass cookies.
 */
export function isAdminRequest(req: Request): boolean {
  const adminSecret = config.adminPassword;
  const sessionSecret = adminSecret || config.tokenEncKey;

  if (adminSecret && adminSecret.length > 0) {
    const xAdminPass = req.headers['x-admin-password'];
    if (typeof xAdminPass === 'string' && safeTimingEqual(xAdminPass, adminSecret)) {
      return true;
    }
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string') {
      if (safeTimingEqual(authHeader, adminSecret)) return true;
      if (authHeader.startsWith('Bearer ') && safeTimingEqual(authHeader.slice(7).trim(), adminSecret)) {
        return true;
      }
    }
  }

  const cookies = parseCookies(req.headers['cookie']);
  const sessionCookie = cookies['admin_session'];
  if (sessionCookie && sessionSecret) {
    const v = verifyAdminSessionToken(sessionCookie, sessionSecret);
    if (v.valid) return true;
  }

  return false;
}

/**
 * Extracts and verifies the Clerk JWT bearer token from the Authorization header.
 * Cryptographically validates signature, expiration, and authorized parties (azp).
 * Never logs raw tokens or secret keys.
 */
export async function authenticateClerkToken(
  req: Request
): Promise<{ success: true; auth: ClerkAuthContext } | { success: false; status: number; error: string }> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || typeof authHeader !== 'string') {
    return {
      success: false,
      status: 401,
      error: 'Unauthorized: Missing Authorization header',
    };
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return {
      success: false,
      status: 401,
      error: 'Unauthorized: Malformed Authorization header. Expected "Bearer <token>"',
    };
  }

  const token = parts[1];
  if (!token) {
    return {
      success: false,
      status: 401,
      error: 'Unauthorized: Empty bearer token provided',
    };
  }

  // Key strategy:
  // 1. If CLERK_JWT_KEY is provided, use static RSA public key (offline/hermetic/testing).
  // 2. If CLERK_SECRET_KEY is provided, use Clerk network JWKS verification.
  // 3. If neither is provided, fail closed.
  const secretKey = config.clerkSecretKey;
  const jwtKey = config.clerkJwtKey;

  if (!secretKey && !jwtKey) {
    return {
      success: false,
      status: 500,
      error: 'Internal Server Error: Authentication service not properly configured (neither CLERK_JWT_KEY nor CLERK_SECRET_KEY is set)',
    };
  }

  try {
    const verifyOptions: any = {};
    if (jwtKey) {
      verifyOptions.jwtKey = jwtKey;
    } else {
      verifyOptions.secretKey = secretKey;
    }

    if (config.clerkAuthorizedParties && config.clerkAuthorizedParties.length > 0) {
      verifyOptions.authorizedParties = config.clerkAuthorizedParties;
    }

    const payload = await verifyToken(token, verifyOptions);

    if (!payload || !payload.sub) {
      return {
        success: false,
        status: 401,
        error: 'Unauthorized: Token payload missing valid subject identifier (userId)',
      };
    }

    return {
      success: true,
      auth: {
        userId: payload.sub,
        sessionId: payload.sid as string | undefined,
        claims: payload,
      },
    };
  } catch (err: any) {
    const reason = err?.reason || '';
    const message = err?.message || '';

    if (
      reason === 'token-invalid-authorized-parties' ||
      message.includes('authorized party') ||
      message.includes('azp')
    ) {
      return {
        success: false,
        status: 401,
        error: 'Unauthorized: Token authorized party (azp) is not allowed',
      };
    }

    if (reason === 'token-expired' || message.includes('expired')) {
      return {
        success: false,
        status: 401,
        error: 'Unauthorized: Token has expired',
      };
    }

    if (
      reason === 'token-invalid' ||
      message.includes('Invalid JWT') ||
      message.includes('signature')
    ) {
      return {
        success: false,
        status: 401,
        error: 'Unauthorized: Invalid token signature or format',
      };
    }

    return {
      success: false,
      status: 401,
      error: 'Unauthorized: Token verification failed',
    };
  }
}

/**
 * Strict authentication middleware for user-scoped resources.
 * Requires a cryptographically verified Clerk JWT.
 * Overwrites untrusted client-supplied userId with verified JWT userId.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const result = await authenticateClerkToken(req);

  if (!result.success) {
    res.status(result.status).json({
      error: result.error,
      status: result.status,
    });
    return;
  }

  req.auth = result.auth;

  // Sanitize: Overwrite any client-supplied userId so downstream handlers
  // can never accidentally trust untrusted input from body or query.
  if (req.body && typeof req.body === 'object') {
    req.body.userId = result.auth.userId;
  }
  if (req.query && typeof req.query === 'object') {
    (req.query as any).userId = result.auth.userId;
  }

  next();
}

/**
 * Authentication middleware allowing either a verified Clerk user or an Administrator.
 */
export async function requireUserOrAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Check admin first
  const adminCtx = await verifyAdminContext(req);
  if (adminCtx.isAdmin) {
    req.auth = {
      userId: adminCtx.userId || 'admin',
      isAdmin: true,
      claims: adminCtx.claims || { role: 'admin' },
    };
    return next();
  }

  // Otherwise require valid Clerk token
  const result = await authenticateClerkToken(req);
  if (!result.success) {
    res.status(result.status).json({
      error: result.error,
      status: result.status,
    });
    return;
  }

  req.auth = result.auth;

  if (req.body && typeof req.body === 'object') {
    req.body.userId = result.auth.userId;
  }
  if (req.query && typeof req.query === 'object') {
    (req.query as any).userId = result.auth.userId;
  }

  next();
}

/**
 * Strict administrator authentication middleware (FR-06).
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const adminCtx = await verifyAdminContext(req);
  if (!adminCtx.isAdmin) {
    res.status(403).json({
      error: 'Forbidden: Administrator privileges required (FR-06)',
      status: 403,
    });
    return;
  }

  req.auth = {
    userId: adminCtx.userId || 'admin',
    isAdmin: true,
    claims: adminCtx.claims || { role: 'admin' },
  };

  next();
}

/**
 * Optional authentication middleware.
 * If Authorization header is present, validates it.
 * If absent, proceeds without req.auth.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return next();
  }

  const adminCtx = await verifyAdminContext(req);
  if (adminCtx.isAdmin) {
    req.auth = {
      userId: adminCtx.userId || 'admin',
      isAdmin: true,
      claims: adminCtx.claims || { role: 'admin' },
    };
    return next();
  }

  const result = await authenticateClerkToken(req);
  if (!result.success) {
    res.status(result.status).json({
      error: result.error,
      status: result.status,
    });
    return;
  }

  req.auth = result.auth;

  if (req.body && typeof req.body === 'object') {
    req.body.userId = result.auth.userId;
  }
  if (req.query && typeof req.query === 'object') {
    (req.query as any).userId = result.auth.userId;
  }

  next();
}

export interface UserSessionRecord {
  userId: string;
  handle: string;
  isVerified?: boolean;
  verificationMethod?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

/**
 * Helper to retrieve the linked social account record for a given userId.
 * Checks storage/user_sessions/${userId}.json.
 */
export function getUserLinkedHandleRecord(userId: string): UserSessionRecord | null {
  try {
    const file = path.join(config.localStorageDir, 'user_sessions', `${userId}.json`);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (data && data.handle && typeof data.handle === 'string') {
        return {
          ...data,
          userId: data.userId || userId,
          handle: data.handle.toLowerCase().replace(/^@/, '').trim(),
          isVerified: Boolean(data.isVerified),
        };
      }
    }
  } catch {}
  return null;
}

/**
 * Helper to retrieve the linked social account handle for a given userId.
 */
export function getUserLinkedHandle(userId: string): string | null {
  const record = getUserLinkedHandleRecord(userId);
  return record ? record.handle : null;
}

/**
 * Searches storage/user_sessions for an existing binding to targetHandle.
 */
export function findUserByHandle(targetHandle: string): UserSessionRecord | null {
  const cleanTarget = targetHandle.toLowerCase().replace(/^@/, '').trim();
  const dir = path.join(config.localStorageDir, 'user_sessions');
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const fullPath = path.join(dir, file);
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      if (data && data.handle && typeof data.handle === 'string') {
        const h = data.handle.toLowerCase().replace(/^@/, '').trim();
        if (h === cleanTarget) {
          const userId = data.userId || path.basename(file, '.json');
          return {
            ...data,
            userId,
            handle: h,
            isVerified: Boolean(data.isVerified),
          };
        }
      }
    } catch {}
  }
  return null;
}

/**
 * Checks storage/user_sessions/ and migrates any duplicate handle bindings
 * to the first-bound user (by createdAt/updatedAt).
 */
export function migrateDuplicateHandles(): { duplicatesMigrated: number; uniqueHandles: number } {
  const dir = path.join(config.localStorageDir, 'user_sessions');
  if (!fs.existsSync(dir)) {
    return { duplicatesMigrated: 0, uniqueHandles: 0 };
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const handleMap = new Map<string, { file: string; userId: string; timestamp: number }[]>();

  for (const f of files) {
    try {
      const fullPath = path.join(dir, f);
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      if (data && data.handle && typeof data.handle === 'string') {
        const clean = data.handle.toLowerCase().replace(/^@/, '').trim();
        const timestamp = data.createdAt ? new Date(data.createdAt).getTime() : (data.updatedAt ? new Date(data.updatedAt).getTime() : 0);
        const list = handleMap.get(clean) || [];
        list.push({ file: f, userId: data.userId || path.basename(f, '.json'), timestamp });
        handleMap.set(clean, list);
      }
    } catch {}
  }

  let duplicatesMigrated = 0;
  for (const [handle, records] of handleMap.entries()) {
    if (records.length > 1) {
      // Sort to find the first-bound user (earliest timestamp)
      records.sort((a, b) => a.timestamp - b.timestamp);
      const firstBound = records[0];
      // All subsequent records are duplicates that must be dissociated
      for (let i = 1; i < records.length; i++) {
        const dup = records[i];
        const dupPath = path.join(dir, dup.file);
        try {
          const dupData = JSON.parse(fs.readFileSync(dupPath, 'utf-8'));
          delete dupData.handle;
          dupData.isVerified = false;
          dupData.duplicateDissociatedAt = new Date().toISOString();
          dupData.duplicateOfHandle = handle;
          dupData.firstBoundUserId = firstBound.userId;
          fs.writeFileSync(dupPath, JSON.stringify(dupData, null, 2));
          duplicatesMigrated++;
        } catch {}
      }
    }
  }

  return { duplicatesMigrated, uniqueHandles: handleMap.size };
}

/**
 * Checks whether the request caller is authorized to act on behalf of the target handle.
 * Single source of truth:
 * 1. Administrator (`req.auth?.isAdmin === true`) is always authorized.
 * 2. Unverified handles ALWAYS return false.
 * 3. Verified handles are authorized only if caller's session record matches targetHandle.
 */
export function isUserAccountOwnerOrAdmin(req: Request, targetHandle: string): boolean {
  if (req.auth?.isAdmin) {
    return true;
  }
  if (!req.auth?.userId) {
    return false;
  }
  const cleanTarget = targetHandle.toLowerCase().replace(/^@/, '').trim();
  const record = getUserLinkedHandleRecord(req.auth.userId);
  if (!record || !record.isVerified) {
    return false;
  }
  return record.handle === cleanTarget;
}

/**
 * Cryptographically verifies INTERNAL_TICK_SECRET for scheduler ticks.
 * Fails closed if INTERNAL_TICK_SECRET is unset or empty.
 */
export function verifyTickSecret(req: Request): { authorized: boolean; status?: number; error?: string } {
  const tickSecret = process.env.INTERNAL_TICK_SECRET;
  if (!tickSecret || tickSecret.trim().length === 0) {
    return {
      authorized: false,
      status: 503,
      error: 'Service Unavailable: INTERNAL_TICK_SECRET is not configured',
    };
  }

  const authHeader = req.headers['authorization'];
  const tickHeader = req.headers['x-tick-secret'];

  let providedSecret = '';
  if (typeof tickHeader === 'string') {
    providedSecret = tickHeader;
  } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    providedSecret = authHeader.slice(7).trim();
  }

  if (!providedSecret || !safeTimingEqual(providedSecret, tickSecret)) {
    return {
      authorized: false,
      status: 401,
      error: 'Unauthorized: Invalid internal tick secret',
    };
  }

  return { authorized: true };
}
