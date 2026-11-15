import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSessionToken } from '@/lib/admin-auth';

export async function GET(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET_KEY || process.env.ADMIN_PASSWORD;
  if (!secret) {
    return NextResponse.json({ authenticated: false, reason: 'unconfigured' });
  }

  const token =
    req.cookies.get('admin_session')?.value ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!token) {
    return NextResponse.json({ authenticated: false });
  }

  const result = await verifyAdminSessionToken(token, secret);
  return NextResponse.json({
    authenticated: result.valid,
    role: result.valid ? 'admin' : undefined,
  });
}
