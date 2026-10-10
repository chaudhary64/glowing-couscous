/**
 * The five Cognito demo accounts, one per role, and what each role may open.
 * The password is read from E2E_PASSWORD (in .env.local), never committed.
 */
export type RoleName = "owner" | "admin" | "officer" | "operator" | "viewer";

export const ACCOUNTS: Record<RoleName, string> = {
  owner: "demo.owner@example.com",
  admin: "demo.admin@example.com",
  officer: "demo.officer@example.com",
  operator: "demo.operator@example.com",
  viewer: "demo.viewer@example.com",
};

export const ROLE_RANK: Record<RoleName, number> = { owner: 1, admin: 2, officer: 3, operator: 4, viewer: 5 };

/** Every guarded screen, its minimum rank (lib/auth/roles.ts) and its nav label. */
export const SCREENS = [
  { path: "/dashboard", minRank: 5, nav: "Dashboard", title: "Today" },
  { path: "/map", minRank: 5, nav: "Hotspot map", title: "Hotspot map" },
  { path: "/intake", minRank: 4, nav: "New intake", title: "New intake" },
  { path: "/pickups", minRank: 4, nav: "Pickups", title: "Pickups" },
  { path: "/handoff", minRank: 4, nav: "Collector handoff", title: "Hand over e-waste" },
  { path: "/gate", minRank: 4, nav: "Recycler gate", title: "Recycler gate" },
  { path: "/demo", minRank: 4, nav: "Handoff demo", title: "Smart pickup & digital credit" },
  { path: "/collectors", minRank: 4, nav: "Collectors", title: "Collectors" },
  { path: "/evidence", minRank: 4, nav: "Evidence", title: "Evidence archive" },
  { path: "/valuation", minRank: 3, nav: "Valuations", title: "Valuations" },
  { path: "/validation", minRank: 3, nav: "Validation queue", title: "Validation queue" },
  { path: "/recyclers", minRank: 3, nav: "Recyclers", title: "Recyclers" },
] as const;

export const stateFile = (role: RoleName) => `tests/e2e/.auth/${role}.json`;

export function password(): string {
  const value = process.env.E2E_PASSWORD;
  if (!value) throw new Error("E2E_PASSWORD is not set. Add it to .env.local (see tests/e2e/README.md).");
  return value;
}
