import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isAdminApiRoute = createRouteMatcher([
  '/api/admin(.*)',
]);

// Public routes accessible without signing in
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/login(.*)',
  '/signup(.*)',
  '/admin(.*)',
  '/api(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // Enforce FR-06: Restrict administrative actions; return 403 Forbidden for non-admin session
  if (isAdminApiRoute(req)) {
    const adminCookie = req.cookies.get('admin_auth')?.value;
    const authHeader = req.headers.get('authorization') || req.headers.get('x-admin-password');
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';

    const isAdmin =
      adminCookie === 'true' ||
      authHeader === expectedPassword ||
      authHeader === `Bearer ${expectedPassword}`;

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
