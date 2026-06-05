import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://linebot:linebot@localhost:5433/linebot',
})

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params)
}
