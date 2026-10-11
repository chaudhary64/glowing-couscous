/**
 * Roles and the access matrix.
 *
 * Deliberately free of `next/headers`, React and any I/O: the same table has to be
 * readable by the proxy (which decides whether to even render a route), by the data
 * access layer (which decides for real), and by the UI (which explains a refusal).
 * One table, three readers, no chance of them disagreeing.
 *
 * **Authority is a role set, not a rank ladder.** A guard names the groups that may
 * open a screen and `canOpen` is a membership test. The five roles cannot be ordered
 * as a prefix — a Collector reads the map and an Operator writes the board, so neither
 * outranks the other, and a Viewer needs `/evidence` that an Operator also holds. The
 * ladder that used to sit here (`minRank`, `rank <= minRank`) could only express
 * "this role or more powerful", which cannot describe that matrix; it was replaced
 * rather than stretched.
 *
 * `rank` survives, and authorises nothing: it is display ordering (the ladder on
 * `/no-access` is sorted by it) and the tie-break when one person holds several
 * groups, where the first group in this order wins. The same role-set shape is in
 * `aws/pickup/security.mjs` for the serverless half, so the screen and the API it
 * calls cannot disagree about who may act.
 */

export const ROLES = {
  "eco-admin": {
    label: "Admin",
    rank: 2,
    summary: "The team and who holds which role, the rate card, and every other screen.",
  },
  "eco-officer": {
    label: "Officer",
    rank: 3,
    summary: "The recycler gate and the facilities, plus the screens an operator opens.",
  },
  "eco-operator": {
    label: "Operator",
    rank: 4,
    summary: "Intake, pickups and the handoff. No rate cards, no members.",
  },
  "eco-collector": {
    label: "Collector",
    rank: 5,
    summary: "Their own submissions and the map. No capture console, no board.",
  },
  "eco-viewer": {
    label: "Viewer",
    rank: 6,
    summary: "Read-only: the dashboard, the map, and the evidence a brand has claimed.",
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

export const roleLabel = (role: Role | null): string =>
  role ? ROLES[role].label : "No role assigned";

/** Display ordering, and the tie-break in `roleFromGroups`. Never an authorisation. */
export const rankOf = (role: Role): number => ROLES[role].rank;

const isRole = (value: string): value is Role =>
  Object.prototype.hasOwnProperty.call(ROLES, value);

/**
 * The highest-placed role a user holds, or null when they hold none.
 *
 * A user can be in several groups. Display order decides which one names them, which
 * is the only choice that does not silently downgrade an admin who was also added as
 * a viewer for a demo. It authorises nothing: every screen is a role-set test, so a
 * user holding two groups is not quietly widened to either one's access.
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
  /** The roles that may open this screen. Exactly these; there is no "or above". */
  roles: readonly Role[];
  /** How the requirement reads to a person who was refused. */
  requirement: string;
  paths: string[];
};

/**
 * Who may open what, frozen from the migration plan's target matrix. `/` is absent on
 * purpose: the landing page is the public half of this project, meant to be read by
 * anyone. The dashboard is gated at `/dashboard` so the two never share a path.
 *
 * The three accesses the migration doc dropped silently are preserved here — Officer
 * keeps `/map`, Operator keeps `/collectors`, Operator keeps `/evidence` — and the
 * three seats the doc does remove are removed: Validation and Valuations are
 * admin-only, and the recycler gate is the officer's.
 */
export const GUARDS: readonly Guard[] = [
  {
    id: "dashboard",
    roles: ["eco-admin", "eco-officer", "eco-operator", "eco-collector", "eco-viewer"],
    requirement: "any assigned role",
    paths: ["/dashboard"],
  },
  {
    // Acting on the map — assigning a van to a hotspot, clearing one — is board work,
    // so it carries the board's roles. Listed *before* `/map` because `guardFor` takes
    // the first match: below it, `/map` would cover `/map/dispatch` and a collector or
    // a viewer could dispatch a van.
    id: "map-dispatch",
    roles: ["eco-admin", "eco-operator"],
    requirement: "Operator or Admin",
    paths: ["/map/dispatch"],
  },
  {
    id: "map",
    roles: ["eco-admin", "eco-officer", "eco-operator", "eco-collector", "eco-viewer"],
    requirement: "any assigned role",
    paths: ["/map"],
  },
  {
    id: "intake",
    roles: ["eco-admin", "eco-operator"],
    requirement: "Operator or Admin",
    paths: ["/intake"],
  },
  {
    // The collector's own submissions, a read-only history. `/intakes` is not beneath
    // `/intake` for `guardFor`'s prefix test — that compares against `base + "/"` — so
    // the two screens hold different seats without either inheriting the other's.
    id: "intakes",
    roles: ["eco-admin", "eco-collector"],
    requirement: "Collector or Admin",
    paths: ["/intakes"],
  },
  {
    id: "pickups",
    roles: ["eco-admin", "eco-operator"],
    requirement: "Operator or Admin",
    paths: ["/pickups"],
  },
  {
    // The two ends of the handoff are different seats now, which is the whole point of
    // the migration: the Operator routes a load and shows the PIN, the Officer weighs
    // it and types the PIN. They used to be one rank, so the screens shared a guard.
    id: "handoff",
    roles: ["eco-admin", "eco-operator"],
    requirement: "Operator or Admin",
    paths: ["/handoff"],
  },
  {
    id: "gate",
    roles: ["eco-admin", "eco-officer"],
    requirement: "Officer or Admin",
    paths: ["/gate"],
  },
  {
    id: "demo",
    roles: ["eco-admin", "eco-officer", "eco-operator"],
    requirement: "Operator, Officer or Admin",
    paths: ["/demo"],
  },
  {
    id: "collectors",
    roles: ["eco-admin", "eco-operator"],
    requirement: "Operator or Admin",
    paths: ["/collectors"],
  },
  {
    // Deliberately held by the same roles the media read requires: a weaker guard here
    // would render a Read button the API then refuses, and a stronger one would hide
    // evidence from the operators who produce it. The Viewer's seat is read-only and
    // scoped to the credits its brand claimed — the scope is `lib/auth/scope.ts`, not
    // this table.
    id: "evidence",
    roles: ["eco-admin", "eco-operator", "eco-viewer"],
    requirement: "Operator, Viewer or Admin",
    paths: ["/evidence"],
  },
  {
    id: "valuation",
    roles: ["eco-admin"],
    requirement: "Admin only",
    paths: ["/valuation"],
  },
  {
    id: "validation",
    roles: ["eco-admin"],
    requirement: "Admin only",
    paths: ["/validation"],
  },
  {
    id: "recyclers",
    roles: ["eco-admin", "eco-officer"],
    requirement: "Officer or Admin",
    paths: ["/recyclers"],
  },
  {
    // Who has an account, and the prices in force: the two things an admin answers
    // for. Both are read-only here — roles are Cognito groups and the card ships in
    // code — so a wider screen would leak the team list for no gain.
    id: "administration",
    roles: ["eco-admin"],
    requirement: "Admin only",
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
 * `/intake/7` are the same seat, and matching only the exact string meant a nested
 * route added later silently lost its check — the proxy would still require a session,
 * so the hole would be invisible until someone noticed a viewer reading an officer's
 * screen.
 *
 * The comparison is against `path + "/"`, not a bare prefix, so `/map-archive` is not
 * covered by `/map` and `/intakes` is not covered by `/intake`. `/` is excluded from
 * the nested case for the obvious reason: as a prefix it matches the entire site.
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
  | { ok: false; guard: Guard; reason: "no-role" | "role-not-allowed" };

export function canOpen(
  pathname: string,
  role: Role | null,
): AccessVerdict {
  const guard = guardFor(pathname);
  if (!guard) return { ok: true, guard: null };
  if (role === null) return { ok: false, guard, reason: "no-role" };
  if (!guard.roles.includes(role)) {
    return { ok: false, guard, reason: "role-not-allowed" };
  }
  return { ok: true, guard };
}
