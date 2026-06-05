import { query } from './db.ts';
import { embed } from './embeddings.ts';

const CHUNK_TARGET = 500;
const CHUNK_MIN = 100;

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > CHUNK_TARGET) {
    // Find the last sentence boundary within the target window
    const window = remaining.slice(0, CHUNK_TARGET + 100);
    const match = window.slice(0, CHUNK_TARGET).match(/[.!?](\s|$)/g);

    let cutAt: number;
    if (match) {
      // Find the position of the last sentence-ending character within the target
      let lastBoundary = -1;
      const re = /[.!?](\s|$)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(window.slice(0, CHUNK_TARGET))) !== null) {
        lastBoundary = m.index + 1; // position after the punctuation
      }
      cutAt = lastBoundary > CHUNK_MIN ? lastBoundary : CHUNK_TARGET;
    } else {
      cutAt = CHUNK_TARGET;
    }

    const chunk = remaining.slice(0, cutAt).trim();
    if (chunk.length >= CHUNK_MIN) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(cutAt).trim();
  }

  if (remaining.length >= CHUNK_MIN) {
    chunks.push(remaining);
  } else if (remaining.length > 0 && chunks.length > 0) {
    // Merge tiny tail into last chunk rather than drop it
    chunks[chunks.length - 1] += ' ' + remaining;
  }

  return chunks;
}

export async function ingestDocument(
  tenantId: string,
  documentId: string,
  content: string,
): Promise<void> {
  const chunks = chunkText(content);

  await query('DELETE FROM kb_chunks WHERE document_id = $1', [documentId]);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embed(chunks[i]);
    await query(
      `INSERT INTO kb_chunks (document_id, tenant_id, chunk_text, embedding, chunk_index)
       VALUES ($1, $2, $3, $4::vector, $5)`,
      [documentId, tenantId, chunks[i], JSON.stringify(embedding), i],
    );
  }
}

export async function retrieveChunks(
  tenantId: string,
  queryEmbedding: number[],
  topK: number = 5,
): Promise<string[]> {
  const result = await query(
    `SELECT chunk_text
     FROM kb_chunks
     WHERE tenant_id = $1
       AND (embedding <=> $2::vector) < 0.5
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [tenantId, JSON.stringify(queryEmbedding), topK],
  );

  return result.rows.map((r: { chunk_text: string }) => r.chunk_text);
}
