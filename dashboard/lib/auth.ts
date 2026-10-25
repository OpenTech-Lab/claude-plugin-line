import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'lba_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, in seconds

// The configured admin token, or null when unset/empty (callers fail closed).
export function adminToken(): string | null {
  return process.env.ADMIN_API_TOKEN || null
}

// Session cookie value derived from the token, so rotating the token
// invalidates every existing session.
export function sessionValue(token: string): string {
  return createHmac('sha256', token).update('lba-session-v1').digest('hex')
}

// Constant-time string comparison. Hashing first gives equal-length buffers,
// which timingSafeEqual requires, without leaking the length of either input.
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

// Only same-origin relative paths: "/x" yes, "//evil" and "/\evil" no.
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !/^\/(?![/\\])/.test(next) || /[\\\x00-\x1f]/.test(next)) {
    return '/'
  }
  return next
}
