import pg from 'pg';

const { Pool } = pg;

export type DbPool = pg.Pool;

export function createDbPool(connectionString: string): pg.Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export async function checkDatabaseHealth(pool: pg.Pool): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1;');
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

export async function closeDbPool(pool: pg.Pool): Promise<void> {
  await pool.end();
}
