import { eq } from "drizzle-orm";

import { database, databaseConfigured } from "@/db/client";
import { users } from "@/db/schema";

import type { AuthUser } from "@/lib/auth/token";

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
    if (created) return { id: created, created: true };

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
