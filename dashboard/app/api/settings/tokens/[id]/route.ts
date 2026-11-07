import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { evictToken } from '@/lib/api-tokens'

interface RouteParams {
  params: Promise<{ id: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Revoke. Idempotent: an already-revoked token keeps its original revoked_at.
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  }
  try {
    const result = await query(
      `UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, now())
       WHERE id = $1
       RETURNING id, name, token_prefix, created_at, last_used_at, revoked_at, token_hash`,
      [id],
    )
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }
    const { token_hash, ...row } = result.rows[0]
    evictToken(token_hash)
    return NextResponse.json(row)
  } catch (err) {
    console.error(`[settings/tokens] DELETE ${id} error:`, err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
