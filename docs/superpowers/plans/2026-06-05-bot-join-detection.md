# Bot Join Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect when the LINE bot is added to a group or followed by a user, store it as a pending approval, and let the admin approve/deny from the dashboard.

**Architecture:** LINE fires `join` (group added) and `follow` (user followed) webhook events — `server.ts` currently drops them. We add handlers that insert a `pending_tenants` DB row and push a notification to existing DM allowlist users. The Next.js dashboard gains a Pending page with Approve/Deny buttons; approve writes to `access.json` (which server.ts re-reads on every message) and creates the tenant row.

**Tech Stack:** Bun/TypeScript (`server.ts`), PostgreSQL + pg (`lib/db.ts`), Next.js 16 App Router (`dashboard/`), LINE Messaging API (push endpoint).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `db/schema.sql` | Modify | Add `pending_tenants` table |
| `server.ts` | Modify | Handle `join` + `follow` events |
| `dashboard/app/api/pending/route.ts` | Create | GET list of pending |
| `dashboard/app/api/pending/[id]/approve/route.ts` | Create | POST approve → update access.json + tenant |
| `dashboard/app/api/pending/[id]/deny/route.ts` | Create | POST deny |
| `dashboard/app/pending/page.tsx` | Create | Pending approvals UI page |
| `dashboard/app/layout.tsx` | Modify | Add "Pending" nav link with live count badge |

---

## Task 1: Add pending_tenants table to schema and run migration

**Files:**
- Modify: `db/schema.sql`
- Run: `bun db/migrate.ts`

- [ ] **Step 1: Add table to schema.sql**

Append to the end of `/home/toyofumi/projects/claude-plugins/line/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS pending_tenants (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('group', 'user')),
  detected_at  TIMESTAMPTZ DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'denied'))
);
```

- [ ] **Step 2: Run migration**

```bash
DATABASE_URL=postgresql://linebot:linebot@localhost:5433/linebot bun db/migrate.ts
```

Expected output: `Migration complete`

- [ ] **Step 3: Verify table exists**

```bash
docker exec line-postgres-1 psql -U linebot -d linebot -c '\dt'
```

Expected: 7 tables including `pending_tenants`.

- [ ] **Step 4: Commit**

```bash
git add db/schema.sql
git commit -m "feat: add pending_tenants table for join/follow detection"
```

---

## Task 2: Handle join and follow events in server.ts

**Files:**
- Modify: `server.ts` — `handleLineEvent` function (~line 631) and add two new handler functions before it

**Context:** `handleLineEvent` currently returns early if `event.type !== 'message'`. LINE's `join` event fires when the bot is added to a group; `follow` fires when a user adds the bot. Both events have `event.mode` and `event.source`. `linePush` and `loadAccess` are already defined above `handleLineEvent`. `query` must be imported from `./lib/db.ts`.

- [ ] **Step 1: Add the join handler function**

Insert this function immediately before `handleLineEvent` in `server.ts`:

