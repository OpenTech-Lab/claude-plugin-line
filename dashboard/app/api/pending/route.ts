import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET() {
  try {
    const result = await query(
      `SELECT id, type, detected_at, status
       FROM pending_tenants
       WHERE status = 'pending'
       ORDER BY detected_at DESC`,
    )
    return NextResponse.json(result.rows)
  } catch (err) {
    console.error('[pending] GET error:', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
