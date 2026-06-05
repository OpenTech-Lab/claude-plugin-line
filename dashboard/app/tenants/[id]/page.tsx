'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  UploadCloud,
  Globe,
  FileText,
  File,
  FileType2,
  Plus,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
  allowed_paths?: string[] | null
  blocked_paths?: string[] | null
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

// ---------- Source type helpers ----------
type SourceMode = 'upload' | 'website' | 'text'

const SOURCE_TYPES: { id: SourceMode; Icon: React.FC<{ className?: string }>; label: string; desc: string }[] = [
  { id: 'upload', Icon: UploadCloud, label: 'Upload file',  desc: 'PDF, TXT, Markdown' },
  { id: 'website', Icon: Globe,       label: 'Website',      desc: 'Import from a URL'  },
  { id: 'text',    Icon: FileText,    label: 'Paste text',   desc: 'Copy & paste content' },
]

function sourceIcon(fileType: string | null) {
  if (fileType === 'pdf')     return <FileType2 className="size-4 text-red-500" />
  if (fileType === 'website') return <Globe className="size-4 text-blue-500" />
  if (fileType === 'markdown') return <File className="size-4 text-purple-500" />
  return <FileText className="size-4 text-slate-400" />
}

// ---------- Add Source Dialog ----------
function AddSourceDialog({
  tenantId,
  onAdded,
}: {
  tenantId: string
  onAdded: (doc: Document) => void
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<SourceMode | null>(null)

  // upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  // website state
  const [url, setUrl] = useState('')
  const [websiteTitle, setWebsiteTitle] = useState('')

  // text state
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setMode(null)
    setUploadFile(null)
    setUploadTitle('')
    setUrl('')
    setWebsiteTitle('')
    setTextTitle('')
    setTextContent('')
    setError(null)
    setSubmitting(false)
  }

  function handleFileSelect(file: File) {
    setUploadFile(file)
    setUploadTitle(file.name.replace(/\.[^.]+$/, ''))
  }

  async function handleSubmit() {
    setError(null)
    setSubmitting(true)
    try {
      let res: Response

      if (mode === 'upload') {
        if (!uploadFile) { setError('Please select a file.'); return }
        const form = new FormData()
        form.append('file', uploadFile)
        form.append('title', uploadTitle.trim() || uploadFile.name.replace(/\.[^.]+$/, ''))
        res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/documents`, {
          method: 'POST',
          body: form,
        })
      } else if (mode === 'website') {
        if (!url.trim()) { setError('Please enter a URL.'); return }
        res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_type: 'website', url: url.trim(), title: websiteTitle.trim() || undefined }),
        })
      } else {
        if (!textTitle.trim() || !textContent.trim()) { setError('Title and content are required.'); return }
        res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_type: 'text', title: textTitle.trim(), content: textContent.trim(), file_type: 'text' }),
        })
      }

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      onAdded(data)
      setOpen(false)
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" /> Add source
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add source</DialogTitle>
        </DialogHeader>

        {/* Source type picker */}
        <div className="grid grid-cols-3 gap-2 mt-1">
          {SOURCE_TYPES.map(({ id, Icon, label, desc }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setMode(id); setError(null) }}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg border p-4 text-center transition-colors hover:bg-accent',
                mode === id ? 'border-primary bg-accent' : 'border-border'
              )}
            >
              <Icon className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground leading-tight">{desc}</span>
            </button>
          ))}
        </div>

        {/* Contextual form */}
        {mode === 'upload' && (
          <div className="space-y-3 mt-2">
            <div
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors',
                isDragging ? 'border-primary bg-accent' : 'border-border hover:border-muted-foreground'
              )}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault(); setIsDragging(false)
                const f = e.dataTransfer.files[0]
                if (f) handleFileSelect(f)
              }}
            >
              <UploadCloud className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                {uploadFile
                  ? <><span className="font-medium text-foreground">{uploadFile.name}</span><br />{(uploadFile.size / 1024).toFixed(0)} KB</>
                  : <><span className="font-medium">Click to browse</span> or drag & drop<br />PDF, TXT, Markdown</>
                }
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.markdown,text/plain,text/markdown,application/pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f) }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Title (optional)</Label>
              <Input
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="Auto-filled from filename"
              />
            </div>
          </div>
        )}

        {mode === 'website' && (
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label>URL *</Label>
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Title (optional)</Label>
              <Input
                value={websiteTitle}
                onChange={(e) => setWebsiteTitle(e.target.value)}
                placeholder="Auto-filled from page title"
              />
            </div>
          </div>
        )}

        {mode === 'text' && (
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                placeholder="Source title"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Content *</Label>
              <Textarea
                className="min-h-[140px] font-mono text-sm"
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Paste your content here…"
              />
            </div>
          </div>
        )}

        {error && <Notice type="error">{error}</Notice>}

        {mode && (
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => { setOpen(false); reset() }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? (mode === 'website' ? 'Importing…' : 'Adding…')
                : (mode === 'website' ? 'Import' : 'Add source')
              }
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------- Knowledge Base Tab ----------
function KnowledgeTab({ tenantId }: { tenantId: string }) {
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    if (!confirm(`Delete "${doc.title ?? doc.file_name ?? doc.id}"?`)) return
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">
            Sources {!loading && docs.length > 0 && <span className="text-muted-foreground font-normal">({docs.length})</span>}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Embeddings are generated on next message from this tenant.
          </p>
        </div>
        <AddSourceDialog tenantId={tenantId} onAdded={(doc) => setDocs((prev) => [doc, ...prev])} />
      </div>

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {error && <Notice type="error">{error}</Notice>}

      {!loading && !error && docs.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <FileText className="size-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">No sources yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Add PDFs, websites, or text to build the knowledge base</p>
          </div>
        </div>
      )}

      {!loading && !error && docs.length > 0 && (
        <div className="divide-y rounded-lg border">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
              <div className="shrink-0">{sourceIcon(doc.file_type)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{doc.title ?? doc.file_name ?? '—'}</p>
                {doc.file_type === 'website' && doc.file_name && (
                  <p className="text-xs text-muted-foreground truncate">{doc.file_name}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {doc.chunk_count} chunk{doc.chunk_count !== 1 ? 's' : ''} · {formatDate(doc.created_at)}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0 text-xs">
                {doc.file_type ?? 'text'}
              </Badge>
              <button
                onClick={() => deleteDoc(doc)}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                title="Delete source"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
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
  const [allowedPaths, setAllowedPaths] = useState(arrToText(g.allowed_paths))
  const [blockedPaths, setBlockedPaths] = useState(arrToText(g.blocked_paths))
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
          allowed_paths: textToArr(allowedPaths).length ? textToArr(allowedPaths) : null,
          blocked_paths: textToArr(blockedPaths).length ? textToArr(blockedPaths) : null,
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
    <div className="space-y-5">
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

      <Separator />

      <div className="space-y-1">
        <p className="text-sm font-semibold">Path Access Control</p>
        <p className="text-xs text-muted-foreground">
          Restrict which filesystem paths the agent may access when responding to this tenant.
          One absolute path per line. If <strong>Allowed paths</strong> is set, the agent will only
          access paths within that list. <strong>Blocked paths</strong> are always denied regardless of allowed list.
          Enforcement is instruction-based — the agent reads and follows these rules from context.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="guard-allowed-paths">Allowed Paths</Label>
          <Textarea
            id="guard-allowed-paths"
            className="font-mono text-xs min-h-[120px]"
            placeholder={'/home/user/projects/myapp\n/home/user/docs'}
            value={allowedPaths}
            onChange={(e) => setAllowedPaths(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guard-blocked-paths">Blocked Paths</Label>
          <Textarea
            id="guard-blocked-paths"
            className="font-mono text-xs min-h-[120px]"
            placeholder={'/etc\n/home/user/.ssh\n/var/secrets'}
            value={blockedPaths}
            onChange={(e) => setBlockedPaths(e.target.value)}
          />
        </div>
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
