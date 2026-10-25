import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, SESSION_MAX_AGE, adminToken, safeEqual, safeNextPath, sessionValue } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const token = adminToken()
  if (!token) {
    return NextResponse.json({ error: 'ADMIN_API_TOKEN not configured' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const submitted = typeof body?.token === 'string' ? body.token : ''
  if (!safeEqual(submitted, token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Behind the tunnel the app sees plain http, so trust the forwarded scheme too.
  const https =
    req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https'

  const res = NextResponse.json({ ok: true, next: safeNextPath(body.next) })
  res.cookies.set(SESSION_COOKIE, sessionValue(token), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: https,
    maxAge: SESSION_MAX_AGE,
  })
  return res
}
