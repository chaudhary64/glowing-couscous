/**
 * Roles and the access matrix.
 *
 * Deliberately free of `next/headers`, React and any I/O: the same table has to be
 * readable by the proxy (which decides whether to even render a route), by the data
 * access layer (which decides for real), and by the UI (which explains a refusal).
 * One table, three readers, no chance of them disagreeing.
 *
 * The four values are Cognito groups in the pool. Rank is authority: lower is more
 * powerful, so "at least an operator" is `rank <= 4`. Admin is rank 2, not 1, because
 * rank 1 was Owner, which opened nothing Admin did not; keeping the numbers means the
 * pickup Lambda (aws/pickup/security.mjs) and every saved rank still agree.
 */

export const ROLES = {
  "eco-admin": {
    label: "Admin",
    rank: 2,
    summary: "The team and who holds which role, the rate card in force, plus everything an officer can.",
  },
  "eco-officer": {
    label: "Officer",
    rank: 3,
    summary: "Valuations, validation decisions and recyclers, plus everything an operator can.",
  },
  "eco-operator": {
    label: "Operator",
    rank: 4,
    summary: "Intake, pickups and settlements. No rate cards, no members.",
  },
  "eco-viewer": {
    label: "Viewer",
    rank: 5,
    summary: "Read-only, for a municipality or brand analyst.",
  },
} as const;

export type Role = keyof typeof ROLES;

/**
 * Groups that no longer have a role of their own, and the role they now read as.
 * `eco-owner` was folded into Admin: its members keep working without anyone editing
 * the pool, and a new account belongs in `eco-admin`.
 */
const LEGACY_GROUPS: Readonly<Record<string, Role>> = {
  "eco-owner": "eco-admin",
};

/** Ranks used by the matrix below, named so the intent survives a re-read. */
export const RANK_ANY_ROLE = 5;
export const RANK_OPERATOR = 4;
export const RANK_OFFICER = 3;
export const RANK_ADMIN = 2;

export const roleLabel = (role: Role | null): string =>
  role ? ROLES[role].label : "No role assigned";

export const rankOf = (role: Role): number => ROLES[role].rank;

const isRole = (value: string): value is Role =>
  Object.prototype.hasOwnProperty.call(ROLES, value);

/**
 * The highest-authority role a user holds, or null when they hold none.
 *
 * A user can be in several groups. The strongest wins, which is the only choice that
 * does not silently downgrade an admin who was also added as a viewer for a demo.
 */
export function roleFromGroups(groups: readonly string[] | undefined): Role | null {
  let best: Role | null = null;
  for (const name of groups ?? []) {
    const group = isRole(name)
      ? name
      : Object.prototype.hasOwnProperty.call(LEGACY_GROUPS, name)
        ? LEGACY_GROUPS[name]
        : null;
    if (!group) continue;
    if (best === null || ROLES[group].rank < ROLES[best].rank) best = group;
  }
  return best;
}

export type Guard = {
  /** Stable id, safe to put in a URL. */
  id: string;
  /** Minimum authority: a user may open this when `rank <= minRank`. */
  minRank: number;
  /** How the requirement reads to a person who was refused. */
  requirement: string;
  paths: string[];
};

/**
 * Who may open what. `/` is absent on purpose: the landing page is the public half of
 * this project, meant to be read by anyone.
 * The dashboard is gated at `/dashboard` so the two never share a path.
 */
