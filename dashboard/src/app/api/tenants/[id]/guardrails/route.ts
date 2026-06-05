import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  try {
    const result = await query(
      'SELECT * FROM tenant_guardrails WHERE tenant_id = $1',
      [id]
    )
    return NextResponse.json(result.rows[0] ?? {})
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`GET /api/tenants/${id}/guardrails error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  try {
    const body = await req.json()
    const {
      allowed_topics,
      blocked_topics,
      blocked_words,
      pii_redaction,
      custom_instructions,
    } = body

    const result = await query(
      `INSERT INTO tenant_guardrails
         (tenant_id, allowed_topics, blocked_topics, blocked_words, pii_redaction, custom_instructions)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id) DO UPDATE SET
         allowed_topics    = EXCLUDED.allowed_topics,
         blocked_topics    = EXCLUDED.blocked_topics,
         blocked_words     = EXCLUDED.blocked_words,
         pii_redaction     = EXCLUDED.pii_redaction,
         custom_instructions = EXCLUDED.custom_instructions
       RETURNING *`,
      [
        id,
        allowed_topics ?? null,
        blocked_topics ?? null,
        blocked_words ?? null,
        pii_redaction ?? null,
        custom_instructions ?? null,
      ]
    )

    return NextResponse.json(result.rows[0])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`PUT /api/tenants/${id}/guardrails error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
