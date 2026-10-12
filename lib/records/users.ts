import { desc, eq, sql } from "drizzle-orm";

import { database, databaseConfigured } from "@/db/client";
import { collectors, users } from "@/db/schema";

import type { AuthUser } from "@/lib/auth/token";
import type { RecordsResult } from "@/lib/types";

/**
 * `users.cognito_sub` — the join between a verified token and a row.
 *
 * Every column that attributes something to a person is a foreign key into this table:
 * `media_assets.uploader_user_id`, `gatekeeper_verdicts.reviewed_by_user_id`,
 * `validation_decisions.decided_by_user_id`. Until this file existed none of them could
 * resolve, because nothing in the request path ever created a row — `db/README.md` lists
 * it as the first table with no writer, and the reason it is first is that attribution
 * waits on it. A decision whose decider is unknown is stored as unknown rather than
 * attributed to whoever held the session, which is why those columns are nullable.
 *
 * Two functions, and the difference between them is the whole design:
 *
 * - `provisionUser` writes the row, once, at sign-in. `full_name` is `NOT NULL`, and the
 *   name is taken off the verified token rather than invented: an account with no name
 *   claim and no email gets no row, because "Unnamed account" in a compliance record is
 *   worse than a null foreign key.
 * - `resolveUserId` only reads. It never creates a row, so a request that merely happens
 *   to be signed in cannot provision an identity — and it returns null rather than
 *   throwing, because attribution being absent is a supported state on these tables.
 */

export interface ProvisionedUser {
  id: string;
  /** True when this call created the row; false when the account already had one. */
  created: boolean;
}

/**
 * The best name available for a person, or null.
 *
 * Cognito's `name` attribute is what the operator sees on screen. Falling back to the
 * local part of a verified email is a real reduction of an address that Cognito has
 * already proved belongs to this account, not a fabricated name — and it is used only
 * for display. Anything less than that gets no row.
 */
function nameFor(user: AuthUser): string | null {
  const named = user.name?.trim();
  if (named) return named.slice(0, 200);
  const local = user.email?.split("@")[0]?.trim();
  if (local) return local.slice(0, 200);
  return null;
}

/**
 * Create the user row for a signed-in account, if one does not exist yet.
 *
 * Idempotent on `users_cognito_sub_uq`, so it is safe on every sign-in and cheap enough
 * to be called from the one place that already holds a freshly verified token. Never
 * throws: a database that is off, or a write that fails, must not turn a successful
 * sign-in into a failure — the operator would be locked out of a system that works.
 */
export async function provisionUser(user: AuthUser): Promise<ProvisionedUser | null> {
  if (!databaseConfigured()) return null;
  const connection = database();
  if (!connection) return null;

  const fullName = nameFor(user);
  if (!fullName || !user.sub) return null;

  try {
    const inserted = await connection.db
      .insert(users)
      .values({
        cognitoSub: user.sub,
        email: user.email?.toLowerCase() ?? null,
        emailVerified: true,
        fullName,
        // Active, because the token that got here was verified against the pool — this
        // row is a mirror of an identity that already exists, not an invitation.
        status: "active",
        lastSeenAt: new Date(),
      })
      .onConflictDoNothing({ target: users.cognitoSub })
      .returning({ id: users.id });

    const created = inserted[0]?.id ?? null;
    if (created) {
      if (user.role === "eco-collector") await ensureCollectorRecord(created, user.sub, fullName);
      return { id: created, created: true };
    }

    // `DO NOTHING` returns nothing when the row was already there, so the id comes back
    // from a read of the same unique index. That read is also what keeps this a mirror:
    // `last_seen_at` is refreshed, and nothing else about the person is overwritten by a
    // login.
    await connection.db
      .update(users)
      .set({ lastSeenAt: new Date() })
      .where(eq(users.cognitoSub, user.sub));

    const [existing] = await connection.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.cognitoSub, user.sub))
      .limit(1);

    if (existing && user.role === "eco-collector") {
      await ensureCollectorRecord(existing.id, user.sub, fullName);
    }
    return existing ? { id: existing.id, created: false } : null;
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = (cause ?? (error instanceof Error ? error.message : String(error)))
      .replace(/\s+/g, " ")
      .trim();
    console.error("[db] provisioning the signed-in user failed", message);
    return null;
  }
}

