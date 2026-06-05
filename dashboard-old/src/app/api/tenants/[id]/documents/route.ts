import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  try {
    const result = await query(
      `SELECT
         id,
         title,
         file_name,
         file_type,
         created_at,
         (SELECT COUNT(*) FROM kb_chunks WHERE document_id = kb_documents.id) AS chunk_count
       FROM kb_documents
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [id]
    )
    return NextResponse.json(result.rows)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`GET /api/tenants/${id}/documents error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  try {
    const body = await req.json()
    const { title, content, file_type } = body

    if (!title || !content) {
      return NextResponse.json({ error: 'title and content are required' }, { status: 400 })
    }

    const result = await query(
      `INSERT INTO kb_documents (tenant_id, title, content, file_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tenant_id, title, file_name, file_type, created_at`,
      [id, title, content, file_type ?? null]
    )

    return NextResponse.json(result.rows[0], { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`POST /api/tenants/${id}/documents error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
