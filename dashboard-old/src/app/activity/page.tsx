'use client'

import { useEffect, useState } from 'react'
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
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-1">Activity Log</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Most recent 50 interactions across all tenants.
      </p>

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
          Error: {error}
        </div>
      )}

      {!loading && !error && (
        <Card>
          <CardContent className="p-0">
            {entries.length === 0 ? (
              <p className="text-muted-foreground text-sm p-6">No activity recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Tenant ID</TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>Message Preview</TableHead>
                    <TableHead>Chunks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {formatDate(entry.created_at)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/tenants/${encodeURIComponent(entry.tenant_id)}`}
                          className="text-blue-600 hover:underline"
                          title={entry.tenant_id}
                        >
                          <span className="font-mono text-xs">
                            {entry.tenant_id.length > 20
                              ? entry.tenant_id.slice(0, 20) + '…'
                              : entry.tenant_id}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {entry.user_id}
                      </TableCell>
                      <TableCell
                        className="max-w-xs truncate text-sm"
                        title={entry.message_preview ?? undefined}
                      >
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
          </CardContent>
        </Card>
      )}
    </div>
  )
}
