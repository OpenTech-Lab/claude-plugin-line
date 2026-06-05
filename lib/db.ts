import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://linebot:linebot@localhost:5433/linebot',
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
