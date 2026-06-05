import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { query } from '@/lib/db'

const ACCESS_FILE = join(homedir(), '.claude', 'channels', 'line', 'access.json')

function readAccess() {
  try {
    return JSON.parse(readFileSync(ACCESS_FILE, 'utf8'))
  } catch {
    return { dmPolicy: 'pairing', allowFrom: [], pending: {}, groups: [], groupTrigger: 'mention' }
  }
}

function saveAccess(access: Record<string, unknown>) {
  const tmp = ACCESS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(access, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, ACCESS_FILE)
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const row = await query(
      'SELECT id, type FROM pending_tenants WHERE id = $1 AND status = $2',
      [id, 'pending'],
    )
    if (!row.rows[0]) {
      return NextResponse.json({ error: 'Not found or already processed' }, { status: 404 })
    }
    const { type } = row.rows[0] as { type: string }

    await query(
      'INSERT INTO tenants (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [id, type],
    )

    await query(
      "UPDATE pending_tenants SET status = 'approved' WHERE id = $1",
      [id],
    )

    const access = readAccess()
    if (type === 'group' || type === 'room') {
      if (!Array.isArray(access.groups)) access.groups = []
      if (!access.groups.includes(id)) access.groups.push(id)
    } else if (type === 'user') {
      if (!Array.isArray(access.allowFrom)) access.allowFrom = []
      if (!access.allowFrom.includes(id)) access.allowFrom.push(id)
    }
    saveAccess(access)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[pending] approve error:', err)
    return NextResponse.json({ error: 'Failed to approve' }, { status: 500 })
  }
}
