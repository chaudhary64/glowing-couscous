# EcoEPR — RBAC Migration Runbook (5-role multi-tenant)

Target: split the legacy `Operator` into `Operator` (transport) + `Collector` (informal intake),
take `Validation` away from `Officer` and give it to `Admin` alone, and scope reads to the
caller's tenant. One Next.js app, no new portals.

**Decisions locked (see §6 for the steps):**

1. **`cognito:groups` stays the source of truth.** The `custom:role` claim the migration doc
   names is read by nothing in this codebase. A group *is* the role; `lib/auth/pool.ts` writes
   groups and `setPoolRole` guarantees exactly one. No Pre-Token-Generation trigger.
2. **The three accesses the doc silently drops are preserved** — Officer keeps `/map`, Operator
   keeps `/collectors`, Operator keeps `/evidence`. This is the additive direction (§5.1), and
   the doc's stricter version is the tighten-later deploy. Flip any of the three by editing §3.
3. **The handoff keeps polling.** No WebSockets, no SSE.

Baseline before any change: `npx tsc --noEmit` → 0, `npm run lint` → 0.

---

## 1. Read this first: the current model is a rank ladder, and the target is not

This is the finding that decides the whole plan. Get it wrong and the parallel work will not merge.

`lib/auth/roles.ts` gates everything through one numeric ladder:

```ts
export type Guard = { id; minRank: number; requirement: string; paths: string[] };
// canOpen(): allowed when ROLES[role].rank <= guard.minRank
```

Four roles, `rank 2 ≤ 3 ≤ 4 ≤ 5`, so **every role opens a prefix of the screens**. The five
requested roles cannot be expressed as a prefix. Three concrete contradictions:

1. **Viewer needs `/evidence`, and under the ladder Operator gets it too.** `/evidence` is
   `RANK_OPERATOR` (4) today; setting it to 5 for Viewer also hands it to every Operator,
   because `4 <= 5`. Not expressible as a prefix.
2. **Collector needs `/map` and a read-only intakes list, but must not open `/intake`** (the
   capture console), which Operator must open. Any rank weaker than Operator also gives them
   `/pickups` and `/handoff`; any rank stronger also gives them `/gate` and `/recyclers`.
3. **`Validation` becomes Admin-exclusive** while `Officer` keeps `/recyclers`. That one *is*
   expressible in a ladder — which is the trap: a ladder looks fine until items 1 and 2.

**Therefore: delete the ladder, make the guard an explicit role set.**

```ts
export type Guard = { id: string; roles: readonly Role[]; requirement: string; paths: string[] };
// canOpen(): allowed when guard.roles.includes(role)
```

