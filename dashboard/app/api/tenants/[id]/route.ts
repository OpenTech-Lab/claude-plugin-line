import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  try {
    const tenantResult = await query('SELECT * FROM tenants WHERE id = $1', [id])
    if (tenantResult.rows.length === 0) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    const guardrailsResult = await query(
      'SELECT * FROM tenant_guardrails WHERE tenant_id = $1',
      [id]
    )

    const metadataResult = await query(
      'SELECT key, value FROM tenant_metadata WHERE tenant_id = $1',
      [id]
    )

    const metadata: Record<string, string> = {}
    for (const row of metadataResult.rows) {
      metadata[row.key] = row.value
    }

    return NextResponse.json({
      ...tenantResult.rows[0],
      guardrails: guardrailsResult.rows[0] ?? {},
      metadata,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`GET /api/tenants/${id} error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  try {
    const body = await req.json()
    const { display_name, system_prompt, is_active } = body

    const setClauses: string[] = ['updated_at = now()']
    const values: unknown[] = []
    let idx = 1

    if (display_name !== undefined) {
      setClauses.push(`display_name = $${idx++}`)
      values.push(display_name)
    }
    if (system_prompt !== undefined) {
      setClauses.push(`system_prompt = $${idx++}`)
      values.push(system_prompt)
    }
    if (is_active !== undefined) {
      setClauses.push(`is_active = $${idx++}`)
      values.push(is_active)
    }

    if (setClauses.length === 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    values.push(id)
    const result = await query(
      `UPDATE tenants SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    return NextResponse.json(result.rows[0])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`PUT /api/tenants/${id} error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  try {
    const result = await query('DELETE FROM tenants WHERE id = $1 RETURNING id', [id])
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }
    return NextResponse.json({ deleted: result.rows[0].id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`DELETE /api/tenants/${id} error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
