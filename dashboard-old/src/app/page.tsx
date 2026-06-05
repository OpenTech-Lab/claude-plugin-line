import { query } from '@/lib/db'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

type ActivityEntry = {
  id: string
  tenant_id: string
  user_id: string
  message_preview: string | null
  chunks_retrieved: number
  created_at: string
}

async function getStats() {
  const [totalResult, activeResult, docsResult, activityResult] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM tenants'),
    query('SELECT COUNT(*)::int AS count FROM tenants WHERE is_active = true'),
    query('SELECT COUNT(*)::int AS count FROM kb_documents'),
    query(
      `SELECT id, tenant_id, user_id, message_preview, chunks_retrieved, created_at
       FROM activity_log
       ORDER BY created_at DESC
       LIMIT 5`
    ),
  ])

  return {
    totalTenants: Number(totalResult.rows[0].count),
    activeTenants: Number(activeResult.rows[0].count),
    totalDocuments: Number(docsResult.rows[0].count),
    recentActivity: activityResult.rows as ActivityEntry[],
  }
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function OverviewPage() {
  let stats: Awaited<ReturnType<typeof getStats>>

  try {
    stats = await getStats()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Overview</h1>
        <div className="rounded border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
          Failed to load stats: {msg}
        </div>
      </div>
    )
  }

  const { totalTenants, activeTenants, totalDocuments, recentActivity } = stats

  const statCards = [
    { label: 'Total Tenants', value: totalTenants },
    { label: 'Active Tenants', value: activeTenants },
    { label: 'Inactive', value: totalTenants - activeTenants },
    { label: 'Documents', value: totalDocuments },
  ]

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-1">Overview</h1>
      <p className="text-sm text-muted-foreground mb-6">
        System-wide stats for the LINE bot multi-tenant system.
      </p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {statCards.map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentActivity.length === 0 ? (
            <p className="text-muted-foreground text-sm px-6 pb-6">No activity recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Message Preview</TableHead>
                  <TableHead>Chunks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentActivity.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {formatDate(entry.created_at)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/tenants/${encodeURIComponent(entry.tenant_id)}`}
                        className="text-blue-600 hover:underline"
                      >
                        <span className="font-mono text-xs" title={entry.tenant_id}>
                          {entry.tenant_id.length > 20
                            ? entry.tenant_id.slice(0, 20) + '…'
                            : entry.tenant_id}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.user_id}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {entry.message_preview ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{entry.chunks_retrieved}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="px-6 pb-4 pt-2">
            <Link href="/activity" className="text-sm text-blue-600 hover:underline">
              View all activity →
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
