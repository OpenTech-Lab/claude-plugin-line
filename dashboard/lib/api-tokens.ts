import { createHash, randomBytes } from 'node:crypto'
import { query } from '@/lib/db'

export const TOKEN_PREFIX_LENGTH = 12
const CACHE_TTL_MS = 30_000
const TOUCH_INTERVAL_MS = 60_000

// A new token: "lba_" + 32 random bytes, base64url.
export function generateToken(): string {
  return 'lba_' + randomBytes(32).toString('base64url')
}

// What the database stores instead of the token itself.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Shown in the UI so a token can be recognised without revealing it.
export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX_LENGTH)
}

type CacheEntry = { id: string; expiresAt: number; lastTouched: number }

// proxy.ts and the route handlers are compiled as separate bundles, so a
// module-level Map could exist twice; globalThis gives them one shared cache
// when they run in the same process, which revocation relies on.
const CACHE_KEY = Symbol.for('lba.apiTokenCache')
const store = globalThis as typeof globalThis & { [CACHE_KEY]?: Map<string, CacheEntry> }
const cache = (store[CACHE_KEY] ??= new Map<string, CacheEntry>())

export type VerifiedToken = {
  id: string
  // Resolves once last_used_at is written; null when it was written recently.
  touch: Promise<void> | null
}

// Looks up a presented token by hash. Returns null when it is unknown or
// revoked; throws when the database cannot be reached (callers fail closed).
export async function verifyToken(token: string): Promise<VerifiedToken | null> {
  const hash = hashToken(token)
  const now = Date.now()

  let entry = cache.get(hash)
  if (!entry || entry.expiresAt <= now) {
    const result = await query(
      'SELECT id FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL',
      [hash],
    )
    if (result.rows.length === 0) {
      cache.delete(hash)
      return null
    }
    entry = { id: result.rows[0].id, expiresAt: now + CACHE_TTL_MS, lastTouched: entry?.lastTouched ?? 0 }
    cache.set(hash, entry)
  }

  let touch: Promise<void> | null = null
  if (now - entry.lastTouched >= TOUCH_INTERVAL_MS) {
    entry.lastTouched = now
    touch = query('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [entry.id]).then(() => {})
  }
  return { id: entry.id, touch }
}

// Drops a token from the cache so a revoke takes effect on the next request.
export function evictToken(hash: string): void {
  cache.delete(hash)
}
