/**
 * The five Cognito demo accounts, one per role, and what each role may open.
 * The password is read from E2E_PASSWORD (in .env.local), never committed.
 */
export type RoleName = "admin" | "officer" | "operator" | "collector" | "viewer";

export const ACCOUNTS: Record<RoleName, string> = {
  admin: "demo.admin@example.com",
  officer: "demo.officer@example.com",
  operator: "demo.operator@example.com",
  collector: "demo.collector@example.com",
  viewer: "demo.viewer@example.com",
};

/** Still in the pool's old `eco-owner` group, which the app now reads as Admin. */
export const LEGACY_OWNER = "demo.owner@example.com";

/**
 * A guarded screen and the roles that may open it.
 *
 * Authority is a role set now, not a rank, so the expectation is written the way
 * `lib/auth/roles.ts` holds it: the roles listed here, and nothing "or above". The
 * matrix is the migration plan's frozen target — see `docs/rbac-migration-plan.md` §3.
 */
export type Screen = {
  path: string;
  roles: readonly RoleName[];
  nav: string;
  title: string;
};

export const SCREENS: readonly Screen[] = [
  {
    path: "/dashboard",
    roles: ["admin", "officer", "operator", "collector", "viewer"],
    nav: "Dashboard",
    title: "Today",
  },
  {
    path: "/map",
    roles: ["admin", "officer", "operator", "collector", "viewer"],
    nav: "Hotspot map",
    title: "Hotspot map",
  },
  { path: "/intake", roles: ["admin", "operator"], nav: "New intake", title: "New intake" },
  { path: "/intakes", roles: ["admin", "collector"], nav: "My submissions", title: "Submissions" },
  { path: "/pickups", roles: ["admin", "operator"], nav: "Pickups", title: "Pickups" },
  {
    path: "/handoff",
    roles: ["admin", "operator"],
    nav: "Collector handoff",
    title: "Hand over e-waste",
  },
  { path: "/gate", roles: ["admin", "officer"], nav: "Recycler gate", title: "Recycler gate" },
  {
    path: "/demo",
    roles: ["admin", "officer", "operator"],
    nav: "Handoff demo",
    title: "Smart pickup & digital credit",
  },
  { path: "/collectors", roles: ["admin", "operator"], nav: "Collectors", title: "Collectors" },
  {
    path: "/evidence",
    roles: ["admin", "operator", "viewer"],
    nav: "Evidence",
    title: "Evidence archive",
  },
  { path: "/valuation", roles: ["admin"], nav: "Valuations", title: "Valuations" },
  { path: "/validation", roles: ["admin"], nav: "Validation queue", title: "Validation queue" },
  { path: "/recyclers", roles: ["admin", "officer"], nav: "Recyclers", title: "Recyclers" },
  { path: "/team", roles: ["admin"], nav: "Team", title: "Team" },
  { path: "/rates", roles: ["admin"], nav: "Rate card", title: "Rate card" },
];

export const stateFile = (role: RoleName) => `tests/e2e/.auth/${role}.json`;

export function password(): string {
  const value = process.env.E2E_PASSWORD;
  if (!value) throw new Error("E2E_PASSWORD is not set. Add it to .env.local (see tests/e2e/README.md).");
  return value;
}
