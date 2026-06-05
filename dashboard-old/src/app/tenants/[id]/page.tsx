'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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

function Notice({
  type,
  children,
}: {
  type: 'success' | 'error' | 'info'
  children: React.ReactNode
}) {
  const styles = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  }
  return (
    <div className={`rounded border px-3 py-2 text-sm mt-3 ${styles[type]}`}>{children}</div>
  )
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
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="persona-name">Display Name</Label>
        <Input
          id="persona-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Friendly name for this tenant"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="persona-prompt">System Prompt</Label>
        <Textarea
          id="persona-prompt"
          className="min-h-[200px] font-mono text-sm"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Enter the system prompt for this tenant's AI persona…"
        />
      </div>
      <div className="flex items-center gap-3">
        <Switch
          id="persona-active"
          checked={isActive}
          onCheckedChange={(v) => setIsActive(v)}
        />
        <Label htmlFor="persona-active" className="cursor-pointer">
          Active (bot responds to messages from this tenant)
        </Label>
      </div>
      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Persona'}
      </Button>
      {notice && <Notice type={notice.type}>{notice.msg}</Notice>}
    </div>
  )
}

// ---------- Knowledge Base Tab ----------
function KnowledgeTab({ tenantId }: { tenantId: string }) {
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [fileType, setFileType] = useState('text')
  const [adding, setAdding] = useState(false)
  const [addNotice, setAddNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(
    null
  )

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

  useEffect(() => {
    loadDocs()
  }, [loadDocs])

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
      setAddNotice({
        type: 'success',
        msg: 'Document added.',
      })
    } catch (err) {
      setAddNotice({ type: 'error', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-6">
      {loading && <p className="text-muted-foreground text-sm">Loading documents…</p>}
      {error && <Notice type="error">Error: {error}</Notice>}
      {!loading && !error && (
        <>
          {docs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No documents yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>File Type</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      {doc.title ?? (
                        <span className="text-muted-foreground">{doc.file_name ?? '—'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {doc.file_type ? (
                        <Badge variant="outline">{doc.file_type}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{doc.chunk_count}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(doc.created_at)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteDoc(doc)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground">
            After saving a document, embeddings are generated the next time a message arrives from
            this tenant.
          </p>
        </>
      )}

      <Separator />

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Add Document</h3>
        <form onSubmit={handleAddDoc} className="space-y-3">
          <div className="flex gap-3 items-end">
            <div className="flex-[3] space-y-1.5">
              <Label htmlFor="doc-title">Title *</Label>
              <Input
                id="doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Document title"
              />
            </div>
            <div className="flex-1 min-w-[120px] space-y-1.5">
              <Label htmlFor="doc-type">File Type</Label>
              <Select value={fileType} onValueChange={(v) => v && setFileType(v)}>
                <SelectTrigger id="doc-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">text</SelectItem>
                  <SelectItem value="markdown">markdown</SelectItem>
                  <SelectItem value="pdf">pdf</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-content">Content *</Label>
            <Textarea
              id="doc-content"
              className="min-h-[160px] font-mono text-sm"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste document content here…"
            />
          </div>
          <Button type="submit" disabled={adding}>
            {adding ? 'Saving…' : 'Save Document'}
          </Button>
        </form>
        {addNotice && <Notice type={addNotice.type}>{addNotice.msg}</Notice>}
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
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="guard-topics">Blocked Topics</Label>
        <Textarea
          id="guard-topics"
          placeholder="One topic per line"
          value={blockedTopics}
          onChange={(e) => setBlockedTopics(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="guard-words">Blocked Words</Label>
        <Textarea
          id="guard-words"
          placeholder="One word per line"
          value={blockedWords}
          onChange={(e) => setBlockedWords(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3">
        <Switch
          id="guard-pii"
          checked={piiRedaction}
          onCheckedChange={(v) => setPiiRedaction(v)}
        />
        <Label htmlFor="guard-pii" className="cursor-pointer">
          Enable PII Redaction
        </Label>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="guard-custom">Custom Instructions</Label>
        <Textarea
          id="guard-custom"
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder="Additional guardrail instructions for this tenant…"
        />
      </div>
      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Guardrails'}
      </Button>
      {notice && <Notice type={notice.type}>{notice.msg}</Notice>}
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
    <div className="space-y-4">
      {pairs.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Remove</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pairs.map((p) => (
              <TableRow key={p.key}>
                <TableCell className="font-mono text-sm w-[35%]">{p.key}</TableCell>
                <TableCell>
                  <Input
                    value={p.value}
                    onChange={(e) => updateValue(p.key, e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <Button variant="destructive" size="sm" onClick={() => deleteRow(p.key)}>
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground text-sm">No metadata yet.</p>
      )}

      <Separator />

      <div className="flex gap-3 items-end">
        <div className="flex-[2] space-y-1.5">
          <Label htmlFor="meta-key">Key</Label>
          <Input
            id="meta-key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="key"
            onKeyDown={(e) => e.key === 'Enter' && addRow()}
          />
        </div>
        <div className="flex-[3] space-y-1.5">
          <Label htmlFor="meta-value">Value</Label>
          <Input
            id="meta-value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="value"
            onKeyDown={(e) => e.key === 'Enter' && addRow()}
          />
        </div>
        <div className="flex-none">
          <Button variant="outline" onClick={addRow}>
            Add Row
          </Button>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save All Metadata'}
      </Button>
      {notice && <Notice type={notice.type}>{notice.msg}</Notice>}
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

  if (loading) return <p className="text-muted-foreground text-sm">Loading activity…</p>
  if (error) return <Notice type="error">Error: {error}</Notice>
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity recorded for this tenant yet.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Timestamp</TableHead>
          <TableHead>User ID</TableHead>
          <TableHead>Message Preview</TableHead>
          <TableHead>Chunks Retrieved</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="font-mono text-xs whitespace-nowrap">
              {formatDate(entry.created_at)}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {entry.user_id}
            </TableCell>
            <TableCell className="max-w-sm truncate text-sm">
              {entry.message_preview ?? <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="text-center">{entry.chunks_retrieved}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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

  useEffect(() => {
    loadTenant()
  }, [loadTenant])

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Tenant Detail</h1>
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    )
  }

  if (error || !tenant) {
    return (
      <div className="p-6">
        <div className="mb-4">
          <Link href="/tenants" className="text-sm text-muted-foreground hover:underline">
            ← Back to Tenants
          </Link>
        </div>
        <h1 className="text-2xl font-bold mb-4">Tenant Detail</h1>
        <Notice type="error">{error ?? 'Tenant not found.'}</Notice>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link href="/tenants" className="text-sm text-muted-foreground hover:underline">
          ← Back to Tenants
        </Link>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-1">
        <h1 className="text-xl font-bold">
          {tenant.display_name ?? (
            <span className="font-mono text-base">{tenantId}</span>
          )}
        </h1>
        <Badge
          variant="outline"
          className={
            tenant.type === 'group'
              ? 'border-blue-300 text-blue-700 bg-blue-50'
              : 'border-green-300 text-green-700 bg-green-50'
          }
        >
          {tenant.type}
        </Badge>
        <Badge
          variant="outline"
          className={
            tenant.is_active
              ? 'border-green-300 text-green-700 bg-green-50'
              : 'border-red-300 text-red-700 bg-red-50'
          }
        >
          {tenant.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground font-mono mb-6">ID: {tenantId}</p>

      <Card>
        <CardContent className="pt-4">
          <Tabs defaultValue="persona">
            <TabsList className="mb-4">
              <TabsTrigger value="persona">Persona</TabsTrigger>
              <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
              <TabsTrigger value="guardrails">Guardrails</TabsTrigger>
              <TabsTrigger value="metadata">Metadata</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="persona">
              <PersonaTab tenant={tenant} onUpdate={setTenant} />
            </TabsContent>
            <TabsContent value="knowledge">
              <KnowledgeTab tenantId={tenantId} />
            </TabsContent>
            <TabsContent value="guardrails">
              <GuardrailsTab tenant={tenant} />
            </TabsContent>
            <TabsContent value="metadata">
              <MetadataTab tenant={tenant} />
            </TabsContent>
            <TabsContent value="activity">
              <ActivityTab tenantId={tenantId} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
