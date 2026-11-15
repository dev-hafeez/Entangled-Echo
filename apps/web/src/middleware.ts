import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { verifyAdminSessionToken } from './lib/admin-auth';

const isAdminRoute = createRouteMatcher([
  '/admin/accounts(.*)',
  '/api/admin(.*)',
]);

// Public routes accessible without signing in
const isPublicRoute = createRouteMatcher([
  '/',
  '/admin',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/login(.*)',
  '/signup(.*)',
  '/admin/login',
  '/api/auth(.*)',
  '/api/proxy(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  const sessionToken = req.cookies.get('admin_session')?.value;
  const adminSecret = process.env.ADMIN_SECRET_KEY || process.env.ADMIN_PASSWORD;

  let isAdmin = false;
  if (sessionToken && adminSecret) {
    const v = await verifyAdminSessionToken(sessionToken, adminSecret);
    if (v.valid) {
      isAdmin = true;
    }
  }

  // Enforce FR-06: Restrict administrative actions; return 403 Forbidden for non-admin session
  if (isAdminRoute(req)) {
    const authHeader = req.headers.get('authorization') || req.headers.get('x-admin-password');

    // Check 2: Direct secret header (only if non-empty secret is configured)
    if (!isAdmin && adminSecret && adminSecret.length > 0) {
      if (
        authHeader === adminSecret ||
        authHeader === `Bearer ${adminSecret}`
      ) {
        isAdmin = true;
      }
    }

    // Check 3: Verified Clerk session with admin role
    if (!isAdmin) {
      const session = await auth();
      const claims = session.sessionClaims as any;
      const role =
        claims?.role ||
        claims?.public_metadata?.role ||
        claims?.metadata?.role ||
        claims?.org_role;

      if (role === 'admin') {
        isAdmin = true;
      }
    }

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

  if (!isPublicRoute(req) && !isAdmin) {
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
