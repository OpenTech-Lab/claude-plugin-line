import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET() {
  try {
    const result = await query(
      'SELECT id, type, display_name, is_active, created_at FROM tenants ORDER BY created_at DESC'
    )
    return NextResponse.json(result.rows)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('GET /api/tenants error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, type, display_name, system_prompt } = body

    if (!id || !type) {
      return NextResponse.json({ error: 'id and type are required' }, { status: 400 })
    }

    const result = await query(
      `INSERT INTO tenants (id, type, display_name, system_prompt)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING id, type, display_name, is_active, created_at`,
      [id, type, display_name ?? null, system_prompt ?? null]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Tenant already exists' }, { status: 409 })
    }

    return NextResponse.json(result.rows[0], { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('POST /api/tenants error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
