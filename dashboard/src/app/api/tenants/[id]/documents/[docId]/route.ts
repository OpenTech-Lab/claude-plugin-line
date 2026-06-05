import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

interface RouteParams {
  params: { id: string; docId: string }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id, docId } = params
  try {
    const result = await query(
      'DELETE FROM kb_documents WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [docId, id]
    )
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    return NextResponse.json({ deleted: result.rows[0].id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`DELETE /api/tenants/${id}/documents/${docId} error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
