import { query } from '@/lib/db'
import Link from 'next/link'

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
    query('SELECT COUNT(*) AS count FROM tenants'),
    query('SELECT COUNT(*) AS count FROM tenants WHERE is_active = true'),
    query('SELECT COUNT(*) AS count FROM kb_documents'),
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
      <div>
        <div className="page-header">
          <h1>Overview</h1>
        </div>
        <div className="notice notice-error">Failed to load stats: {msg}</div>
      </div>
    )
  }

  const { totalTenants, activeTenants, totalDocuments, recentActivity } = stats

  return (
    <div>
      <div className="page-header">
        <h1>Overview</h1>
        <p>System-wide stats for the LINE bot multi-tenant system.</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total Tenants</div>
          <div className="stat-value">{totalTenants}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Tenants</div>
          <div className="stat-value">{activeTenants}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Inactive</div>
          <div className="stat-value">{totalTenants - activeTenants}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Documents</div>
          <div className="stat-value">{totalDocuments}</div>
        </div>
      </div>

      <div className="card">
        <h2>Recent Activity</h2>
        {recentActivity.length === 0 ? (
          <p className="text-muted">No activity recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Tenant</th>
                  <th>User ID</th>
                  <th>Message Preview</th>
                  <th>Chunks</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-mono">{formatDate(entry.created_at)}</td>
                    <td>
                      <Link href={`/tenants/${encodeURIComponent(entry.tenant_id)}`}>
                        <span
                          className="text-mono"
                          title={entry.tenant_id}
                        >
                          {entry.tenant_id.length > 20
                            ? entry.tenant_id.slice(0, 20) + '…'
                            : entry.tenant_id}
                        </span>
                      </Link>
                    </td>
                    <td className="text-mono" style={{ color: '#555' }}>
                      {entry.user_id}
                    </td>
                    <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.message_preview ?? <span className="text-muted">—</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>{entry.chunks_retrieved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Link href="/activity" className="btn btn-secondary btn-sm">
            View all activity →
          </Link>
        </div>
      </div>
    </div>
  )
}
