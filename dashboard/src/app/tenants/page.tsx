'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

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

  async function deleteTenant(tenant: Tenant) {
    if (!confirm(`Delete tenant "${tenant.display_name ?? tenant.id}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenant.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setTenants((prev) => prev.filter((t) => t.id !== tenant.id))
    } catch (err) {
      alert('Failed to delete: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  async function handleAddTenant(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!formId.trim()) { setFormError('ID is required.'); return }
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
    <div>
      <div className="page-header">
        <div className="flex-row">
          <h1>Tenants</h1>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Add Tenant'}
          </button>
        </div>
        <p>All LINE groups and users registered in the system.</p>
      </div>

      {showForm && (
        <div className="card" style={{ borderLeft: '4px solid #2563eb' }}>
          <h2>Add Tenant</h2>
          <form onSubmit={handleAddTenant}>
            <div className="form-inline">
              <div className="form-group" style={{ flex: 2 }}>
                <label>LINE ID *</label>
                <input
                  type="text"
                  placeholder="C1234abcd... or Uf1234abcd..."
                  value={formId}
                  onChange={(e) => setFormId(e.target.value)}
                  required
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Type *</label>
                <select value={formType} onChange={(e) => setFormType(e.target.value as 'group' | 'user')}>
                  <option value="group">Group</option>
                  <option value="user">User</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 2 }}>
                <label>Display Name</label>
                <input
                  type="text"
                  placeholder="Optional friendly name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ flex: 'none' }}>
                <label>&nbsp;</label>
                <button type="submit" className="btn btn-primary" disabled={formSubmitting}>
                  {formSubmitting ? 'Saving…' : 'Add'}
                </button>
              </div>
            </div>
            {formError && <div className="notice notice-error">{formError}</div>}
          </form>
        </div>
      )}

      {loading && <p className="text-muted">Loading…</p>}
      {error && <div className="notice notice-error">Error: {error}</div>}

      {!loading && !error && (
        <div className="card">
          {tenants.length === 0 ? (
            <p className="text-muted">No tenants yet. Add one above.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>
                        <span className="text-mono" title={tenant.id}>
                          {truncate(tenant.id, 20)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-${tenant.type}`}>{tenant.type}</span>
                      </td>
                      <td>{tenant.display_name ?? <span className="text-muted">—</span>}</td>
                      <td>
                        <button
                          className={`badge ${tenant.is_active ? 'badge-active' : 'badge-inactive'}`}
                          style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}
                          title="Click to toggle"
                          onClick={() => toggleActive(tenant)}
                        >
                          {tenant.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="text-muted">{formatDate(tenant.created_at)}</td>
                      <td>
                        <div className="flex-row">
                          <Link
                            href={`/tenants/${encodeURIComponent(tenant.id)}`}
                            className="btn btn-secondary btn-sm"
                          >
                            View
                          </Link>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => deleteTenant(tenant)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
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
