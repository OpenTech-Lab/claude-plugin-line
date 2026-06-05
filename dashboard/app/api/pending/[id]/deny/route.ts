import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const result = await query(
      "UPDATE pending_tenants SET status = 'denied' WHERE id = $1 AND status = 'pending' RETURNING id",
      [id],
    )
    if (!result.rows[0]) {
      return NextResponse.json({ error: 'Not found or already processed' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[pending] deny error:', err)
    return NextResponse.json({ error: 'Failed to deny' }, { status: 500 })
  }
}
