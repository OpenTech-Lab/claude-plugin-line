'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type ActivityEntry = {
  id: string
  tenant_id: string
  user_id: string
  message_preview: string | null
  chunks_retrieved: number
  created_at: string
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

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/activity')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setEntries(await res.json())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div>
      <div className="page-header">
        <h1>Activity Log</h1>
        <p>Most recent 50 interactions across all tenants.</p>
      </div>

      {loading && <p className="text-muted">Loading…</p>}
      {error && <div className="notice notice-error">Error: {error}</div>}

      {!loading && !error && (
        <div className="card">
          {entries.length === 0 ? (
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
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="text-mono" style={{ whiteSpace: 'nowrap' }}>
                        {formatDate(entry.created_at)}
                      </td>
                      <td>
                        <Link
                          href={`/tenants/${encodeURIComponent(entry.tenant_id)}`}
                          title={entry.tenant_id}
                        >
                          <span className="text-mono">
                            {entry.tenant_id.length > 20
                              ? entry.tenant_id.slice(0, 20) + '…'
                              : entry.tenant_id}
                          </span>
                        </Link>
                      </td>
                      <td className="text-mono" style={{ color: '#555' }}>
                        {entry.user_id}
                      </td>
                      <td
                        style={{
                          maxWidth: 380,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={entry.message_preview ?? undefined}
                      >
                        {entry.message_preview ?? <span className="text-muted">—</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>{entry.chunks_retrieved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
