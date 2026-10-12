# RBAC migration — the work that is left, and who does it

**Read [`rbac-migration-plan.md`](rbac-migration-plan.md) first.** That file is the runbook: the
reasoning, the target matrix, the deploy strategy and the step numbers this document keeps
referring to. This file is the split — what is already finished, what each of the three people
owns, and the traps that are already known so nobody has to find them twice.

Everything here is written against the contract frozen on `rbac-contract-v1` — commit
`6ff9af2`, pushed to `origin` with the tag of the same name. Phase A — steps 1–9 of the runbook —
is done, so each of the three tracks below can start from it without waiting on anything else.

---

## 0. Start here

The branch is on the remote — `origin` is `git@github.com:chaudhary64/glowing-couscous.git`.
Fetch it and cut your track from it:

```bash
git fetch origin
git switch -c rbac/track-a origin/rbac-contract-v1     # or track-b / track-c
```

Two commands tell you whether you have the right revision. `git status -sb` should say your branch
is up to date with `origin/rbac-contract-v1`, and the contract commit should be in your history:

```bash
git log --oneline --grep "Make authority a role set"
# 6ff9af2 Make authority a role set, and give the Collector a seat of its own
```

No `-5` window on that on purpose — this document gains commits of its own, and a fixed window
would eventually report a false negative and send you chasing a problem you do not have. If
either command comes up empty, run `git fetch --prune origin` before you start: you are on an
older revision of the contract, and the whole point of Phase A was to freeze one.

**Branch from the branch, not the tag.** `rbac-contract-v1` is both, and they no longer mean the
same thing:

| Ref | Points at | What it is |
| --- | --- | --- |
| `origin/rbac-contract-v1` | the branch head | the contract **plus** later revisions of this document — **take this one** |
| tag `rbac-contract-v1` | `bd97acb` | the published freeze of the contract code and the first version of this document; left where it was rather than force-moved, so it is immutable |

The **contract code is identical** in both. `lib/auth/roles.ts`, `lib/auth/scope.ts`,
`aws/pickup/security.mjs`, `db/schema/enums.ts` and `tests/e2e/accounts.ts` have not changed since
`6ff9af2`, and `git diff 6ff9af2 origin/rbac-contract-v1` shows this document and nothing else.
Only the wording of this file has moved on.

### How the three tracks land

Each of you works on your own branch and opens a pull request **against `rbac-contract-v1`**, not
against `main`. The three merge into the contract in the order A → B → C (step 24), re-running
`npx tsc --noEmit && npm run lint` after each one, and the merged result goes to `main` only
afterwards. If your branch lives for more than a day, `git fetch origin && git rebase
origin/rbac-contract-v1` rather than merging back — the contract files are the ones that will
conflict, and a rebase shows you which of them you touched that you should not have.

`main` has **not** been merged into and is untouched. The runbook's step 8 says "merge to main and
tag"; that was deliberately split so the three tracks can start in parallel without waiting for a
merge review. Nothing is deployed from this branch yet: the Lambda carries the role sets, and the
app the world can reach still runs `main`.

### The one rule that keeps the merge clean

> **Nobody edits a file another track owns.**

The file lists in §2 are exact and do not overlap. If a change feels like it belongs to two
tracks, it belongs to the one that owns the file, and the other track asks for it there — that
is what steps 24's merge order (A → B → C) exists to absorb.

---

## 1. What is already done — treat this as frozen

### The contract

| What | Where | State |
| --- | --- | --- |
| Five roles, and the access matrix as **role sets** | [`lib/auth/roles.ts`](../lib/auth/roles.ts) | Done. `Guard.minRank` → `Guard.roles`; `canOpen` is a membership test |
| The row-level scope type | [`lib/auth/scope.ts`](../lib/auth/scope.ts) | Done. `Scope`, `scopeFor(user, identity)`, `scopeRefusal(scope)` |
| The serverless half, same role sets | [`aws/pickup/security.mjs`](../aws/pickup/security.mjs) | Done. `ROLE_RANK`/`OPERATOR`/`ANY_ROLE` deleted; `requireRole(event, roles)` |
| `collector` in the database enum | [`db/schema/enums.ts`](../db/schema/enums.ts) + [`0004_icy_lord_tyger.sql`](../db/migrations/0004_icy_lord_tyger.sql) | Done and applied to RDS |
| The e2e fixtures | [`tests/e2e/accounts.ts`](../tests/e2e/accounts.ts) | Done. Five accounts, `SCREENS[].roles` |

