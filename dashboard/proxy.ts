import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, adminToken, safeEqual, sessionValue } from '@/lib/auth'

// Reachable without a session so the operator can sign in and out.
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout'])

function isAuthorized(req: NextRequest, token: string): boolean {
  const header = req.headers.get('authorization') ?? ''
  if (header.startsWith('Bearer ') && safeEqual(header.slice(7), token)) return true

  const cookie = req.cookies.get(SESSION_COOKIE)?.value
  return cookie !== undefined && safeEqual(cookie, sessionValue(token))
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next()

  const token = adminToken()
  if (!token) {
    return NextResponse.json({ error: 'ADMIN_API_TOKEN not configured' }, { status: 503 })
  }

  if (isAuthorized(req, token)) return NextResponse.next()

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const login = new URL('/login', req.url)
  login.searchParams.set('next', pathname + search)
  return NextResponse.redirect(login)
}

export const config = {
  // Everything except build assets and the favicon; public paths are
  // allowed in code above so the match is exact.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico$).*)'],
}
