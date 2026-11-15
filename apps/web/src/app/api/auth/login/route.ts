import { NextRequest, NextResponse } from 'next/server';
import { signAdminSessionToken } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  const expectedSecret = process.env.ADMIN_SECRET_KEY || process.env.ADMIN_PASSWORD;

  // Fail closed if admin credentials are not explicitly configured
  if (!expectedSecret || expectedSecret.trim().length === 0) {
    return NextResponse.json(
      { error: 'Admin access disabled: ADMIN_SECRET_KEY is not configured in environment' },
      { status: 503 }
    );
  }

  if (typeof password === 'string' && password === expectedSecret) {
    const token = await signAdminSessionToken(expectedSecret);

    // FIX 1: Return only { success: true }. Never leak the signed token to client JavaScript.
    const res = NextResponse.json({ success: true });

    // Set cryptographically signed HttpOnly session cookie
    res.cookies.set('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });

    // Delete legacy unhashed bypass cookie if present
    res.cookies.delete('admin_auth');

    return res;
  }

  return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
}
