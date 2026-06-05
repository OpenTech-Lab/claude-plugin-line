const VOYAGE_BASE = 'https://api.voyageai.com/v1';

export async function embed(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY environment variable is not set');
  }

  const response = await fetch(`${VOYAGE_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: [text], model: 'voyage-3-lite' }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Voyage AI error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}
