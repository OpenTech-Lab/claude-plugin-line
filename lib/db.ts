import pkg from 'pg';
const { Pool } = pkg;

// Same default as line_claude_bridge.py — throwing here would crash the MCP
// channel server at import time in sessions where DATABASE_URL isn't set.
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://linebot:linebot@localhost:5433/linebot';

const pool = new Pool({
  connectionString: DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('[db] pool error:', err.message);
});

async function query(text: string, params?: unknown[]) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error('[db] query error:', (err as Error).message, '| sql:', text.slice(0, 120));
    throw err;
  }
}

export { pool, query };