```typescript
async function handleJoin(source: LineSource): Promise<void> {
  const id   = source.type === 'group' ? source.groupId : (source as { roomId: string }).roomId
  const type = source.type === 'group' ? 'group' : 'group'
  if (!id) return

  try {
    await query(
      `INSERT INTO pending_tenants (id, type) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET status = 'pending', detected_at = now()
       WHERE pending_tenants.status = 'denied'`,
      [id, type],
    )
  } catch (err) {
    process.stderr.write(`line channel: handleJoin db error: ${err}\n`)
  }

  const notice = `Bot added to ${source.type} ${id}\n\nApprove or deny at http://localhost:3001/pending`
  const access = loadAccess()
  for (const uid of access.allowFrom) {
    void linePush(uid, [{ type: 'text', text: notice }]).catch(() => {})
  }
}
```

- [ ] **Step 2: Add the follow handler function**

Insert this function immediately after `handleJoin`:

```typescript
async function handleFollow(userId: string): Promise<void> {
  try {
    await query(
      `INSERT INTO pending_tenants (id, type) VALUES ($1, 'user')
       ON CONFLICT (id) DO UPDATE SET status = 'pending', detected_at = now()
       WHERE pending_tenants.status = 'denied'`,
      [userId],
    )
  } catch (err) {
    process.stderr.write(`line channel: handleFollow db error: ${err}\n`)
  }

  const notice = `New user followed bot: ${userId}\n\nApprove or deny at http://localhost:3001/pending`
  const access = loadAccess()
  for (const uid of access.allowFrom) {
    void linePush(uid, [{ type: 'text', text: notice }]).catch(() => {})
  }
}
```

- [ ] **Step 3: Import query in server.ts**

`server.ts` already imports `enrichContext` and `autoRegisterTenant` from `./lib/tenant.ts`. `lib/tenant.ts` imports `query` from `./db.ts`. We need `query` directly in `server.ts`. Add to the existing lib imports line:

```typescript
import { enrichContext, autoRegisterTenant } from './lib/tenant.ts'
import { query } from './lib/db.ts'
```

- [ ] **Step 4: Route join and follow events in handleLineEvent**

Change `handleLineEvent` from:

```typescript
async function handleLineEvent(event: LineEvent): Promise<void> {
  if (event.type !== 'message') return
  if (event.mode !== 'active')  return
```

To:

```typescript
async function handleLineEvent(event: LineEvent): Promise<void> {
  if (event.mode !== 'active') return

  if (event.type === 'join') {
    await handleJoin(event.source)
    return
  }

  if (event.type === 'follow') {
    const userId = (event.source as { type: 'user'; userId: string }).userId
    if (userId) await handleFollow(userId)
    return
  }

  if (event.type !== 'message') return
```

- [ ] **Step 5: Verify syntax (server needs LINE credentials to fully start — just check for parse errors)**

```bash
bun --print "import('./server.ts')" 2>&1 | grep -v 'LINE_CHANNEL' | head -10
```

Expected: only credential-missing errors, no TypeScript/syntax errors.

- [ ] **Step 6: Commit**

```bash
git add server.ts
git commit -m "feat: detect bot join/follow events and store as pending_tenants"
```

---

## Task 3: Dashboard API routes for pending approvals

**Files:**
- Create: `dashboard/app/api/pending/route.ts`
- Create: `dashboard/app/api/pending/[id]/approve/route.ts`
- Create: `dashboard/app/api/pending/[id]/deny/route.ts`

**Context:**
- `lib/db.ts` at project root (`dashboard/lib/db.ts`) exports `query(sql, params)`
- `access.json` lives at `~/.claude/channels/line/access.json` — it is a JSON file with shape `{ dmPolicy, allowFrom: string[], pending, groups: string[], groupTrigger, ... }`
- Approving a `group` type adds its id to `access.groups`; approving a `user` type adds its id to `access.allowFrom`
- Write access.json atomically: write to `.tmp`, then rename
- Also insert into `tenants` table on approve (ON CONFLICT DO NOTHING)
- The `DATABASE_URL` env var is `postgresql://linebot:linebot@localhost:5433/linebot`

- [ ] **Step 1: Create GET /api/pending**

Create `dashboard/app/api/pending/route.ts`:

```typescript
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
```

- [ ] **Step 2: Create POST /api/pending/[id]/approve**

Create `dashboard/app/api/pending/[id]/approve/route.ts`:

```typescript
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

    // Update access.json
    const access = readAccess()
    if (type === 'group') {
      if (!Array.isArray(access.groups)) access.groups = []
      if (!access.groups.includes(id)) access.groups.push(id)
    } else {
      if (!Array.isArray(access.allowFrom)) access.allowFrom = []
      if (!access.allowFrom.includes(id)) access.allowFrom.push(id)
    }
    saveAccess(access)

    // Register tenant
    await query(
      'INSERT INTO tenants (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [id, type],
    )

    // Mark approved
    await query(
      "UPDATE pending_tenants SET status = 'approved' WHERE id = $1",
      [id],
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[pending] approve error:', err)
    return NextResponse.json({ error: 'Failed to approve' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Create POST /api/pending/[id]/deny**

Create `dashboard/app/api/pending/[id]/deny/route.ts`:

```typescript
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
```

- [ ] **Step 4: Type-check the three new route files**

```bash
cd /home/toyofumi/projects/claude-plugins/line/dashboard && pnpm exec tsc --noEmit 2>&1 | grep -E 'error|warning' | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/pending/
git commit -m "feat(dashboard): add pending approval API routes (list, approve, deny)"
```

---

## Task 4: Pending approvals UI page + sidebar badge

**Files:**
- Create: `dashboard/app/pending/page.tsx`
- Modify: `dashboard/app/layout.tsx`

**Context:** The layout currently has a sidebar with links to Overview, Tenants, and Activity. All pages are client components using `usePathname()` for active state. Components live at `@/components/ui/`. The pending page fetches from `/api/pending` and calls `/api/pending/[id]/approve` and `/api/pending/[id]/deny`.

- [ ] **Step 1: Create pending/page.tsx**

Create `dashboard/app/pending/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

type PendingTenant = {
  id: string
  type: 'group' | 'user'
  detected_at: string
  status: string
}

export default function PendingPage() {
  const [rows, setRows]       = useState<PendingTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/pending')
      if (res.ok) setRows(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function act(id: string, action: 'approve' | 'deny') {
    setWorking(id + action)
    try {
      await fetch(`/api/pending/${encodeURIComponent(id)}/${action}`, { method: 'POST' })
      await load()
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Pending Approvals</h1>
      <Card>
        <CardHeader>
          <CardTitle>Awaiting Review</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No pending approvals. When the bot is added to a group or followed by a user it will appear here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.id}</TableCell>
                    <TableCell>
                      <Badge variant={row.type === 'group' ? 'default' : 'secondary'}>
                        {row.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(row.detected_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        onClick={() => act(row.id, 'approve')}
                        disabled={working !== null}
                      >
                        {working === row.id + 'approve' ? 'Approving…' : 'Approve'}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => act(row.id, 'deny')}
                        disabled={working !== null}
                      >
                        {working === row.id + 'deny' ? 'Denying…' : 'Deny'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Read current layout.tsx before editing**

Read `dashboard/app/layout.tsx` fully.

- [ ] **Step 3: Add Pending nav link with live count badge**

In `layout.tsx`, add a fourth nav item. The component fetches the pending count on mount and refreshes every 30 seconds.

Add a `usePendingCount` hook at the top of the client layout:

```tsx
function usePendingCount() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const load = () =>
      fetch('/api/pending').then(r => r.json()).then(rows => setCount(Array.isArray(rows) ? rows.length : 0)).catch(() => {})
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])
  return count
}
```

Then in the sidebar nav links section, add after the existing Activity link:

```tsx
<Link
  href="/pending"
  className={cn('flex items-center justify-between px-4 py-2.5 text-sm rounded-md mx-2 my-0.5 hover:bg-sidebar-accent transition-colors',
    pathname === '/pending' && 'bg-sidebar-accent text-sidebar-accent-foreground'
  )}
>
  <span>Pending</span>
  {pendingCount > 0 && (
    <span className="ml-auto bg-red-500 text-white text-xs font-medium px-1.5 py-0.5 rounded-full">
      {pendingCount}
    </span>
  )}
</Link>
```

Where `pendingCount = usePendingCount()` is called inside the component.

- [ ] **Step 4: Build to verify**

```bash
cd /home/toyofumi/projects/claude-plugins/line/dashboard && pnpm build 2>&1 | tail -15
```

Expected: clean build, `/pending` appears in route list.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/pending/ dashboard/app/layout.tsx
git commit -m "feat(dashboard): add pending approvals page with approve/deny and sidebar badge"
```

---

## Verification

1. Simulate a `join` event by inserting directly:
   ```bash
   docker exec line-postgres-1 psql -U linebot -d linebot \
     -c "INSERT INTO pending_tenants (id, type) VALUES ('C_test123', 'group');"
   ```

2. Open `http://localhost:3001/pending` — should show the row with Approve/Deny buttons.

3. Click **Approve** → verify:
   - Row disappears from pending page
   - `~/.claude/channels/line/access.json` now contains `C_test123` in `groups`
   - `SELECT * FROM tenants WHERE id = 'C_test123'` returns a row

4. Insert another test row and click **Deny** → row disappears, `access.json` unchanged.

5. Restart LINE bot server and send a message from a new group — verify `pending_tenants` row appears and notification pushes to paired DM users.