/** The row id behind a Cognito subject, or null when no row exists. Read-only. */
export async function resolveUserId(cognitoSub: string): Promise<string | null> {
  if (!databaseConfigured()) return null;
  const connection = database();
  if (!connection) return null;
  try {
    const [row] = await connection.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.cognitoSub, cognitoSub))
      .limit(1);
    return row?.id ?? null;
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = (cause ?? (error instanceof Error ? error.message : String(error)))
      .replace(/\s+/g, " ")
      .trim();
    console.error("[db] resolving a user failed", message);
    return null;
  }
}

/** One account as the team list shows it. */
export interface Member {
  name: string;
  email: string | null;
  status: string;
  /** ISO time of the last sign-in, or null for an account that never signed in. */
  lastSeenAt: string | null;
}

/**
 * Everyone with a `users` row, most recently seen first.
 *
 * The table is a mirror of the Cognito pool written at sign-in (`provisionUser`), so this
 * lists the people who have actually used the app. Roles are not here: they are Cognito
 * groups, carried on each person's token, and the database never stores a copy that
 * could fall out of step with the pool.
 */
export async function listMembers(limit = 200): Promise<RecordsResult<Member>> {
  if (!databaseConfigured()) return { configured: false, error: null, rows: [] };
  const connection = database();
  if (!connection) return { configured: false, error: null, rows: [] };

  try {
    const rows = await connection.db
      .select({
        name: users.fullName,
        email: users.email,
        status: users.status,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .orderBy(sql`${users.lastSeenAt} desc nulls last`, desc(users.fullName))
      .limit(limit);
    return {
      configured: true,
      error: null,
      rows: rows.map((row) => ({
        name: row.name,
        email: row.email,
        status: row.status,
        lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
      })),
    };
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = (cause ?? (error instanceof Error ? error.message : String(error)))
      .replace(/\s+/g, " ")
      .trim();
    console.error("[db] listing members failed", message);
    return { configured: true, error: message.slice(0, 200), rows: [] };
  }
}

/**
 * The collector record behind a Collector's account, created at their first sign-in.
 *
 * `collectors` is the person an Operator captures on behalf of; `collectors.user_id` is
 * what lets that person sign in and see their own submissions. The code is derived from
 * the Cognito subject, so it is stable across sign-ins and needs no counter. Idempotent on
 * `collectors_user_uq`, and never throws: a failed write leaves the account signed in and
 * unlinked, which the Collector's screens already explain.
 */
async function ensureCollectorRecord(userId: string, sub: string, fullName: string): Promise<void> {
  const connection = database();
  if (!connection) return;
  try {
    await connection.db
      .insert(collectors)
      .values({
        code: `KAB-${sub.replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase()}`,
        userId,
        fullName,
      })
      .onConflictDoNothing();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[db] creating the collector record failed", message.replace(/\s+/g, " ").slice(0, 200));
  }
}

/** A collector an Operator can capture on behalf of. */
export interface CollectorOption {
  id: string;
  code: string;
  fullName: string;
}

/** Every collector on file, for the intake screen's picker. Empty, not thrown, on failure. */
export async function listCollectorOptions(): Promise<CollectorOption[]> {
  if (!databaseConfigured()) return [];
  const connection = database();
  if (!connection) return [];
  try {
    return await connection.db
      .select({ id: collectors.id, code: collectors.code, fullName: collectors.fullName })
      .from(collectors)
      .orderBy(collectors.fullName)
      .limit(500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[db] listing the collectors failed", message.replace(/\s+/g, " ").slice(0, 200));
    return [];
  }
}

/** Whether a `collectors.id` exists, so a submission is never tied to an invented one. */
export async function collectorExists(id: string): Promise<boolean> {
  const connection = databaseConfigured() ? database() : null;
  if (!connection) return false;
  try {
    const [row] = await connection.db
      .select({ id: collectors.id })
      .from(collectors)
      .where(eq(collectors.id, id))
      .limit(1);
    return Boolean(row);
  } catch {
    return false;
  }
}
