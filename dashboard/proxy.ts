import { NextFetchEvent, NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/api-tokens'

// Trust model: the dashboard listens on 127.0.0.1 only, and that bind is the
// security boundary. Inside it, API tokens give AI agents and scripts an
// identity that can be revoked, and the Sec-Fetch-Site check tells the
// dashboard's own browser fetches apart from them. Neither protects against
// a local process, which can send any header it likes.

// DNS rebinding: a hostile web page can point its own hostname at 127.0.0.1
// and then fetch this app "same-origin". Such requests still carry the
// attacker's hostname, so only loopback names are accepted.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function isLoopbackHost(req: NextRequest): boolean {
  const host = (req.headers.get('host') ?? '').toLowerCase()
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return LOOPBACK_HOSTS.has(hostname)
}

function isSameOrigin(req: NextRequest): boolean {
  return req.headers.get('sec-fetch-site') === 'same-origin'
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

export async function proxy(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl

  if (!isLoopbackHost(req)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 421 })
  }

  // Pages: the 127.0.0.1 bind is the boundary.
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return NextResponse.next()

  // Token management is UI-only, so an agent cannot mint or revoke tokens,
  // even with a valid token of its own.
  if (pathname === '/api/settings' || pathname.startsWith('/api/settings/')) {
    if (isSameOrigin(req)) return NextResponse.next()
    return NextResponse.json(
      { error: 'token management is only available from the dashboard UI' },
      { status: 403 },
    )
  }

  const token = bearerToken(req)
  if (token !== null) {
    let verified
    try {
      verified = await verifyToken(token)
    } catch (err) {
      console.error('[proxy] token lookup failed:', err)
      return NextResponse.json({ error: 'token check unavailable' }, { status: 503 })
    }
    if (!verified) {
      return NextResponse.json({ error: 'invalid or revoked token' }, { status: 401 })
    }
    if (verified.touch) {
      event.waitUntil(verified.touch.catch(err => console.error('[proxy] last_used_at update failed:', err)))
    }
    return NextResponse.next()
  }

  if (isSameOrigin(req)) return NextResponse.next()
  return NextResponse.json({ error: 'API token required (create one in Settings)' }, { status: 401 })
}

export const config = {
  // Everything except build assets and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico$).*)'],
}