`requirement` stays — `/no-access` and `lib/ai/http.ts` both render it as prose ("limited to
officer or above" becomes "limited to Officer or Admin"). `rank` stops being authority and
becomes display ordering only.

The same ladder exists a second time in `aws/pickup/security.mjs` (`ROLE_RANK`, `OPERATOR`,
`ANY_ROLE`, `requireRole(event, minimum)`). It moves to the same role-set shape —
`requireRole(event, ["eco-operator", "eco-admin"])` — in the same deploy. A ladder on one side
and a matrix on the other is how you get a screen that renders a button the API refuses.

---

## 2. Every place a role is currently encoded (four sources of truth)

All four must land together:

| # | File | What it holds |
|---|---|---|
| 1 | [`lib/auth/roles.ts`](../lib/auth/roles.ts) | `ROLES`, `GUARDS`, `canOpen`, `LEGACY_GROUPS` (`eco-owner` → admin) |
| 2 | [`aws/pickup/security.mjs`](../aws/pickup/security.mjs) | `ROLE_RANK`, `requireRole` — the serverless half |
| 3 | [`db/schema/enums.ts`](../db/schema/enums.ts) | `membershipRole` pg enum (`owner, admin, officer, operator, viewer`) |
| 4 | [`tests/e2e/accounts.ts`](../tests/e2e/accounts.ts) | `ACCOUNTS`, `ROLE_RANK`, `SCREENS` — the expected matrix |

Consumers that compile against the contract:

- `canOpen`: [`proxy.ts`](../proxy.ts), [`lib/auth/dal.ts`](../lib/auth/dal.ts),
  [`lib/ai/http.ts`](../lib/ai/http.ts), [`components/layout/product-nav.tsx`](../components/layout/product-nav.tsx),
  [`components/ui/role-link.tsx`](../components/ui/role-link.tsx), [`app/(product)/map/page.tsx`](../app/(product)/map/page.tsx)
- `roleLabel`: [`app/(auth)/no-access/page.tsx`](../app/(auth)/no-access/page.tsx),
  [`app/(product)/team/page.tsx`](../app/(product)/team/page.tsx),
  [`components/layout/auth-shell.tsx`](../components/layout/auth-shell.tsx),
  [`components/layout/product-shell.tsx`](../components/layout/product-shell.tsx)
- `roleFromGroups`: [`lib/auth/token.ts`](../lib/auth/token.ts), [`lib/auth/pool.ts`](../lib/auth/pool.ts)
  → so the Team screen's role picker and `POST /api/team/role` must accept the fifth role

---

## 3. The target matrix (freeze before anything else)

`✓` = may open. Blank cells are the interesting ones.

| Path | Screen | Collector | Operator | Officer | Viewer | Admin |
|---|---|:--:|:--:|:--:|:--:|:--:|
| `/dashboard` | Today (role-cut) | ✓ own | ✓ | ✓ | ✓ brand | ✓ |
| `/intakes` **(new)** | My submissions (read-only) | ✓ | | | | ✓ |
| `/intake` | New intake (capture) | | ✓ | | | ✓ |
| `/pickups` | Load board | | ✓ | | | ✓ |
| `/handoff` | Collector handoff — PIN | | ✓ | | | ✓ |
| `/gate` | Recycler gate — weigh + PIN | | | ✓ | | ✓ |
| `/demo` | Handoff demo | | ✓ | ✓ | | ✓ |
| `/map` | Hotspot map (+ Call Van) | ✓ | ✓ | ✓ | ✓ RO | ✓ |
| `/map/dispatch` | Assign/clear a site | | ✓ | | | ✓ |
| `/collectors` | Collector directory | | ✓ | | | ✓ |
| `/evidence` | Evidence archive | | ✓ | | ✓ brand | ✓ |
| `/valuation` | Valuations | | | | | ✓ |
| `/validation` | Validation queue | | | | | ✓ |
| `/recyclers` | Recycler capacity | | | ✓ own | | ✓ |
| `/rates` | Rate card | | | | | ✓ |
| `/team` | Team + role assignment | | | | | ✓ |

Note `/valuation` becomes Admin-only: no other role in the new mapping is described as seeing
valuations, so today's Officer access must be removed. `/recyclers` for Officer is "filtered to
their own facility ID" — a scope, not just a role.

---

## 4. Row-level filtering — the risky half, and where the schedule actually goes

No query in the app takes a scope today. Every reader is global:

- [`lib/records/queues.ts`](../lib/records/queues.ts) — `storedCounts()`, `listRecentEvents(8)`, `listPendingHolds(100)`
- [`lib/pickup/directory.ts`](../lib/pickup/directory.ts) — `listLoads(50)`, `listCollectorActivity(25)`
- [`lib/s3/media-assets.ts`](../lib/s3/media-assets.ts) — the evidence listing

The authorisation table already exists and is **read by nothing**:
`organization_members (organization_id, user_id, role)` in [`db/schema/identity.ts`](../db/schema/identity.ts),
whose own comment spells out exactly this use case.

Freeze one scope type so nobody invents their own:

```ts
// lib/auth/scope.ts (new, owned by the contract phase)
export type Scope =
  | { kind: "all" }                                        // Admin
  | { kind: "collector"; userId: string }                  // Collector
  | { kind: "facility"; facilityId: string }               // Officer
  | { kind: "brand"; organizationId: string };             // Viewer
export function scopeFor(user: AuthUser): Scope;
```

Every reader gains `scope` as its **first** parameter: `listLoads(scope, limit)`,
`storedCounts(scope)`, `listEvidence(scope)`. That signature is the contract between the track
owning the read layer and the tracks owning the pages.

### Two blockers to know before promising the filtered screens

1. **The Collector's "intakes today / items priced / net promised" has no data key.**
   `lib/pickup/directory.ts` says it outright: *"Nothing provisions a collector record — no name,
   no tier"*, and `StoredItem.collectorId` documents that it is *"null in the normal case today:
   nothing provisions a collector at submission time"*. So `{ kind: "collector" }` has nothing to
   filter on. Needs a real link first: provision a collector row at intake keyed by
   `users.cognito_sub`, or read from `intakes.uploader_user_id`. Without this, the Collector's
   role-1 dashboard is a filtered dashboard over an empty set.
2. **The Viewer's "only the credits this brand claimed" has no table yet.** The filter is
   `epr_credit_notes` → brand claim, and [`app/(product)/valuation/page.tsx`](../app/(product)/valuation/page.tsx)
   documents that table as *"the money half of the schema and has no writer yet"* — which is why
   `StoredValuation.eprCreditNote` is always `null`. Viewer sees an empty archive until built.

Both are data-model work, not RBAC work. They get their own steps (§6, 20 and 21) so they cannot
sink the guard rewrite.

---

## 5. Why these choices

### 5.1 Deploy without locking anyone out

1. **Additive first.** Create the group, keep `LEGACY_GROUPS`, and give the new guard sets the
   union of old and new access. Nobody who could open a screen stops being able to.
2. **Then tighten.** A second deploy removes the seats you meant to remove (Validation and
   Valuations from Officer).
3. **App and Lambda together.** `security.mjs` and `roles.ts` are one change; a half-deploy
   either 403s a valid role or opens a route.
4. **Scoping must never silently widen.** On a scope it cannot resolve, return the read's existing
   `error` sentence and render it — the readers already have that shape ("a failed read is a
   sentence, never a thrown page"). Silent widening is a data leak; a red panel is a bug report.
5. **Do not run the visual redesign concurrently.** These tracks touch `dashboard/page.tsx`,
   `product-nav.tsx` and most of `components/ui/*`. Sequence it: RBAC first, design on top.

### 5.2 The handoff already works, and WebSockets would be a regression

The DynamoDB stream already settles the load. The Operator's screen polls:
[`use-poll.ts`](../components/features/handoff/use-poll.ts) schedules the next call after the
previous settles, over `GET /api/pickup/[pickupId]` and `.../events`; and
`tests/e2e/pickup.spec.ts` already asserts the phone flips to *"UPI payment"* with
`timeout: 20_000` and no refresh. The SSR runs on Lambda behind API Gateway, where a long-lived
upgrade is the wrong shape and a WebSocket API would add a second auth path the Cognito JWT
authorizer does not cover. Keep polling; tighten the interval and add optimistic settling state.

---

## 6. The steps

Three people. Phase A is the only serialized work; Phase B runs all three tracks in parallel on
disjoint files; Phase C lands and verifies. Steps 1–9 must be finished before anyone starts 10.

### Phase A — freeze the interfaces (1 person, serialized, ~half a day)

**Step 1. Create the `eco-collector` Cognito group, and the demo collector account.**
In the pool: a group named `eco-collector` (label `Collector`), and `demo.collector@example.com`
as a member. Every other track's e2e run depends on this existing.

**Step 2. Freeze the target matrix** in §3 of this file, with the three preserved accesses
(Officer `/map`, Operator `/collectors`, Operator `/evidence`). This file is the source of truth
for the other two people.

**Step 3. Rewrite [`lib/auth/roles.ts`](../lib/auth/roles.ts).** `Guard.minRank: number` →
`Guard.roles: readonly Role[]`; add `"eco-collector"` with label `Collector`; rewrite `GUARDS`
to §3; update the `requirement` strings to name roles rather than "or above"; keep
`LEGACY_GROUPS` (`eco-owner` → `eco-admin`); keep `rank` if the UI still sorts by it, otherwise
demote it to display ordering. **This is the interface everything else compiles against.**

**Step 4. Add [`lib/auth/scope.ts`](../lib/auth/scope.ts).** `Scope` and `scopeFor(user)` exactly
as §4, so the screens track and the read-layer track never have to negotiate a type mid-flight.

**Step 5. Rewrite [`aws/pickup/security.mjs`](../aws/pickup/security.mjs).** Delete `ROLE_RANK`,
`OPERATOR`, `ANY_ROLE`; `requireRole(event, roles: string[])`. `caller()` keeps parsing
`cognito:groups` (the three shapes it already handles) and returns the role set. Same deploy as
Step 3.

**Step 6. Add the fifth enum value.** [`db/schema/enums.ts`](../db/schema/enums.ts)
`membershipRole` += `collector`, then `npm run db:generate` and `npm run db:check`. The generated
SQL is `ALTER TYPE … ADD VALUE`, which cannot run inside a transaction on older Postgres — check
the generated file before applying.

**Step 7. Rewrite [`tests/e2e/accounts.ts`](../tests/e2e/accounts.ts).** Five entries in
`ACCOUNTS`; replace `ROLE_RANK` and `SCREENS[].minRank` with `SCREENS[].roles: RoleName[]`
straight from §3. Everything in `tests/e2e/` imports this file.

**Step 8. Gate and tag.** `npx tsc --noEmit` → 0, `npm run lint` → 0, `npm run db:check` → 0,
`npm run test:heatmap` → pass. Merge to `main`, tag **`rbac-contract-v1`**.

**Step 9. Everyone branches from `rbac-contract-v1`.** Tracks A, B and C below start here, and
nobody edits a file another track owns.

### Phase B — three tracks in parallel

#### Track A — auth surface + shell (person 1)

**Step 10. `/no-access` explains a role set.** [`app/(auth)/no-access/page.tsx`](../app/(auth)/no-access/page.tsx):
the ladder table (`Object.entries(ROLES).sort(...)`) becomes the five roles with what each opens;
the refusal copy renders `verdict.guard.requirement` as prose. It is the page every refused user
lands on — get the words right here.

**Step 11. The fifth role is grantable.** [`app/(product)/team/page.tsx`](../app/(product)/team/page.tsx),
[`role-picker.tsx`](../components/features/product/team/role-picker.tsx),
[`lib/auth/pool.ts`](../lib/auth/pool.ts) (`ROLE_GROUPS`), and
[`app/api/team/role/route.ts`](../app/api/team/role/route.ts) — which validates
`Object.keys(ROLES)`, so it follows Step 3 automatically; confirm `setPoolRole`'s add-then-remove
still leaves exactly one group.

**Step 12. The shell stops asserting validation work to people who cannot do it.**
[`components/layout/product-shell.tsx`](../components/layout/product-shell.tsx): the
`/validation` badge is counted and shown only where `/validation` opens (the hold count is a
`listPendingHolds` call that an Officer should not be making either).
[`components/layout/auth-shell.tsx`](../components/layout/auth-shell.tsx) for the role label.

**Step 13. Track A gate.** `npx tsc --noEmit && npm run lint`.

#### Track B — screens (person 2)

**Step 14. Nav and links.** [`lib/data/product-nav.ts`](../lib/data/product-nav.ts) (add the
Collector group/items), [`components/layout/product-nav.tsx`](../components/layout/product-nav.tsx)
(already filters with `canOpen`, so it follows the matrix), and
[`components/ui/role-link.tsx`](../components/ui/role-link.tsx) (`mayOpen` follows; add a
read-only variant only if a screen needs one).

**Step 15. The four role-cut dashboards.** [`app/(product)/dashboard/page.tsx`](../app/(product)/dashboard/page.tsx)
already cuts cards with `mayOpen`, so the matrix does most of it. Add: the Collector's personal
tiles (intakes today, items priced, net promised) and the Viewer's Compliance Gauge against
annual tonnage. Call the Step 17/18 readers with the frozen `Scope` signature — **do not edit the
read layer.**

**Step 16. The Collector's own submissions.** New `app/(product)/intakes/page.tsx`: read-only
history of items this collector submitted and their valuation. Feeds from Step 20; until then it
renders the readers' "not configured" sentence honestly rather than an empty table.

**Step 17. `[Call Van]`.** New `components/features/collector/call-van-button.tsx`:
`navigator.geolocation.getCurrentPosition` (the pattern and the consent gate already exist in
[`components/layout/consent-banner.tsx`](../components/layout/consent-banner.tsx) and
[`live-analysis.tsx`](../components/features/ai/live-analysis.tsx)), then a `POST` that drops an
"open site" pin. Reuse `POST /api/heatmap/dispatch` if the payload fits; otherwise add a route
with the same `authorizeUser` guard. Plus the read-only map variants in
[`app/(product)/map/page.tsx`](../app/(product)/map/page.tsx) for Collector/Viewer/Officer.

**Step 18. Track B gate.** `npx tsc --noEmit && npm run lint`.

#### Track C — read layer + realtime (person 3)

**Step 19. Scope the Postgres reads.** [`lib/records/queues.ts`](../lib/records/queues.ts) —
`storedCounts(scope)`, `listRecentEvents(scope, n)`, `listPendingHolds(scope, n)`. Every existing
call site must pass a scope; the compiler finds them.

**Step 20. Scope the pickup reads and the collector identity.**
[`lib/pickup/directory.ts`](../lib/pickup/directory.ts) — `listLoads(scope, n)`,
`listCollectorActivity(scope, n)`, plus `getLoad`. Then close §4.1: provision a collector row at
intake keyed to `users.cognito_sub` (or read `intakes.uploader_user_id`) so
`{ kind: "collector" }` filters something real. Add per-route role sets to the pickup API routes
in [`app/api/pickup/`](../app/api/pickup/) — `POST /pickups` and `/pin` are Operator+Admin,
`/settle` is Officer+Admin.

**Step 21. Scope the evidence read.** [`lib/s3/media-assets.ts`](../lib/s3/media-assets.ts) —
`listEvidence(scope)` filtering to the credits the brand claimed (blocked on §4.2; until the
`epr_credit_notes` writer exists, return the honest "no claim on file" sentence, not an empty
list). Then [`app/(product)/evidence/page.tsx`](../app/(product)/evidence/page.tsx),
[`collectors/page.tsx`](../app/(product)/collectors/page.tsx) and
[`recyclers/page.tsx`](../app/(product)/recyclers/page.tsx) pass scope and render its error
sentence.

**Step 22. Handoff: keep polling, tighten it.** No new transport. Lower the interval on the
handoff screen, add an optimistic "settling…" state so the Operator sees the gate working before
the poll lands, and keep the 20-second assertion in `pickup.spec.ts` as the acceptance test.

**Step 23. Track C gate.** `npx tsc --noEmit && npm run lint`, then `npm run test:heatmap` and
`npm run test:rates`.

### Phase C — land and verify

**Step 24. Merge A → B → C.** A first (most-consumed contract), C last (changes function
signatures, so B's rebase is mechanical). After **each** merge:
`npx tsc --noEmit && npm run lint`.

**Step 25. Update the e2e specs the matrix change breaks.**

| Spec | Why |
|---|---|
| [`access.spec.ts`](../tests/e2e/access.spec.ts) | Rewrite `ROLE_RANK[role] <= screen.minRank` to `screen.roles.includes(role)` (both tests) |
| [`dashboard.spec.ts`](../tests/e2e/dashboard.spec.ts) | Same rewrite, **plus** the `Full map →` assertion currently demands that link be visible for *every* role |
| [`global-setup.ts`](../tests/e2e/global-setup.ts) | Signs in one account per `ACCOUNTS` entry — now five |
| [`team.spec.ts`](../tests/e2e/team.spec.ts) | Asserts the role must be *"one of the four"*; becomes five |

[`screens.spec.ts`](../tests/e2e/screens.spec.ts) needs **no edit** — it reads only `.path` and
`.title` and runs as admin, who keeps every seat. Adding `/intakes` to `SCREENS` gives it that
screen's render check for free; do not "fix" it.

**Step 26. The full battery.**

```
npx tsc --noEmit
npm run lint
npm run db:check
npm run test:heatmap && npm run test:rates
npm run test:e2e
```

**Step 27. The matrix walk** — what actually proves it. Sign in as each of the five accounts, and
for every row of §3 either the screen opens or you land on `/no-access?from=…&need=…`. Step 25
automates this via `access.spec.ts`; run it once by hand as well.

**Step 28. Deploy additively, then tighten.** Deploy 1 gives the new guard sets the union of old
and new access (§5.1), with `security.mjs` and `roles.ts` in the same release. Deploy 2 removes
Validation and Valuations from Officer.

**Step 29. Update the docs.** [`README.md`](../README.md) says *"four roles, one enforced access
table"* in its status table; it becomes five.

**Step 30. Only now start the visual redesign,** on top of the frozen nav and matrix (§5.1.5).

---

## 7. Effort, honestly

| Work | Owner | Depends on |
|---|---|---|
| Steps 1–9 contract | 1 person, serialized | — |
| Steps 10–13 Track A | person 1 | tag `rbac-contract-v1` |
| Steps 14–18 Track B | person 2 | tag `rbac-contract-v1` |
| Steps 19–23 Track C | person 3 | tag `rbac-contract-v1` |
| Steps 24–30 land + verify | shared | all three |

Wall-clock is roughly `contract + max(A, B, C) + verification`. The two items that will move the
date are Step 20 (provisioning a collector identity — the Collector's dashboard is empty without
it) and Step 21 (the brand-claim filter — blocked on the `epr_credit_notes` writer). Role plumbing
is small; the filtered screens are the work.
