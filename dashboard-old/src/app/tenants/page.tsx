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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Tenant = {
  id: string
  type: 'group' | 'user'
  display_name: string | null
  is_active: boolean
  created_at: string
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add form state
  const [showForm, setShowForm] = useState(false)
  const [formId, setFormId] = useState('')
  const [formType, setFormType] = useState<'group' | 'user'>('group')
  const [formName, setFormName] = useState('')
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function loadTenants() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tenants')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setTenants(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTenants()
  }, [])

  async function toggleActive(tenant: Tenant) {
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenant.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !tenant.is_active }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setTenants((prev) =>
        prev.map((t) => (t.id === tenant.id ? { ...t, is_active: !t.is_active } : t))
      )
    } catch (err) {
      alert('Failed to update status: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  async function handleAddTenant(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!formId.trim()) {
      setFormError('ID is required.')
      return
    }
    setFormSubmitting(true)
    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: formId.trim(),
          type: formType,
          display_name: formName.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setTenants((prev) => [data, ...prev])
      setFormId('')
      setFormType('group')
      setFormName('')
      setShowForm(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setFormSubmitting(false)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Tenants</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All LINE groups and users registered in the system.
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Add Tenant'}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6 border-l-4 border-l-blue-600">
          <CardHeader>
            <CardTitle className="text-base">Add Tenant</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddTenant}>
              <div className="flex gap-3 items-end flex-wrap">
                <div className="flex-[2] min-w-[160px] space-y-1">
                  <Label htmlFor="form-id">LINE ID *</Label>
                  <Input
                    id="form-id"
                    placeholder="C1234abcd... or Uf1234abcd..."
                    value={formId}
                    onChange={(e) => setFormId(e.target.value)}
                    required
                  />
                </div>
                <div className="flex-1 min-w-[100px] space-y-1">
                  <Label htmlFor="form-type">Type *</Label>
                  <Select
                    value={formType}
                    onValueChange={(v) => setFormType(v as 'group' | 'user')}
                  >
                    <SelectTrigger id="form-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="group">Group</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-[2] min-w-[160px] space-y-1">
                  <Label htmlFor="form-name">Display Name</Label>
                  <Input
                    id="form-name"
                    placeholder="Optional friendly name"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </div>
                <div className="flex-none pb-0">
                  <Button type="submit" disabled={formSubmitting}>
                    {formSubmitting ? 'Saving…' : 'Add'}
                  </Button>
                </div>
              </div>
              {formError && (
                <div className="mt-3 rounded border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm">
                  {formError}
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
          Error: {error}
        </div>
      )}

      {!loading && !error && (
        <Card>
          <CardContent className="p-0">
            {tenants.length === 0 ? (
              <p className="text-muted-foreground text-sm p-6">No tenants yet. Add one above.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((tenant) => (
                    <TableRow key={tenant.id}>
                      <TableCell>
                        <span className="font-mono text-xs" title={tenant.id}>
                          {truncate(tenant.id, 24)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          tenant.type === 'group'
                            ? 'border-blue-300 text-blue-700 bg-blue-50'
                            : 'border-green-300 text-green-700 bg-green-50'
                        }>
                          {tenant.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {tenant.display_name ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={tenant.is_active}
                          onCheckedChange={() => toggleActive(tenant)}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(tenant.created_at)}
                      </TableCell>
                      <TableCell>
                        <Link href={`/tenants/${encodeURIComponent(tenant.id)}`}>
                          <Button variant="outline" size="sm">
                            View
                          </Button>
                        </Link>
                      </TableCell>
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