export const GUARDS: readonly Guard[] = [
  {
    id: "dashboard",
    minRank: RANK_ANY_ROLE,
    requirement: "any assigned role",
    paths: ["/dashboard"],
  },
  {
    // Acting on the map — assigning a van to a hotspot, clearing one, recomputing the
    // clusters — is pickup-board work, so it carries the pickup board's rank. Listed
    // *before* `/map` because `guardFor` takes the first match: below it, `/map` would
    // cover `/map/dispatch` and any signed-in viewer could dispatch a van.
    id: "map-dispatch",
    minRank: RANK_OPERATOR,
    requirement: "operator or above",
    paths: ["/map/dispatch"],
  },
  {
    id: "map",
    minRank: RANK_ANY_ROLE,
    requirement: "any assigned role",
    paths: ["/map"],
  },
  {
    id: "intake",
    minRank: RANK_OPERATOR,
    requirement: "operator or above",
    paths: ["/intake"],
  },
  {
    id: "pickups",
    minRank: RANK_OPERATOR,
    requirement: "operator or above",
    paths: ["/pickups"],
  },
  {
    // The three handoff screens drive `POST /pickups`, `/pin` and `/settle`, which the
    // Lambda holds to `eco-operator` or above — so the screens are held to the same
    // rank, and nobody is shown a button the API will refuse. The phone and the gate are
    // one account in this pilot; a collector role of their own is the next step.
    id: "handoff",
    minRank: RANK_OPERATOR,
    requirement: "operator or above",
    paths: ["/handoff", "/gate", "/demo"],
  },
  {
    id: "collectors",
    minRank: RANK_OPERATOR,
    requirement: "operator or above",
    paths: ["/collectors"],
  },
  {
    // Deliberately the same authority `/api/media/read` requires — it authorizes
    // against `/intake`, which is this rank. A weaker guard here would render a Read
    // button the API then refuses, and a stronger one would hide evidence from the
    // operators who produce it.
    id: "evidence",
    minRank: RANK_OPERATOR,
    requirement: "operator or above",
    paths: ["/evidence"],
  },
  {
    id: "valuation",
    minRank: RANK_OFFICER,
    requirement: "officer or above",
    paths: ["/valuation"],
  },
  {
    id: "validation",
    minRank: RANK_OFFICER,
    requirement: "officer or above",
    paths: ["/validation"],
  },
  {
    id: "recyclers",
    minRank: RANK_OFFICER,
    requirement: "officer or above",
    paths: ["/recyclers"],
  },
  {
    // Who has an account, and the prices in force: the two things an admin answers
    // for. Both are read-only here — roles are Cognito groups and the card ships in
    // code — so a viewer-level screen would leak the team list for no gain.
    id: "administration",
    minRank: RANK_ADMIN,
    requirement: "admin or above",
    paths: ["/team", "/rates"],
  },
];

/** Trailing slashes are the same page; `/` stays `/`. */
const normalise = (pathname: string): string => {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.replace(/\/+$/, "");
  return pathname;
};

/**
 * The guard covering a path, or null when the path is not gated.
 *
 * A guarded screen covers what is beneath it as well as itself: `/intake` and
 * `/intake/7` are the same authority, and matching only the exact string meant a
 * nested route added later silently lost its rank check — the proxy would still
 * require a session, so the hole would be invisible until someone noticed a viewer
 * reading an officer's screen.
 *
 * The comparison is against `path + "/"`, not a bare prefix, so `/map-archive` is
 * not covered by `/map`. `/` is excluded from the nested case for the obvious
 * reason: as a prefix it matches the entire site.
 */
export function guardFor(pathname: string): Guard | null {
  const path = normalise(pathname);
  return (
    GUARDS.find(
      (guard) =>
        guard.paths.includes(path) ||
        guard.paths.some((base) => base !== "/" && path.startsWith(`${base}/`)),
    ) ?? null
  );
}

/** Pages that exist only for signed-out or unassigned users. */
export const isAuthPage = (pathname: string): boolean =>
  pathname === "/login" || pathname === "/signup" || pathname === "/confirm";

/**
 * Paths that never require a session. Everything not listed here is protected by
 * default — a new screen is locked until someone adds it to the matrix, which is the
 * failure direction worth having.
 *
 * The root is on the list because it is the landing page now, not the dashboard: a
 * brand buyer has to be able to read the pitch without an account. The working
 * screens all sit behind the guards above.
 */
export const isPublicPath = (pathname: string): boolean => {
  const path = normalise(pathname);
  if (path === "/") return true;
  return isAuthPage(path);
};

export type AccessVerdict =
  | { ok: true; guard: Guard | null }
  | { ok: false; guard: Guard; reason: "no-role" | "insufficient-rank" };

export function canOpen(
  pathname: string,
  role: Role | null,
): AccessVerdict {
  const guard = guardFor(pathname);
  if (!guard) return { ok: true, guard: null };
  if (role === null) return { ok: false, guard, reason: "no-role" };
  if (ROLES[role].rank > guard.minRank) {
    return { ok: false, guard, reason: "insufficient-rank" };
  }
  return { ok: true, guard };
}
