import { NextRequest, NextResponse } from 'next/server';

const TARGET_API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function proxyRequest(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = (params.path || []).join('/');
  const search = req.nextUrl.search || '';
  const targetUrl = `${TARGET_API_URL}/${path}${search}`;

  const forwardHeaders: Record<string, string> = {};

  const contentType = req.headers.get('content-type');
  if (contentType) forwardHeaders['content-type'] = contentType;

  const authHeader = req.headers.get('authorization');
  if (authHeader) forwardHeaders['authorization'] = authHeader;

  // Forward HttpOnly admin session cookie from browser same-site request to Express API
  const adminSessionCookie = req.cookies.get('admin_session')?.value;
  if (adminSessionCookie) {
    forwardHeaders['cookie'] = `admin_session=${adminSessionCookie}`;
  } else {
    // If other cookies are present
    const rawCookie = req.headers.get('cookie');
    if (rawCookie) forwardHeaders['cookie'] = rawCookie;
  }

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
