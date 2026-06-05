import { NextRequest, NextResponse } from 'next/server'
import { promises as dns } from 'dns'
import { isIP } from 'net'
import { query } from '@/lib/db'
// Direct import avoids pdf-parse's test-file side effect on module load
import pdfParse from 'pdf-parse/lib/pdf-parse.js'

interface RouteParams {
  params: Promise<{ id: string }>
}

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, '\n')
    .trim()
}

// SSRF protection -------------------------------------------------------

const PRIVATE_IPV4 = [
  /^127\./,                                    // 127.0.0.0/8  loopback
  /^10\./,                                     // 10.0.0.0/8   private
  /^172\.(1[6-9]|2\d|3[01])\./,               // 172.16.0.0/12 private
  /^192\.168\./,                               // 192.168.0.0/16 private
  /^169\.254\./,                               // 169.254.0.0/16 link-local (cloud metadata)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 shared
  /^0\./,                                      // 0.0.0.0/8
]
const PRIVATE_IPV6 = [/^::1$/, /^::\d*$/, /^fc/i, /^fd/i, /^fe80/i]

function isPrivateIp(addr: string): boolean {
  const v = isIP(addr)
  if (v === 4) return PRIVATE_IPV4.some(r => r.test(addr))
  if (v === 6) return PRIVATE_IPV6.some(r => r.test(addr.toLowerCase()))
  return false
}

async function resolveAndBlock(hostname: string): Promise<void> {
  const addrs = await dns.lookup(hostname, { all: true })
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new Error(`URL resolves to a private or restricted address (${address})`)
    }
  }
}

// Fetch with manual redirect handling so every hop is validated.
async function safeFetch(rawUrl: string): Promise<string> {
  const MAX_REDIRECTS = 5
  let current = rawUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL
    try { parsed = new URL(current) } catch { throw new Error('Invalid URL') }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only http and https URLs are allowed')
    }
    await resolveAndBlock(parsed.hostname)

    const res = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LineBot-KB/1.0)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error('Redirect with no Location header')
      current = new URL(location, current).toString()
      continue
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }

  throw new Error('Too many redirects')
}

// -----------------------------------------------------------------------

function detectFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'md') return 'markdown'
  return 'text'
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
      // File upload (PDF, TXT, MD)
      const form = await req.formData()
      const file = form.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

      file_name = file.name
      file_type = detectFileType(file.name)
      const providedTitle = (form.get('title') as string | null)?.trim()
      title = providedTitle || file.name.replace(/\.[^.]+$/, '')

      const buf = Buffer.from(await file.arrayBuffer())
      if (file_type === 'pdf') {
        const parsed = await pdfParse(buf)
        content = parsed.text
      } else {
        content = buf.toString('utf8')
      }
    } else {
      const body = await req.json()
      const sourceType = (body.source_type as string | undefined) ?? 'text'

      if (sourceType === 'website') {
        const url = (body.url as string | undefined)?.trim()
        if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

        let html: string
        try {
          html = await safeFetch(url)
        } catch (fetchErr) {
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
          return NextResponse.json({ error: msg }, { status: 422 })
        }
        const htmlTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()
        title = (body.title as string | undefined)?.trim() || htmlTitle || url
        content = extractTextFromHtml(html)
        file_type = 'website'
        file_name = url
      } else {
        title = (body.title as string | undefined)?.trim() ?? ''
        content = (body.content as string | undefined)?.trim() ?? ''
        file_type = (body.file_type as string | undefined) ?? 'text'
      }
    }

    if (!title || !content?.trim()) {
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
