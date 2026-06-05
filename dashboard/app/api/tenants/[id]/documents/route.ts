import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
// Direct import avoids pdf-parse's test-file side effect on module load
import pdfParse from 'pdf-parse/lib/pdf-parse.js'

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
    const contentType = req.headers.get('content-type') ?? ''

    let title: string
    let content: string
    let file_type: string | null = null
    let file_name: string | null = null

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      title = (form.get('title') as string | null)?.trim() ?? ''
      file_type = (form.get('file_type') as string | null) ?? null
      const file = form.get('file') as File | null

      if (!file) {
        return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
      }

      file_name = file.name
      const buf = Buffer.from(await file.arrayBuffer())

      if (file_type === 'pdf') {
        const parsed = await pdfParse(buf)
        content = parsed.text
      } else {
        content = buf.toString('utf8')
      }
    } else {
      const body = await req.json()
      title = (body.title as string | undefined)?.trim() ?? ''
      content = (body.content as string | undefined)?.trim() ?? ''
      file_type = body.file_type ?? null
    }

    if (!title || !content) {
      return NextResponse.json({ error: 'title and content are required' }, { status: 400 })
    }

    const result = await query(
      `INSERT INTO kb_documents (tenant_id, title, content, file_name, file_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, title, file_name, file_type, created_at`,
      [id, title, content, file_name, file_type]
    )

    return NextResponse.json(result.rows[0], { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`POST /api/tenants/${id}/documents error:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
