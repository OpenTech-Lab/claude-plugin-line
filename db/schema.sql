CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('group', 'user')),
  display_name  TEXT,
  system_prompt TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  title       TEXT,
  content     TEXT NOT NULL,
  file_name   TEXT,
  file_type   TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID REFERENCES kb_documents(id) ON DELETE CASCADE,
  tenant_id    TEXT NOT NULL,
  chunk_text   TEXT NOT NULL,
  embedding    VECTOR(1024),
  chunk_index  INT NOT NULL
);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx ON kb_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS tenant_guardrails (
  tenant_id            TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  allowed_topics       TEXT[],
  blocked_topics       TEXT[],
  blocked_words        TEXT[],
  pii_redaction        BOOLEAN DEFAULT false,
  custom_instructions  TEXT
);

CREATE TABLE IF NOT EXISTS tenant_metadata (
  tenant_id  TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT,
  user_id          TEXT,
  message_preview  TEXT,
  chunks_retrieved INT DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_tenants (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('group', 'user')),
  detected_at  TIMESTAMPTZ DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'denied'))
);
