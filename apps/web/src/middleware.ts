import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// Protected admin subroutes requiring active administrator session
const isAdminSubRoute = createRouteMatcher([
  '/admin/(.+)',
]);

// Public routes accessible without signing in
const isPublicRoute = createRouteMatcher([
  '/',
  '/admin',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/login(.*)',
  '/signup(.*)',
  '/api/auth(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  const adminCookie = req.cookies.get('admin_auth')?.value;
  const authHeader = req.headers.get('authorization') || req.headers.get('x-admin-password');
  const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const isAdmin =
    adminCookie === 'true' ||
    authHeader === expectedPassword ||
    authHeader === `Bearer ${expectedPassword}`;

  const { pathname } = req.nextUrl;
  const isJsonRequest =
    req.headers.get('accept')?.includes('application/json') ||
    req.headers.get('content-type')?.includes('application/json');

  // Enforce FR-06: Restrict administrative API actions; return 403 Forbidden for non-admin session
  if (pathname.startsWith('/api/admin')) {
    if (!isAdmin) {
      return new NextResponse(
        JSON.stringify({
          error: 'Forbidden: Administrator privileges required (FR-06)',
          status: 403,
        }),
        {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }
      );
    }
  }

  // If accessing admin subroutes (e.g. /admin/accounts/...) without admin privileges:
  if (isAdminSubRoute(req) && !isAdmin) {
    if (isJsonRequest) {
      return new NextResponse(
        JSON.stringify({
          error: 'Forbidden: Administrator privileges required (FR-06)',
          status: 403,
        }),
        {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }
      );
    }
    return NextResponse.redirect(new URL('/admin', req.url));
  }

  // Programmatic API requests to /admin without credentials receive 403
  if (pathname === '/admin' && !isAdmin && isJsonRequest) {
    return new NextResponse(
      JSON.stringify({
        error: 'Forbidden: Administrator privileges required (FR-06)',
        status: 403,
      }),
      {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }
    );
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
