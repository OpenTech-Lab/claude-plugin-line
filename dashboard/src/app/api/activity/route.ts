import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenant_id')

    let sql: string
    let params: unknown[]

    if (tenantId) {
      sql = `SELECT id, tenant_id, user_id, message_preview, chunks_retrieved, created_at
             FROM activity_log
             WHERE tenant_id = $1
             ORDER BY created_at DESC
             LIMIT 50`
      params = [tenantId]
    } else {
      sql = `SELECT id, tenant_id, user_id, message_preview, chunks_retrieved, created_at
             FROM activity_log
             ORDER BY created_at DESC
             LIMIT 50`
      params = []
    }

    const result = await query(sql, params)
    return NextResponse.json(result.rows)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('GET /api/activity error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
