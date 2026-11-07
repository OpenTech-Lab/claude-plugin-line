'use client'

import { useEffect, useState } from 'react'
import {
  Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Check, Copy, Plus } from 'lucide-react'

type ApiToken = {
  id: string
  name: string
  token_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

async function errorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}))
  return body.error ?? fallback
}

// ---------- Create Token Dialog ----------
function CreateTokenDialog({ onCreated }: { onCreated: (row: ApiToken) => void }) {
  const [open, setOpen]             = useState(false)
  const [name, setName]             = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [created, setCreated]       = useState<string | null>(null)
  const [copied, setCopied]         = useState(false)

  function reset() {
    setName('')
    setError(null)
    setCreated(null)
    setCopied(false)
  }

  async function create() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) {
        setError(await errorMessage(res, 'Failed to create token'))
        return
      }
      const { token, ...row } = await res.json()
      setCreated(token)
      onCreated(row)
    } finally {
      setSubmitting(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setError('Copy failed; select the token and copy it manually.')
    }
  }

  const trimmed = name.trim()

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" /> Create token
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{created ? 'Token created' : 'Create token'}</DialogTitle>
          {created && (
            <DialogDescription>Copy it now — it won&apos;t be shown again.</DialogDescription>
          )}
        </DialogHeader>

        {created ? (
          <div className="flex gap-2">
            <Input
              readOnly
              value={created}
              aria-label="New API token"
              className="font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button variant="outline" className="gap-1.5" onClick={() => copy(created)}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-1.5"
            onSubmit={(e) => { e.preventDefault(); if (trimmed) create() }}
          >
            <Label htmlFor="token-name">Name</Label>
            <Input
              id="token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. claude-code on laptop"
              maxLength={64}
              autoFocus
            />
          </form>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          {created ? (
            <Button onClick={() => { setOpen(false); reset() }}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => { setOpen(false); reset() }}>Cancel</Button>
              <Button onClick={create} disabled={submitting || !trimmed}>
                {submitting ? 'Creating…' : 'Create'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Page ----------
export default function SettingsPage() {
  const [rows, setRows]           = useState<ApiToken[]>([])
  const [loading, setLoading]     = useState(true)
  const [confirming, setConfirm]  = useState<string | null>(null)
  const [working, setWorking]     = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/tokens')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: ApiToken[]) => setRows(data))
      .catch(() => setError('Failed to load tokens'))
      .finally(() => setLoading(false))
  }, [])

  async function revoke(id: string) {
    setWorking(id)
    setError(null)
    try {
      const res = await fetch(`/api/settings/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        setError(await errorMessage(res, 'Failed to revoke token'))
        return
      }
      const row: ApiToken = await res.json()
      setRows(prev => prev.map(r => (r.id === id ? row : r)))
      setConfirm(null)
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>
      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>API tokens</CardTitle>
          <CardDescription>
            For AI agents and scripts. Send as{' '}
            <code className="font-mono text-xs">Authorization: Bearer &lt;token&gt;</code>.
          </CardDescription>
          <CardAction>
            <CreateTokenDialog onCreated={(row) => setRows(prev => [row, ...prev])} />
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No tokens yet. Create one for each agent or script that calls the API.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="font-mono text-xs">{row.token_prefix}…</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.last_used_at ? new Date(row.last_used_at).toLocaleString() : 'never'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.revoked_at ? 'secondary' : 'default'}>
                        {row.revoked_at ? 'Revoked' : 'Active'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {row.revoked_at ? null : confirming === row.id ? (
                        <>
                          <span className="text-sm text-muted-foreground">Revoke this token?</span>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => revoke(row.id)}
                            disabled={working !== null}
                          >
                            {working === row.id ? 'Revoking…' : 'Confirm'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirm(null)}
                            disabled={working !== null}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirm(row.id)}
                          disabled={working !== null}
                        >
                          Revoke
                        </Button>
                      )}
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
