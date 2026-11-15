import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSessionToken } from '../../../../lib/admin-auth';

function getTargetApiUrl(): string {
  return process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
}

// -----------------------------------------------------------------------------
// Explicit Path Allowlists (Default Deny)
// -----------------------------------------------------------------------------

// Paths strictly forbidden through the public web proxy under ALL conditions
const FORBIDDEN_PATHS = [
  /^internal(\/.*)?$/,
  /^api\/calendar\/tick(\/.*)?$/,
  /.*\/tick$/,
];

// Admin-only paths: requires cryptographically verified admin_session cookie
const ADMIN_PATHS = [
  /^api\/admin(\/.*)?$/,
  /^api\/jobs(\/.*)?$/,
  /^api\/models(\/.*)?$/,
  /^api\/session(\/.*)?$/,
  /^api\/scrape(\/.*)?$/,
];

// Public / User paths accessible through the proxy
const ALLOWED_USER_PATHS = [
  /^api\/accounts(\/.*)?$/,
  /^api\/onboarding(\/.*)?$/,
  /^api\/recommendations(\/.*)?$/,
  /^api\/calendar\/posts(\/.*)?$/,
  /^api\/calendar\/slots\/recommended$/,
  /^api\/notifications(\/.*)?$/,
  /^api\/graph\/connect$/,
  /^api\/media\/signed-url$/,
  /^health$/,
];

function isForbiddenPath(path: string): boolean {
  return FORBIDDEN_PATHS.some((regex) => regex.test(path));
}

function isAdminPath(path: string): boolean {
  return ADMIN_PATHS.some((regex) => regex.test(path));
}

function isAllowedUserPath(path: string): boolean {
  return ALLOWED_USER_PATHS.some((regex) => regex.test(path));
}

async function proxyRequest(req: NextRequest, { params }: { params: { path: string[] } }) {
  const pathSegments = params.path || [];
  const normalizedPath = pathSegments.join('/').replace(/^\/+/, '');
  const search = req.nextUrl.search || '';

  // 1. Strict default-deny: reject forbidden tick and internal paths
  if (isForbiddenPath(normalizedPath)) {
    return NextResponse.json(
      { error: 'Forbidden: Endpoint cannot be accessed through public proxy', status: 403 },
      { status: 403 }
    );
  }

  // 2. Check admin session cookie on the server
  const adminSessionCookie = req.cookies.get('admin_session')?.value;
  const adminSecret = process.env.ADMIN_SECRET_KEY || process.env.ADMIN_PASSWORD || '';
  let isAdmin = false;

  if (adminSessionCookie && adminSecret.length > 0) {
    const verification = await verifyAdminSessionToken(adminSessionCookie, adminSecret);
    isAdmin = verification.valid;
  }

  // 3. Admin-only path enforcement: non-admin sessions cannot reach admin endpoints
  if (isAdminPath(normalizedPath)) {
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Administrator privileges required for this path', status: 403 },
        { status: 403 }
      );
    }
  } else if (!isAllowedUserPath(normalizedPath)) {
    // 4. Default deny for any unknown / unlisted path
    return NextResponse.json(
      { error: 'Forbidden: Path not in proxy allowlist', status: 403 },
      { status: 403 }
    );
  }

  // 5. Construct sanitized upstream headers
  // STRIP: Authorization, x-admin-password, x-forwarded-*, cookie, x-tick-secret
  const forwardHeaders: Record<string, string> = {};

  const contentType = req.headers.get('content-type');
  if (contentType) forwardHeaders['content-type'] = contentType;

  const accept = req.headers.get('accept');
  if (accept) forwardHeaders['accept'] = accept;

  // Set ONLY the verified admin_session cookie from server-side cookie store
  if (isAdmin && adminSessionCookie) {
    forwardHeaders['cookie'] = `admin_session=${adminSessionCookie}`;
  }

  const targetUrl = `${getTargetApiUrl()}/${normalizedPath}${search}`;
  const method = req.method.toUpperCase();
  let body: ArrayBuffer | undefined = undefined;
  if (!['GET', 'HEAD'].includes(method)) {
    try {
      body = await req.arrayBuffer();
    } catch {}
  }

  try {
    const backendRes = await fetch(targetUrl, {
      method,
      headers: forwardHeaders,
      body,
    });

    const responseBody = await backendRes.arrayBuffer();
    const resHeaders = new Headers();

    const backendContentType = backendRes.headers.get('content-type');
    if (backendContentType) resHeaders.set('content-type', backendContentType);

    return new NextResponse(responseBody, {
      status: backendRes.status,
      statusText: backendRes.statusText,
      headers: resHeaders,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Proxy to backend failed: ${err.message}` },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
