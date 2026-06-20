import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Drizzle ORM client backed by postgres-js.
 *
 * Uses the direct DATABASE_URL connection (port 5432) rather than the Supabase
 * connection pooler. The pooler is fine for serverless reads but breaks
 * Drizzle's prepared statements. For Vercel deployments at scale, switch to
 * the pgBouncer-compatible URL with `prepare: false` in the postgres-js config.
 *
 * This client is server-only. Never import it from a Client Component.
 */
const connectionString = process.env.DATABASE_URL!;

if (!connectionString) {
  throw new Error('Missing DATABASE_URL environment variable');
}

const client = postgres(connectionString, {
  prepare: false,
  max: 5,
});

export const db = drizzle(client, { schema });
export type Database = typeof db;
