import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const adminCookie = req.cookies.get('admin_auth')?.value;
  const authHeader = req.headers.get('authorization') || req.headers.get('x-admin-password');
  const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const isAuth =
    adminCookie === 'true' ||
    authHeader === expectedPassword ||
    authHeader === `Bearer ${expectedPassword}`;

  return NextResponse.json({ authenticated: isAuth });
}

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  const expected = process.env.ADMIN_PASSWORD || 'admin123';

  if (password === expected) {
    const res = NextResponse.json({ success: true, authenticated: true });
    res.cookies.set('admin_auth', 'true', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return res;
  }

  return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
}
