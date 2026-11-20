// This file is kept for backward compatibility during migration.
// All database access now goes through server/db/pool.ts (PostgreSQL).
export { pool, query, getClient, testConnection } from './db/pool.js';
