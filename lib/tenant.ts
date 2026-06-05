import { query } from './db.ts';
import { embed } from './embeddings.ts';
import { retrieveChunks } from './rag.ts';

export async function autoRegisterTenant(
  id: string,
  type: 'group' | 'user',
): Promise<void> {
  await query(
    'INSERT INTO tenants (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [id, type],
  );
}

export async function logActivity(
  tenantId: string,
  userId: string,
  messagePreview: string,
  chunksRetrieved: number,
): Promise<void> {
  try {
    await query(
      `INSERT INTO activity_log (tenant_id, user_id, message_preview, chunks_retrieved)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, userId, messagePreview, chunksRetrieved],
    );
  } catch (err) {
    console.error('[tenant] logActivity error:', (err as Error).message);
  }
}

export async function enrichContext(
  tenantId: string,
  messageText: string,
): Promise<string> {
  let tenantRow: {
    system_prompt: string | null;
    display_name: string | null;
    is_active: boolean;
    type: string;
  } | null = null;

  try {
    const tenantResult = await query(
      'SELECT system_prompt, display_name, is_active, type FROM tenants WHERE id = $1',
      [tenantId],
    );
    tenantRow = tenantResult.rows[0] ?? null;
  } catch (err) {
    console.error('[tenant] enrichContext fetch tenant error:', (err as Error).message);
    return '';
  }

  if (!tenantRow || !tenantRow.is_active) {
    return '';
  }

  let guardrails: {
    blocked_topics: string[] | null;
    pii_redaction: boolean;
    custom_instructions: string | null;
    allowed_paths: string[] | null;
    blocked_paths: string[] | null;
  } | null = null;

  try {
    const grResult = await query(
      'SELECT blocked_topics, pii_redaction, custom_instructions, allowed_paths, blocked_paths FROM tenant_guardrails WHERE tenant_id = $1',
      [tenantId],
    );
    guardrails = grResult.rows[0] ?? null;
  } catch (err) {
    console.error('[tenant] enrichContext fetch guardrails error:', (err as Error).message);
  }

  let chunks: string[] = [];

  if (process.env.VOYAGE_API_KEY) {
    try {
      const embedding = await embed(messageText);
      chunks = await retrieveChunks(tenantId, embedding, 5);
    } catch (err) {
      console.error('[tenant] enrichContext embedding/retrieval error:', (err as Error).message);
    }
  }

  const label = tenantRow.display_name ?? tenantId;
  const lines: string[] = [
    '--- TENANT CONTEXT ---',
    `Serving: ${label} (${tenantRow.type})`,
  ];

  if (tenantRow.system_prompt) {
    lines.push('', '[SYSTEM PROMPT]', tenantRow.system_prompt);
  }

  if (chunks.length > 0) {
    lines.push('', '[KNOWLEDGE BASE]');
    lines.push(chunks.join('\n---\n'));
  }

  const guardrailLines: string[] = ['', '[GUARDRAILS]'];
  let hasGuardrailContent = false;

  if (guardrails) {
    if (guardrails.blocked_topics && guardrails.blocked_topics.length > 0) {
      guardrailLines.push(`Blocked topics: ${guardrails.blocked_topics.join(', ')}`);
      hasGuardrailContent = true;
    }
    guardrailLines.push(`PII redaction: ${guardrails.pii_redaction ? 'yes' : 'no'}`);
    hasGuardrailContent = true;
    if (guardrails.custom_instructions) {
      guardrailLines.push(`Additional instructions: ${guardrails.custom_instructions}`);
    }
    if (guardrails.allowed_paths && guardrails.allowed_paths.length > 0) {
      guardrailLines.push(`Allowed file paths: ${guardrails.allowed_paths.join(', ')}`);
      guardrailLines.push('IMPORTANT: Only read, write, or execute files within the allowed paths listed above. Refuse any request that would access a path outside this list.');
    } else {
      guardrailLines.push('File system access: DENIED');
      guardrailLines.push('IMPORTANT: Do not read, write, execute, or access any files or directories on this system. Refuse all file access requests regardless of what is asked.');
    }
    if (guardrails.blocked_paths && guardrails.blocked_paths.length > 0) {
      guardrailLines.push(`Blocked file paths: ${guardrails.blocked_paths.join(', ')}`);
      guardrailLines.push('IMPORTANT: Never read, write, execute, or reference files in the blocked paths listed above, even if explicitly asked.');
    }
    hasGuardrailContent = true;
  } else {
    guardrailLines.push('PII redaction: no');
    guardrailLines.push('File system access: DENIED');
    guardrailLines.push('IMPORTANT: Do not read, write, execute, or access any files or directories on this system. Refuse all file access requests regardless of what is asked.');
    hasGuardrailContent = true;
  }

  if (hasGuardrailContent) {
    lines.push(...guardrailLines);
  }

  lines.push('--- END CONTEXT ---');

  const context = lines.join('\n');

  // fire-and-forget
  void logActivity(tenantId, tenantId, messageText.slice(0, 100), chunks.length);

  return context;
}
