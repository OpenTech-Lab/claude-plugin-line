import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string; docId: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id, docId } = await params
  try {
    const result = await query(
      `SELECT id, title, file_name, file_type, content, created_at
       FROM kb_documents
       WHERE id = $1 AND tenant_id = $2`,
      [docId, id]
    )
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    return NextResponse.json(result.rows[0])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`GET /api/tenants/${id}/documents/${docId} error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Returns the trimmed value, undefined when the field was not sent, or null
// when it was sent but is not a non-empty string.
function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  return value.trim() || null
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id, docId } = await params
  try {
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const title = optionalText(body?.title)
    const content = optionalText(body?.content)
    if (title === null) {
      return NextResponse.json({ error: 'title must not be empty' }, { status: 400 })
    }
    if (content === null) {
      return NextResponse.json({ error: 'content must not be empty' }, { status: 400 })
    }
    if (title === undefined && content === undefined) {
      return NextResponse.json({ error: 'title or content is required' }, { status: 400 })
    }

    // One statement so the edit and the chunk purge are atomic: chunks were
    // derived from the old text and must not outlive it.
    const result = await query(
      `WITH updated AS (
         UPDATE kb_documents
            SET title = COALESCE($3, title),
                content = COALESCE($4, content)
          WHERE id = $1 AND tenant_id = $2
          RETURNING id, tenant_id, title, file_name, file_type, created_at
       ), purged AS (
         DELETE FROM kb_chunks WHERE document_id IN (SELECT id FROM updated)
       )
       SELECT updated.*, 0 AS chunk_count FROM updated`,
      [docId, id, title ?? null, content ?? null]
    )
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    return NextResponse.json(result.rows[0])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`PUT /api/tenants/${id}/documents/${docId} error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id, docId } = await params
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