**Do not edit these five files.** They are what the three tracks compile against. If one of them
needs a change, it is a contract change: raise it before writing code, because two tracks
branching from different contract versions is the failure mode this whole split is designed to
prevent.

`rank` still exists on each role, and it authorises nothing — it is the display order on
`/no-access` and the tie-break when one person holds several groups. Do not reintroduce a
comparison against it.

### The frozen matrix (from runbook §3)

| Path | Screen | Collector | Operator | Officer | Viewer | Admin |
| --- | --- | :--: | :--: | :--: | :--: | :--: |
| `/dashboard` | Today (role-cut) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/intakes` **(page not built)** | My submissions (read-only) | ✓ | | | | ✓ |
| `/intake` | New intake (capture) | | ✓ | | | ✓ |
| `/pickups` | Load board | | ✓ | | | ✓ |
| `/handoff` | Collector handoff — PIN | | ✓ | | | ✓ |
| `/gate` | Recycler gate — weigh + PIN | | | ✓ | | ✓ |
| `/demo` | Handoff demo | | ✓ | ✓ | | ✓ |
| `/map` | Hotspot map (+ Call Van) | ✓ | ✓ | ✓ | ✓ RO | ✓ |
| `/map/dispatch` | Assign/clear a site | | ✓ | | | ✓ |
| `/collectors` | Collector directory | | ✓ | | | ✓ |
| `/evidence` | Evidence archive | | ✓ | ✓ brand | ✓ | ✓ |
| `/valuation` | Valuations | | | | | ✓ |
| `/validation` | Validation queue | | | | | ✓ |
| `/recyclers` | Recycler capacity | | | ✓ own | | ✓ |
| `/rates` | Rate card | | | | | ✓ |
| `/team` | Team + role assignment | | | | | ✓ |

The runbook's three "silently dropped" accesses are preserved: Officer keeps `/map`, Operator
keeps `/collectors` and `/evidence`. `/valuation` and `/validation` are **Admin only** now, and
`/gate` is the Officer's — those three are the real tightening.

### Already live in AWS (done from the CLI, verified)

- **Cognito** `ap-south-1_ArcnyY9aL`: group `eco-collector` and account `demo.collector@example.com`
  exist, the account is a member, and its ID token carries `cognito:groups: ["eco-collector"]`.
- **RDS**: migration 0004 applied. `membership_role` is
  `owner, admin, officer, operator, collector, viewer`. Postgres 16.15, so the
  `ALTER TYPE … ADD VALUE` needs no transaction workaround.
- **IAM**: user `ecoepr-team-admin`, inline policy `EcoEPRTeamRoleAdmin`, scoped to that one pool
  ARN — `ListUsers`, `ListUsersInGroup`, `AdminGetUser`, `AdminListGroupsForUser`,
  `AdminAddUserToGroup`, `AdminRemoveUserFromGroup`. The keys are in `.env.local` as
  `COGNITO_ADMIN_*`, so `/team` can change a role instead of being read-only.
- **Amplify** app `d1oj56ggqzeg50` (region `eu-north-1`, branch `main`) carries the same two keys,
  and [`amplify.yml`](../amplify.yml) now copies them into `.env.production` so the SSR compute
  can read them.
- **Lambda** `ecoepr-smart-pickup` redeployed with the role sets. Verified at the edge with real
  tokens: collector `GET /health` 200, `GET /streams` 200, `POST /pickups` 403; viewer 200 on the
  reads; anonymous 401.

### What that Lambda deploy deliberately left permissive

The Lambda's route sets are the **additive** half of runbook §5.1: an Operator may still settle a
load there today. Tightening `/settle` to Officer + Admin belongs in the release that stops
showing an Operator the gate (Track C, step 20, plus deploy 2 of step 28). This is why nothing a
live caller can do stopped working mid-deploy.

### Green and red right now

| Check | State |
| --- | --- |
| `npx tsc --noEmit` | 0 |
| `npm run lint` | 0 |
| `npm run db:check` | 0 |
| `npm run test:heatmap` | 24/24 |
| `tests/e2e/access.spec.ts` | **11/11 passing** (five roles × the full matrix, live accounts) |
| `tests/e2e/dashboard.spec.ts` | **5/5 passing** |
| `tests/e2e/team.spec.ts` | **Passing** — the five-role assertion, plus a case that proves `eco-collector` reaches the pool rather than being rejected as unknown. Was 1 failing; see §4.1 |
| `tests/e2e/pickup.spec.ts` | **Passing** as an Admin session — the only seat that holds both halves of `/demo`. §4.2 option (a) is still the faithful version; read §4.2 before starting Track C |
| The whole battery, `npm run test:e2e` | **88 passing, 1 skipped**, on the Track A + Track B merge (89 cases). The skip is `team.spec.ts`'s unconfigured-pool case, which is deliberate |

The battery's first run is what found the last of it: 67 passed, 3 failed, and the one
deliberate skip. One of the three is §4.2's, and the other two are specs this document's
step 25 table did not know were broken — step 25 in §3 now lists all four.

`access.spec.ts` and `dashboard.spec.ts` were rewritten as part of the contract because the
typecheck required it (they read `ROLE_RANK` and `SCREENS[].minRank`, which no longer exist).
That means part of runbook step 25 is already done.

---

## 2. Phase B — the three tracks

Each track ends with its own gate. Run the gate before you push; a track that lands red costs the
person merging it more than it cost you to run `tsc`.

### Track A — auth surface + the shell (person 1, steps 10–13)

**Owns:** [`app/(auth)/no-access/page.tsx`](../app/(auth)/no-access/page.tsx) ·
[`app/(product)/team/page.tsx`](../app/(product)/team/page.tsx) ·
[`components/features/product/team/role-picker.tsx`](../components/features/product/team/role-picker.tsx) ·
[`lib/auth/pool.ts`](../lib/auth/pool.ts) ·
[`app/api/team/role/route.ts`](../app/api/team/role/route.ts) ·
[`components/layout/product-shell.tsx`](../components/layout/product-shell.tsx) ·
[`components/layout/auth-shell.tsx`](../components/layout/auth-shell.tsx)

- **Step 10 — `/no-access` explains a role set.** The page still renders the five roles as a
  numbered **ladder** sorted by `rank`, under the heading "The role ladder", with `01`–`06` in the
  gutter. That framing is now wrong: role sets have no order and the numbers are decoration. Keep
  the list, drop the "ladder" language and the numbering (or replace the number with what the role
  opens), and make sure the refusal copy renders `verdict.guard.requirement`, which now reads
  "Admin only" / "Operator or Admin" rather than "officer or above".
- **Step 11 — the fifth role is grantable.** `app/api/team/role/route.ts` validates
  `Object.keys(ROLES)`, so `eco-collector` is already accepted and appears in its error message.
  Confirm `RolePicker` lists it (it maps over `ROLES`), and confirm `setPoolRole`'s add-then-remove
  still leaves exactly one group for a person who was in another role.
- **Step 12 — the shell stops asserting work the viewer cannot do.**
  `product-shell.tsx` calls `listPendingHolds(100)` and `listLoads(100)` for *every* signed-in user
  and badges `/validation` from the result. Under the new matrix only an Admin may open
  `/validation`, so those two reads must be conditional on the role, and the badge must not be
  counted for people who cannot act on it.
- **Step 13 — gate:** `npx tsc --noEmit && npm run lint`.

### Track B — the screens (person 2, steps 14–18)

**Owns:** [`lib/data/product-nav.ts`](../lib/data/product-nav.ts) ·
[`components/layout/product-nav.tsx`](../components/layout/product-nav.tsx) ·
[`components/ui/role-link.tsx`](../components/ui/role-link.tsx) ·
[`app/(product)/dashboard/page.tsx`](../app/(product)/dashboard/page.tsx) ·
[`app/(product)/map/page.tsx`](../app/(product)/map/page.tsx) ·
new `app/(product)/intakes/page.tsx` · new `components/features/collector/call-van-button.tsx`

- **Step 14 — nav and links.** `product-nav.ts` needs the Collector's entries; `product-nav.tsx`
  already filters with `canOpen` and follows the matrix by itself.
- **Step 15 — the role-cut dashboards.** `dashboard/page.tsx` already cuts cards with `mayOpen`, so
  the matrix does most of it. Add the Collector's personal tiles (intakes today, items priced, net
  promised) and the Viewer's Compliance Gauge. **Call the Step 19–21 readers with the frozen
  `Scope` signature — do not edit the read layer.**
- **Step 16 — the Collector's own submissions.** New `app/(product)/intakes/page.tsx`, a read-only
  history of what this collector submitted and what it was valued at. The guard for `/intakes`
  already exists in `roles.ts` (Admin + Collector), so the page is protected the moment it is
  created; until step 20 lands it should render the readers' honest "not configured" sentence
  rather than an empty table. **Add its row to `SCREENS` in `tests/e2e/accounts.ts` when the page
  exists** — that is the one edit to a Phase A file that is expected, and it is Track B's.
- **Step 17 — `[Call Van]` and the read-only map.** New
  `components/features/collector/call-van-button.tsx` using
  `navigator.geolocation.getCurrentPosition` (the consent pattern already exists in
  [`consent-banner.tsx`](../components/layout/consent-banner.tsx)), then a `POST` that drops an
  "open site" pin — reuse [`app/api/heatmap/dispatch/route.ts`](../app/api/heatmap/dispatch/route.ts)
  if the payload fits, otherwise add a route with the same `authorizeUser` guard. Then the
  read-only map for Collector / Viewer / Officer in `map/page.tsx`. Note `map/page.tsx` computes
  `canDispatch = canOpen("/map/dispatch", …)` for a control, so under the new matrix an **Officer
  loses the dispatch control** — that is intended (§3), and the read-only variant is what replaces
  it for them.
- **Step 18 — gate:** `npx tsc --noEmit && npm run lint`.

### Track C — the read layer and realtime (person 3, steps 19–23)

**Owns:** [`lib/records/queues.ts`](../lib/records/queues.ts) ·
[`lib/pickup/directory.ts`](../lib/pickup/directory.ts) ·
[`lib/s3/media-assets.ts`](../lib/s3/media-assets.ts) ·
[`app/api/pickup/`](../app/api/pickup/) · [`app/api/media/read/route.ts`](../app/api/media/read/route.ts) ·
[`components/features/handoff/`](../components/features/handoff/) ·
[`app/(product)/evidence/page.tsx`](../app/(product)/evidence/page.tsx) ·
[`app/(product)/collectors/page.tsx`](../app/(product)/collectors/page.tsx) ·
[`app/(product)/recyclers/page.tsx`](../app/(product)/recyclers/page.tsx) ·
[`tests/e2e/pickup.spec.ts`](../tests/e2e/pickup.spec.ts)

- **Step 19 — scope the Postgres reads.** `storedCounts(scope)`, `listRecentEvents(scope, n)`,
  `listPendingHolds(scope, n)`. `scope` is the **first** parameter. The compiler finds the call
  sites; every existing caller must pass one.
- **Step 20 — scope the pickup reads, and set the route role sets.** `listLoads(scope, n)`,
  `listCollectorActivity(scope, n)`, plus `getLoad`. Then provision the collector identity
  (§4.3), or `{ kind: "collector" }` filters an empty set. **Then the route role sets — and read
  §4.2 first, because the obvious mapping is what is breaking `pickup.spec` today.**
- **Step 21 — scope the evidence read.** `listEvidence(scope)`, filtering to the credits the brand
  claimed. Blocked on the `epr_credit_notes` writer (§4.4): until it exists, return the honest "no
  claim on file" sentence rather than an empty list. Then `evidence/page.tsx`,
  `collectors/page.tsx` and `recyclers/page.tsx` pass a scope and render its error sentence.
- **Step 22 — handoff: keep polling, tighten it.** No WebSockets, no SSE. Lower the poll interval
  and add an optimistic "settling…" state so the person at the gate sees it working before the
  poll lands. Keep the 20-second assertion in `pickup.spec.ts` as the acceptance test.
- **Step 23 — gate:** `npx tsc --noEmit && npm run lint`, then `npm run test:heatmap` and
  `npm run test:rates`.

---

## 3. Phase C — land and verify (all three, steps 24–30)

1. **Step 24 — merge A → B → C.** A first (it is the most-consumed contract), C last (it changes
   function signatures, so B's rebase is mechanical). After **each** merge:
   `npx tsc --noEmit && npm run lint`.
2. **Step 25 — the specs the matrix breaks.** Remaining work:

   | Spec | State |
   | --- | --- |
   | [`access.spec.ts`](../tests/e2e/access.spec.ts) | **Done** in Phase A |
   | [`dashboard.spec.ts`](../tests/e2e/dashboard.spec.ts) | **Done** in Phase A |
   | [`global-setup.ts`](../tests/e2e/global-setup.ts) | **No edit needed** — it iterates `ACCOUNTS`, so it signs in five accounts already |
   | [`team.spec.ts`](../tests/e2e/team.spec.ts) | **Done** — the assertion reads five role names, and the file proves the Collector is accepted rather than turned away. §4.1 |
   | [`pickup.spec.ts`](../tests/e2e/pickup.spec.ts) | **Passing, not yet the faithful test** — it runs as Admin, which holds both halves of `/demo`. The two-session rewrite is §4.2 option (a) and Track C's step 22 |
   | [`gatekeeper.spec.ts`](../tests/e2e/gatekeeper.spec.ts) | **Was missing from this table.** Every positive case ran as the officer against `/validation` and `/api/ai/gatekeeper` — both Admin-only now — so it timed out at a file input that never rendered and, being a serial file, skipped the three tests behind it. **Done**, on the Admin seat; the operator refusal stays |
   | [`valuation.spec.ts`](../tests/e2e/valuation.spec.ts) | **Was missing too.** `/valuation`, `/validation` and `/api/validation/decision` are Admin-only, so one officer timeout hid all twelve cases in the file. **Done**, on the Admin seat; the operator and viewer refusals stay |
   | [`screens.spec.ts`](../tests/e2e/screens.spec.ts), [`public.spec.ts`](../tests/e2e/public.spec.ts) | No edit; they read only `.path` / `.title` and run as admin, who keeps every seat. Adding `/intakes` to `SCREENS` gets it a render check for free — do not "fix" these |

3. **Step 26 — the full battery:** `npx tsc --noEmit`, `npm run lint`, `npm run db:check`,
   `npm run test:heatmap && npm run test:rates`, `npm run test:e2e`.
4. **Step 27 — the matrix walk.** Sign in as all five accounts and for every row of the matrix
   either the screen opens or you land on `/no-access?from=…&need=…`. `access.spec.ts` automates
   this; do it by hand once as well.
5. **Step 28 — deploy additively, then tighten.** Deploy 1 is **already done for the Lambda**;
   what remains is the app release with `security.mjs` and `roles.ts` in it (the app deploy
   carries the branch's `roles.ts`, and the Lambda's route sets tighten in the same release), then
   the second deploy that removes the remaining Operator seat on `/settle`.
6. **Step 29 — the docs.** [`README.md`](../README.md) says "four roles, one enforced access table"
   in its status table; it becomes five, and the demo-account table gains
   `demo.collector@example.com`.
7. **Step 30 — only now start the visual redesign.** It touches `dashboard/page.tsx`,
   `product-nav.tsx` and most of `components/ui/*` — the same files this migration is editing.

---

## 4. Open decisions and known traps

### 4.1 The fifth role in `team.spec.ts` — fixed on Track A

[`team.spec.ts:33`](../tests/e2e/team.spec.ts#L33) asserts the role-change route's message contains
`eco-admin, eco-officer, eco-operator, eco-viewer`. The route now answers

```
Role must be one of eco-admin, eco-officer, eco-operator, eco-collector, eco-viewer.
```

The route is correct — the fifth role *is* grantable — so the assertion is what changes. This is
runbook step 25's "becomes five". **Taken**, on Track A: the assertion lists five names, and a
new case in the same file asks the route for `eco-collector` against a username no pool holds —
a role it did not know would be refused with a 400, so the pool's 404 is what proves the fifth
role passes validation. It changes no real account's role, deliberately: these five accounts are
what `access.spec.ts` walks.

### 4.2 The demo screen cannot be driven end-to-end in one session — still open

**This is verified, not theoretical.** `pickup.spec.ts` runs the whole flow in one session as the
**operator** and now fails: the handover succeeds and the PIN renders, the gate loads the load and
prefills the weighbridge, and then the price preview never appears, because the gate fetches
`GET /api/pickup/streams` to price it and that route is authorized against `/gate` — which an
Operator no longer holds.

The cause is that the app's pickup routes are gated against one screen each, and after the split
those screens have different seats:

| Route the screens call | Authorized against | Who passes now | Who needs it |
| --- | --- | --- | --- |
| `POST /api/pickup/handoff` | `/handoff` | Admin, Operator | the phone ✓ |
| `POST /api/pickup/[id]/pin` | `/handoff` | Admin, Operator | the phone ✓ |
| `GET /api/pickup/[id]` | `/handoff` | Admin, Operator | **the gate too** — an Officer is refused |
| `GET /api/pickup/[id]/events` | `/gate` | Admin, Officer | the gate ✓ |
| `GET /api/pickup/streams` | `/gate` | Admin, Officer | **the gate's pricing, so an Operator driving `/demo` is refused** |
| `POST /api/pickup/[id]/settle` | `/gate` | Admin, Officer | the gate ✓ |

Two things follow, and they are different problems:

1. **The reads must be open to the union of the seats that read them** (Admin, Officer and
   Operator), because a load's own row and the stream catalogue are read by *both* ends of the
   handoff. Leaving them on one seat's guard is what makes an Officer unable to weigh a load at
   all. This one is unambiguous and belongs to Track C step 20.
2. **`/demo` is a single page with both halves, and its two halves now need two different seats.**
   `/demo` opens for Operator + Officer + Admin (§3), but the phone half needs `/handoff` and the
   gate half needs `/gate`. So no single session can drive `/demo` end-to-end except an Admin, and
   even an Admin is only able to because Admin happens to be in both sets.

   The options, and the runbook does not pick one for you:

   - **(a) Two sessions — recommended.** One browser signed in as the Operator drives the phone,
     one signed in as the Officer drives the gate. This is the model the migration describes, it
     needs no code beyond (1), and it makes `pickup.spec.ts` a two-session test. The 20-second UPI
     assertion survives: the Operator's phone polls and flips when the Officer settles — which is
     exactly what runbook §5.2 describes.
   - **(b) Widen the demo's writes.** Authorize the demo's `settle` against `/demo`'s own seat set.
     Keeps the one-session demo, but it hands the Operator the ability to settle through one route,
     which is the seat the migration is deliberately removing.
   - **(c) Retire `/demo` as an interactive flow** and make it a read-only explainer of the two
     sides. Cheapest to make true, and it removes the split-screen demo that the write-up leans on.

   Decide this before Track C starts step 20, because it decides what `pickup.spec.ts` becomes.

   **Where this stands now, after the first full battery run.** `pickup.spec.ts` runs its five
   cases as an **Admin** session — the only seat holding both `/handoff` and `/gate` — so the flow
   itself is covered end to end today, including the 20-second UPI assertion, wrong-PIN refusal and
   the audit trail. Nothing in the application changed to get that: no seat was widened, and
   `/settle` is still Officer + Admin. What is *not* covered by that shape is the two seats driving
   the two halves separately, which is the point of option (a) and the reason it stays open.

### 4.3 The Collector's dashboard has nothing to filter on

`{ kind: "collector", userId }` filters by `users.cognito_sub`, but nothing links a submission to a
collector yet: `lib/pickup/directory.ts` says outright that nothing provisions a collector record,
and `StoredItem.collectorId` is "null in the normal case today". Provision a collector row at
intake keyed to `users.cognito_sub`, or read from `intakes.uploader_user_id`. Until then the
Collector's role-1 dashboard is a filtered screen over an empty set. This is the item most likely
to move the date.

### 4.4 The Viewer's evidence has no rows to scope to

The filter is `epr_credit_notes` → brand claim, and that table has **no writer yet**, which is why
`StoredValuation.eprCreditNote` is always `null`. Viewer sees an empty archive until it is built.
Track C step 21 returns the honest "no claim on file" sentence instead of an empty list until then.

### 4.5 `scopeFor` and the one extension to the frozen §4

`Scope` gained a fifth variant, `{ kind: "unresolved"; reason }`. §4's four kinds cannot express
"this Officer's facility is not on file", and without it `scopeFor` would have had to widen to
`{ kind: "all" }` — a data leak that renders as a working page. `scopeRefusal(scope)` turns it into
the sentence a reader returns. The Officer's `facilityId` and the Viewer's `organizationId` are
joins (`organization_members`), not token claims, so they are passed into `scopeFor` as
`ScopeIdentity` and the read layer resolves them. If you disagree with the extension, raise it
before Track B and C both build on it.

### 4.6 There is no `/map/dispatch` page

`/map/dispatch` has a guard and no page: the dispatch action lives in
`app/api/heatmap/dispatch/route.ts` and the control that calls it is on `/map`, gated by
`canOpen("/map/dispatch", role)`. Leave it that way unless Track B decides the action deserves a
screen of its own — but then the guard, the control and the route have to move together.

---

## 5. Environment, accounts and commands

`.env.local` already holds everything: the pool settings, `DATABASE_URL`, the Azure and S3 keys,
`PICKUP_API_URL` and the `E2E_PASSWORD` all the demo accounts share. Nothing new has to be set up
to start work.

**Accounts** (password: the shared `E2E_PASSWORD`; never commit it):

| Role | Email | Group |
| --- | --- | --- |
| Admin | `demo.admin@example.com` | `eco-admin` |
| Officer | `demo.officer@example.com` | `eco-officer` |
| Operator | `demo.operator@example.com` | `eco-operator` |
| **Collector (new)** | `demo.collector@example.com` | `eco-collector` |
| Viewer | `demo.viewer@example.com` | `eco-viewer` |
| Admin (legacy) | `demo.owner@example.com` | `eco-owner`, which continues to read as Admin |

**The gates, in the order the tracks run them:**

```bash
npx tsc --noEmit
npm run lint
npm run db:check
npm run test:heatmap            # and npm run test:rates for Track C
npx playwright test tests/e2e/access.spec.ts     # the contract's own acceptance test
npm run test:e2e                # Phase C only: spends real Azure money on the AI specs
```

**Mint a token for any role and call the deployed API** — this is how the Lambda's behaviour was
verified, and it works for any role without touching a browser:

```bash
# Read a value out of .env.local. `sed`, not `grep -oP`: Git Bash on Windows refuses
# `-P` ("supports only unibyte and UTF-8 locales"), and the empty value it returns fails
# as a confusing AWS endpoint error rather than as a missing variable.
envval() { sed -n "s/^$1=//p" .env.local | tail -1; }

REGION=$(envval COGNITO_REGION)
CLIENT=$(envval COGNITO_CLIENT_ID)
PASSWORD=$(envval E2E_PASSWORD)
API=$(envval PICKUP_API_URL)

TOKEN=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id "$CLIENT" \
  --auth-parameters USERNAME=demo.collector@example.com,PASSWORD="$PASSWORD" \
  --region "$REGION" --query AuthenticationResult.IdToken --output text)

curl -s -o /dev/null -w 'collector /streams -> %{http_code}\n' \
  -H "authorization: Bearer $TOKEN" "$API/streams"     # 200
curl -s -o /dev/null -w 'no token  /streams -> %{http_code}\n' "$API/streams"   # 401
```

**Redeploy the Lambda** (idempotent — updates the function code and configuration and leaves the
tables alone):

```bash
npm run pickup:setup
```

`scripts/pickup-setup.sh` packages the sources with `zip` **or** Python's `zipfile`, whichever is
present. Both paths put the files at the **root** of the archive — checked, the Python fallback
writes `index.mjs` and not `./index.mjs` — which matters because Lambda looks for `index.handler`
at the top level: an archive with a directory prefix deploys a function that cannot find its
handler and answers every route with a 502. There is no `zip` on this machine, so the Python path
is the one that runs here.

When you only want the new code in (no IAM, route or table changes), the script's two steps can be
run on their own. This is the form Phase A used, and the form deploy 2 in step 28 wants:

```bash
python -c "import glob,os,zipfile;z=zipfile.ZipFile('dist/ecoepr-smart-pickup.zip','w',zipfile.ZIP_DEFLATED);[z.write(p,os.path.basename(p)) for p in glob.glob('aws/pickup/*.mjs')];z.close()"
aws lambda update-function-code --function-name ecoepr-smart-pickup --region ap-south-1 \
  --zip-file fileb://dist/ecoepr-smart-pickup.zip
aws lambda wait function-updated --function-name ecoepr-smart-pickup --region ap-south-1
```

After an update, `aws lambda get-function-configuration --function-name ecoepr-smart-pickup
--region ap-south-1 --query '[State,LastModified,CodeSha256]' --output text` should read `Active`
with a `LastModified` from the last minute; a `CodeSha256` that did not change means the upload
did not land.

**Check the database enum:**

```bash
npm run db:check
node --env-file=.env.local -e 'const{Client}=require("pg");(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query(`select enumlabel from pg_enum join pg_type t on t.oid=enumtypid where t.typname=$1 order by enumsortorder`,["membership_role"]);console.log(r.rows.map(x=>x.enumlabel).join(", "));await c.end()})()'
```

**The matrix check.** Phase A verified the frozen matrix before handing it over, with a throwaway
script at `dist/rbac-contract-check.mts`: all five roles against all sixteen paths, no `requirement`
string still promising "or above", the prefix matching (`/intakes` is not beneath `/intake`), and an
unresolved scope failing closed. **That file is in nobody's history** — `dist/` is ignored build
output, so it was never committed and it is not on this branch, and it will be gone the first time
something cleans `dist/`. The **committed** acceptance test for the matrix is
[`tests/e2e/access.spec.ts`](../tests/e2e/access.spec.ts), which walks every path as every role
against the live pool: run that one, and do the walk by hand once as step 27 asks.

---

## 6. Definition of done, per track

- **Track A:** `/no-access` explains five roles without the word "ladder" and without a numeric
  rank; the Collector is grantable from `/team`; the shell's two counts are read only for people
  who can act on them. `tsc` 0, `lint` 0.
- **Track B:** the Collector has a nav group, a dashboard and a read-only `/intakes`; Viewer and
  Officer get read-only map variants; `[Call Van]` drops a pin. `tsc` 0, `lint` 0, and
  `screens.spec.ts` passes with `/intakes` in `SCREENS`.
- **Track C:** every reader takes `scope` first and every caller passes one; the pickup routes'
  role sets are decided and applied, with §4.2 resolved; the handoff still polls and the 20-second
  assertion holds. `tsc` 0, `lint` 0, `test:heatmap`, `test:rates`, `pickup.spec.ts`.
- **Phase C:** the full battery green, the matrix walked by hand once, the README says five roles,
  and the app + Lambda ship in one release.
