import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * The database connection — and the fact that there may not be one.
 *
 * The schema has been applied to RDS for a while (`npm run db:migrate`), but until
 * the media archive there was nothing in the app that *queried* it: the screens read
 * the fixtures in `lib/data`. This is the first runtime connection, so it is written
 * to be the shape the rest of the wiring should copy.
 *
 * Three decisions, all of them borrowed from `lib/s3/archive.ts` because the two
 * integrations face the same reality:
 *
 * 1. **No `DATABASE_URL` is not an error.** `database()` returns `null`, the caller
 *    reports `configured: false`, and the request still succeeds. That is what lets a
 *    laptop, a CI box or a deployment without the variable keep working — a missing
 *    connection string must never turn into a failed analysis.
 *
 * 2. **The pool is cached on `globalThis`.** Next.js reloads modules on every edit in
 *    development and reuses a container between requests in a deployment; a fresh
 *    `Pool` per module instance would leak a connection per reload until Postgres
 *    refuses all of them.
 *
 * 3. **Waiting has a ceiling, on both halves of the wait.** Amplify Hosting cuts a
 *    server-rendered request off at around thirty seconds, and the model call already
 *    spends up to 26 of them. A connection attempt that hangs on a dead host, or a query
 *    that stalls on a server which accepted the connection and then stopped answering,
 *    would spend the rest — so `connectionTimeoutMillis` and `statement_timeout` below
 *    turn both into a reported failure in seconds instead of a bare 504.
 *
 * This module is also imported by `npm run s3:check`, which runs under plain Node — see
 * `scripts/ts-paths.mjs` for how a bare Node process resolves `./schema` and `@/db/*`.
 *
 * TLS is not configured here on purpose: it comes from the URL, which carries
 * `sslmode=no-verify` because RDS has `rds.force_ssl=1` and refuses an unencrypted
 * connection outright, while RDS's own certificate chain does not verify against the
 * public roots. `pg` reads both facts from the string. Moving to `sslmode=verify-full`
 * with the RDS CA bundle is a real improvement and a separate job — see `db/README.md`.
 */

/** The connection string in force, or `null` when the database is switched off. */
export function databaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function databaseConfigured(): boolean {
  return databaseUrl() !== null;
}

/**
 * A pool per URL, so a process that somehow sees two values cannot quietly share one
 * pool's TLS settings between them. The key is the URL itself; unlike a credential it
 * is not sensitive on its own, and it is already in the process environment.
 */
const cache = globalThis as unknown as {
  __ecoeprPgPools?: Map<string, { db: NodePgDatabase<typeof schema>; pool: Pool }>;
};

/**
 * The client, or `null` when no `DATABASE_URL` is set.
 *
 * Returned as a pair rather than a bare Drizzle instance because a script that opens
 * a pool has to close it or the process never exits — `scripts/s3-check.mts` needs
 * exactly that.
 */
export function database(): { db: NodePgDatabase<typeof schema>; pool: Pool } | null {
  const url = databaseUrl();
  if (!url) return null;

  cache.__ecoeprPgPools ??= new Map();
  const existing = cache.__ecoeprPgPools.get(url);
  if (existing) return existing;

  const pool = new Pool({
    connectionString: url,
    // Small on purpose. Serverless-ish compute scales by adding instances rather than
    // by widening a pool, and this app's writes are a handful of rows per request.
    max: 5,
    idleTimeoutMillis: 30_000,
    // Reaching the server, and then waiting on it, are two different ways to hang, and
    // both have to be bounded for the deadline on the request to mean anything. The
    // archive does the same thing with its 8s PUT: a dependency that never answers must
    // become a reported failure in seconds, not a 504 the operator cannot read.
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });

  // A pool that emits `error` with no listener takes the whole process down. This is
  // a connection dying between requests — an idle timeout on the server, a failover —
  // and the next query simply opens a new one, so it is logged and survived.
  pool.on("error", (error) => {
    console.error("[db] idle client error", error.message);
  });

  const entry = { db: drizzle(pool, { schema }), pool };
  cache.__ecoeprPgPools.set(url, entry);
  return entry;
}

/**
 * Close every pool this process opened. For scripts and for a clean shutdown — a
 * request path must never call it, because the pool is meant to outlive the request.
 */
export async function closeDatabase(): Promise<void> {
  const pools = cache.__ecoeprPgPools;
  if (!pools) return;
  const closing = [...pools.values()];
  cache.__ecoeprPgPools = undefined;
  await Promise.all(closing.map(({ pool }) => pool.end().catch(() => undefined)));
}
