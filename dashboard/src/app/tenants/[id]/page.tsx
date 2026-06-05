'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

// ---------- Types ----------
type Tenant = {
  id: string
  type: 'group' | 'user'
  display_name: string | null
  system_prompt: string | null
  is_active: boolean
  created_at: string
  guardrails?: Guardrails
  metadata?: Record<string, string>
}

type Guardrails = {
  blocked_topics?: string[] | null
  blocked_words?: string[] | null
  pii_redaction?: boolean
  custom_instructions?: string | null
}

type Document = {
  id: string
  title: string | null
  file_name: string | null
  file_type: string | null
  created_at: string
  chunk_count: number
}

type ActivityEntry = {
  id: string
  tenant_id: string
  user_id: string
  message_preview: string | null
  chunks_retrieved: number
  created_at: string
}

type Tab = 'persona' | 'knowledge' | 'guardrails' | 'metadata' | 'activity'

// ---------- Helpers ----------
function formatDate(ts: string) {
  return new Date(ts).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function arrToText(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return ''
  return arr.join('\n')
}

function textToArr(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// ---------- Persona Tab ----------
function PersonaTab({ tenant, onUpdate }: { tenant: Tenant; onUpdate: (t: Tenant) => void }) {
  const [displayName, setDisplayName] = useState(tenant.display_name ?? '')
  const [systemPrompt, setSystemPrompt] = useState(tenant.system_prompt ?? '')
  const [isActive, setIsActive] = useState(tenant.is_active)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  async function handleSave() {
    setSaving(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenant.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName || null,
          system_prompt: systemPrompt || null,
          is_active: isActive,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      onUpdate({ ...tenant, ...data })
      setNotice({ type: 'success', msg: 'Saved.' })
    } catch (err) {
      setNotice({ type: 'error', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="form-group">
        <label>Display Name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Friendly name for this tenant"
        />
      </div>
      <div className="form-group">
        <label>System Prompt</label>
        <textarea
          className="monospace"
          rows={12}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Enter the system prompt for this tenant's AI persona…"
        />
      </div>
      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active (bot responds to messages from this tenant)
        </label>
      </div>
      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Persona'}
      </button>
      {notice && (
        <div className={`notice notice-${notice.type}`}>{notice.msg}</div>
      )}
    </div>
  )
}

// ---------- Knowledge Base Tab ----------
function KnowledgeTab({ tenantId }: { tenantId: string }) {
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add doc form
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [fileType, setFileType] = useState('text')
  const [adding, setAdding] = useState(false)
  const [addNotice, setAddNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const loadDocs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/documents`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDocs(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { loadDocs() }, [loadDocs])

  async function deleteDoc(doc: Document) {
    if (!confirm(`Delete document "${doc.title ?? doc.id}"?`)) return
    try {
      const res = await fetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/documents/${doc.id}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    } catch (err) {
      alert('Delete failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  async function handleAddDoc(e: React.FormEvent) {
    e.preventDefault()
    setAddNotice(null)
    if (!title.trim() || !content.trim()) {
      setAddNotice({ type: 'error', msg: 'Title and content are required.' })
      return
    }
    setAdding(true)
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), file_type: fileType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDocs((prev) => [data, ...prev])
      setTitle('')
      setContent('')
      setFileType('text')
      setAddNotice({ type: 'success', msg: 'Document added. It will need to be embedded before appearing in retrieval.' })
    } catch (err) {
      setAddNotice({ type: 'error', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setAdding(false)
    }
  }

  return (
    <div>
      {loading && <p className="text-muted">Loading documents…</p>}
      {error && <div className="notice notice-error">Error: {error}</div>}
      {!loading && !error && (
        <>
          {docs.length === 0 ? (
            <p className="text-muted">No documents yet.</p>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 24 }}>
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>File Type</th>
                    <th>Chunks</th>
                    <th>Added</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => (
                    <tr key={doc.id}>
                      <td>{doc.title ?? <span className="text-muted">{doc.file_name ?? '—'}</span>}</td>
                      <td>
                        {doc.file_type ? (
                          <span className="badge badge-group">{doc.file_type}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>{doc.chunk_count}</td>
                      <td className="text-muted">{formatDate(doc.created_at)}</td>
                      <td>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteDoc(doc)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Add Document</h2>
        <form onSubmit={handleAddDoc}>
          <div className="form-inline" style={{ marginBottom: 12 }}>
            <div className="form-group" style={{ flex: 3 }}>
              <label>Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Document title"
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>File Type</label>
              <select value={fileType} onChange={(e) => setFileType(e.target.value)}>
                <option value="text">text</option>
                <option value="markdown">markdown</option>
                <option value="pdf">pdf</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Content *</label>
            <textarea
              className="monospace"
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste document content here…"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={adding}>
            {adding ? 'Saving…' : 'Add Document'}
          </button>
        </form>
        {addNotice && (
          <div className={`notice notice-${addNotice.type}`}>{addNotice.msg}</div>
        )}
        <div className="notice notice-info" style={{ marginTop: 12 }}>
          After saving, the document needs to be embedded before it appears in knowledge base retrieval.
        </div>
      </div>
    </div>
  )
}

// ---------- Guardrails Tab ----------
function GuardrailsTab({ tenant }: { tenant: Tenant }) {
  const g = tenant.guardrails ?? {}
  const [blockedTopics, setBlockedTopics] = useState(arrToText(g.blocked_topics))
  const [blockedWords, setBlockedWords] = useState(arrToText(g.blocked_words))
  const [piiRedaction, setPiiRedaction] = useState(g.pii_redaction ?? false)
  const [customInstructions, setCustomInstructions] = useState(g.custom_instructions ?? '')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  async function handleSave() {
    setSaving(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenant.id)}/guardrails`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocked_topics: textToArr(blockedTopics).length ? textToArr(blockedTopics) : null,
          blocked_words: textToArr(blockedWords).length ? textToArr(blockedWords) : null,
          pii_redaction: piiRedaction,
          custom_instructions: customInstructions.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setNotice({ type: 'success', msg: 'Guardrails saved.' })
    } catch (err) {
      setNotice({ type: 'error', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="form-group">
        <label>Blocked Topics</label>
        <textarea
          rows={5}
          value={blockedTopics}
          onChange={(e) => setBlockedTopics(e.target.value)}
          placeholder="One topic per line (e.g. politics)"
        />
        <div className="form-hint">Enter one topic per line. The bot will refuse to discuss these.</div>
      </div>
      <div className="form-group">
        <label>Blocked Words</label>
        <textarea
          rows={4}
          value={blockedWords}
          onChange={(e) => setBlockedWords(e.target.value)}
          placeholder="One word or phrase per line"
        />
        <div className="form-hint">Enter one word or phrase per line. Messages containing these will be filtered.</div>
      </div>
      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={piiRedaction}
            onChange={(e) => setPiiRedaction(e.target.checked)}
          />
          Enable PII Redaction (automatically redact names, emails, phone numbers, etc.)
        </label>
      </div>
      <div className="form-group">
        <label>Custom Instructions</label>
        <textarea
          rows={5}
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder="Additional guardrail instructions for this tenant…"
        />
      </div>
      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Guardrails'}
      </button>
      {notice && <div className={`notice notice-${notice.type}`}>{notice.msg}</div>}
    </div>
  )
}

// ---------- Metadata Tab ----------
function MetadataTab({ tenant }: { tenant: Tenant }) {
  const [pairs, setPairs] = useState<{ key: string; value: string }[]>(
    Object.entries(tenant.metadata ?? {}).map(([k, v]) => ({ key: k, value: v }))
  )
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function addRow() {
    if (!newKey.trim()) return
    if (pairs.some((p) => p.key === newKey.trim())) {
      setNotice({ type: 'error', msg: `Key "${newKey.trim()}" already exists.` })
      return
    }
    setPairs((prev) => [...prev, { key: newKey.trim(), value: newValue.trim() }])
    setNewKey('')
    setNewValue('')
    setNotice(null)
  }

  function deleteRow(key: string) {
    setPairs((prev) => prev.filter((p) => p.key !== key))
  }

  function updateValue(key: string, value: string) {
    setPairs((prev) => prev.map((p) => (p.key === key ? { ...p, value } : p)))
  }

  async function handleSave() {
    setSaving(true)
    setNotice(null)
    const body: Record<string, string> = {}
    for (const { key, value } of pairs) {
      body[key] = value
    }
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenant.id)}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setNotice({ type: 'success', msg: 'Metadata saved.' })
    } catch (err) {
      setNotice({ type: 'error', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {pairs.length > 0 ? (
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <tr key={p.key}>
                  <td className="text-mono" style={{ width: '35%' }}>{p.key}</td>
                  <td>
                    <input
                      type="text"
                      value={p.value}
                      onChange={(e) => updateValue(p.key, e.target.value)}
                      style={{ margin: 0 }}
                    />
                  </td>
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteRow(p.key)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted" style={{ marginBottom: 16 }}>No metadata yet.</p>
      )}

      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, marginBottom: 16 }}>
        <div className="form-inline">
          <div className="form-group" style={{ flex: 2 }}>
            <label>Key</label>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="key"
              onKeyDown={(e) => e.key === 'Enter' && addRow()}
            />
          </div>
          <div className="form-group" style={{ flex: 3 }}>
            <label>Value</label>
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value"
              onKeyDown={(e) => e.key === 'Enter' && addRow()}
            />
          </div>
          <div className="form-group" style={{ flex: 'none' }}>
            <label>&nbsp;</label>
            <button className="btn btn-secondary" onClick={addRow}>Add Row</button>
          </div>
        </div>
      </div>

      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save All Metadata'}
      </button>
      {notice && <div className={`notice notice-${notice.type}`}>{notice.msg}</div>}
    </div>
  )
}

// ---------- Activity Tab ----------
function ActivityTab({ tenantId }: { tenantId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/activity?tenant_id=${encodeURIComponent(tenantId)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setEntries(await res.json())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [tenantId])

  if (loading) return <p className="text-muted">Loading activity…</p>
  if (error) return <div className="notice notice-error">Error: {error}</div>

  if (entries.length === 0) {
    return <p className="text-muted">No activity recorded for this tenant yet.</p>
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User ID</th>
            <th>Message Preview</th>
            <th>Chunks Retrieved</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="text-mono" style={{ whiteSpace: 'nowrap' }}>{formatDate(entry.created_at)}</td>
              <td className="text-mono" style={{ color: '#555' }}>{entry.user_id}</td>
              <td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.message_preview ?? <span className="text-muted">—</span>}
              </td>
              <td style={{ textAlign: 'center' }}>{entry.chunks_retrieved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Main Page ----------
export default function TenantDetailPage() {
  const params = useParams()
  const rawId = params.id as string
  const tenantId = decodeURIComponent(rawId)

  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('persona')

  const loadTenant = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}`)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setTenant(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { loadTenant() }, [loadTenant])

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1>Tenant Detail</h1>
        </div>
        <p className="text-muted">Loading…</p>
      </div>
    )
  }

  if (error || !tenant) {
    return (
      <div>
        <div className="page-header">
          <Link href="/tenants" style={{ fontSize: 13, color: '#666' }}>← Back to Tenants</Link>
          <h1>Tenant Detail</h1>
        </div>
        <div className="notice notice-error">{error ?? 'Tenant not found.'}</div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'persona', label: 'Persona' },
    { id: 'knowledge', label: 'Knowledge Base' },
    { id: 'guardrails', label: 'Guardrails' },
    { id: 'metadata', label: 'Metadata' },
    { id: 'activity', label: 'Activity' },
  ]

  return (
    <div>
      <div className="page-header">
        <div style={{ marginBottom: 6 }}>
          <Link href="/tenants" style={{ fontSize: 13, color: '#666' }}>← Back to Tenants</Link>
        </div>
        <div className="flex-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ fontSize: 20 }}>
            {tenant.display_name ?? (
              <span className="text-mono" style={{ fontSize: 16 }}>{tenantId}</span>
            )}
          </h1>
          <span className={`badge badge-${tenant.type}`}>{tenant.type}</span>
          <span className={`badge ${tenant.is_active ? 'badge-active' : 'badge-inactive'}`}>
            {tenant.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <p style={{ marginTop: 4, color: '#888', fontFamily: 'monospace', fontSize: 12 }}>
          ID: {tenantId}
        </p>
      </div>

      <div className="card">
        <div className="tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'persona' && (
          <PersonaTab tenant={tenant} onUpdate={setTenant} />
        )}
        {activeTab === 'knowledge' && (
          <KnowledgeTab tenantId={tenantId} />
        )}
        {activeTab === 'guardrails' && (
          <GuardrailsTab tenant={tenant} />
        )}
        {activeTab === 'metadata' && (
          <MetadataTab tenant={tenant} />
        )}
        {activeTab === 'activity' && (
          <ActivityTab tenantId={tenantId} />
        )}
      </div>
    </div>
  )
}
