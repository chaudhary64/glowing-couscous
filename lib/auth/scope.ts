import type { AuthUser } from "./token";

/**
 * The rows a caller is allowed to see, frozen once so no reader invents its own.
 *
 * The guard in `lib/auth/roles.ts` answers "may this role open this screen". It cannot
 * answer "which rows of it": an Officer may open `/recyclers`, but only their own
 * facility's capacity, and a Viewer may open `/evidence`, but only the credits their
 * brand claimed. That second question is a scope, and it has one type so the screens
 * and the read layer never have to negotiate it mid-flight.
 *
 * This is the contract between the two halves of the migration: **every reader gains
 * `scope` as its first parameter** — `listLoads(scope, limit)`, `storedCounts(scope)`,
 * `listEvidence(scope)` — and every caller passes `scopeFor(...)`.
 *
 * Nothing here reads the database. The facility and brand bindings live in
 * `organization_members`, which the read layer owns; `scopeFor` takes them as an
 * argument rather than guessing.
 */

export type Scope =
  /** Admin and Operator: every row. */
  | { kind: "all" }
  /** Collector: the submissions this person made. Keyed by the Cognito `sub`. */
  | { kind: "collector"; userId: string }
  /** Officer: the one facility this person works at. */
  | { kind: "facility"; facilityId: string }
  /** Viewer: the brand whose credits this person audits. */
  | { kind: "brand"; organizationId: string }
  /**
   * The binding the scope needs is not on file yet.
   *
   * This exists so a scope can fail **closed and loudly** instead of widening: a reader
   * handed this returns its own error sentence and the screen renders it, which is a
   * bug report. Falling back to `{ kind: "all" }` would be a data leak that looks like
   * a working page. `scopeRefusal` turns it into that sentence.
   */
  | { kind: "unresolved"; reason: string };

/**
 * The identity bindings a role's scope needs, when they are not on the session.
 *
 * The Cognito token carries the role and the subject, not which recycling facility the
 * person works at or which brand employs them; those are joins, and the read layer
 * resolves them. Omit them and an officer or a viewer gets `unresolved` rather than a
 * wider read.
 */
export type ScopeIdentity = {
  facilityId?: string | null;
  organizationId?: string | null;
};

/**
 * The scope for a signed-in user.
 *
 * A user holding no role gets `unresolved`, not `all`: "not signed in as anyone" and
 * "allowed to see everything" are the two readings that must never be confused.
 */
export function scopeFor(user: AuthUser, identity: ScopeIdentity = {}): Scope {
  switch (user.role) {
    case "eco-admin":
    // The Operator works the platform-wide board — every load, every collector, every
    // intake they capture — so the screens the matrix gives them are not cut by row.
    // Without this case an Operator fell through to "holds no role".
    case "eco-operator":
      return { kind: "all" };
    case "eco-collector":
      return { kind: "collector", userId: user.sub };
    case "eco-officer":
      return identity.facilityId
        ? { kind: "facility", facilityId: identity.facilityId }
        : {
            kind: "unresolved",
            reason:
              "This officer's account is not linked to a recycler facility yet, so no facility's rows are in scope.",
          };
    case "eco-viewer":
      return identity.organizationId
        ? { kind: "brand", organizationId: identity.organizationId }
        : {
            kind: "unresolved",
            reason:
              "This viewer's account is not linked to a brand yet, so no brand's credits are in scope.",
          };
    default:
      return {
        kind: "unresolved",
        reason: "This account holds no role, so no rows are in scope.",
      };
  }
}

/**
 * The sentence a reader returns when it cannot honour a scope, or null when it can.
 *
 * Readers already answer a failed read with a sentence rather than a thrown page, so a
 * scope that cannot be resolved joins that shape instead of inventing a third one.
 */
export function scopeRefusal(scope: Scope): string | null {
  return scope.kind === "unresolved" ? scope.reason : null;
}
