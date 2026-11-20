import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required. Set it in your hosting environment or .env file.');
}

// Neon requires TLS. Keep certificate verification enabled by default.
// Set PGSSL_REJECT_UNAUTHORIZED=false only for a temporary, explicitly understood
// development workaround; do not disable verification in production.
const requiresTls =
  process.env.NODE_ENV === 'production' ||
  /neon\.tech/i.test(connectionString) ||
  /sslmode=require/i.test(connectionString);

const rejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false';

export const pool = new Pool({
  connectionString,
  ...(requiresTls ? { ssl: { rejectUnauthorized } } : {}),
  // Keep the pool modest for serverless/managed Postgres connection limits.
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: false,
});

pool.on('error', (err) => {
  console.error('[StockMind] Unexpected PostgreSQL pool error:', err.message);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (duration > 2_000) {
      console.warn(`[StockMind] Slow query (${duration}ms):`, text.slice(0, 120));
    }
    return result;
  } catch (err) {
    console.error('[StockMind] Query error:', (err as Error).message, '\\nSQL:', text.slice(0, 200));
    throw err;
  }
}

export async function getClient(): Promise<pg.PoolClient> {
  return pool.connect();
}

export async function testConnection(): Promise<void> {
  const result = await query<{ now: string }>('SELECT NOW() as now');
  console.log(`[StockMind] PostgreSQL connected. Server time: ${result.rows[0].now}`);
}
