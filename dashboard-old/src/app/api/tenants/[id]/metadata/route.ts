import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  try {
    const result = await query(
      'SELECT key, value FROM tenant_metadata WHERE tenant_id = $1',
      [id]
    )
    const metadata: Record<string, string> = {}
    for (const row of result.rows) {
      metadata[row.key] = row.value
    }
    return NextResponse.json(metadata)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`GET /api/tenants/${id}/metadata error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  try {
    const body: Record<string, string> = await req.json()
    const entries = Object.entries(body)

    if (entries.length > 0) {
      for (const [key, value] of entries) {
        await query(
          `INSERT INTO tenant_metadata (tenant_id, key, value)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
          [id, key, value]
        )
      }

      // Delete keys that are no longer in the new set
      const keys = entries.map(([k]) => k)
      await query(
        `DELETE FROM tenant_metadata
         WHERE tenant_id = $1
           AND key != ALL($2::text[])`,
        [id, keys]
      )
    } else {
      // Empty body means clear all metadata
      await query('DELETE FROM tenant_metadata WHERE tenant_id = $1', [id])
    }

    // Return updated metadata
    const result = await query(
      'SELECT key, value FROM tenant_metadata WHERE tenant_id = $1',
      [id]
    )
    const metadata: Record<string, string> = {}
    for (const row of result.rows) {
      metadata[row.key] = row.value
    }
    return NextResponse.json(metadata)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`PUT /api/tenants/${id}/metadata error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
