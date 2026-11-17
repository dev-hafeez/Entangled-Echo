import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const auth = req.cookies.get('admin_auth')?.value;
  return NextResponse.json({ authenticated: auth === 'true' });
}

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  const expected = process.env.ADMIN_PASSWORD || 'admin123';

  if (password === expected) {
    const res = NextResponse.json({ success: true });
    res.cookies.set('admin_auth', 'true', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return res;
  }

  return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
}
