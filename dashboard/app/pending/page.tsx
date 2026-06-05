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

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/pending')
      if (res.ok) setRows(await res.json())
      setLoading(false)
    })()
  }, [])

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
