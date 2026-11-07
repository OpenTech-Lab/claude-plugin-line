import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { generateToken, hashToken, tokenPrefix } from '@/lib/api-tokens'

// Never select token_hash: it stays in the database.
const COLUMNS = 'id, name, token_prefix, created_at, last_used_at, revoked_at'

export async function GET() {
  try {
    const result = await query(`SELECT ${COLUMNS} FROM api_tokens ORDER BY created_at DESC`)
    return NextResponse.json(result.rows)
  } catch (err) {
    console.error('[settings/tokens] GET error:', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (name.length < 1 || name.length > 64) {
    return NextResponse.json({ error: 'name must be 1-64 characters' }, { status: 400 })
  }

  const token = generateToken()
  try {
    const result = await query(
      `INSERT INTO api_tokens (name, token_prefix, token_hash)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNS}`,
      [name, tokenPrefix(token), hashToken(token)],
    )
    // The only time the full token leaves the server.
    return NextResponse.json({ ...result.rows[0], token }, { status: 201 })
  } catch (err) {
    console.error('[settings/tokens] POST error:', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
