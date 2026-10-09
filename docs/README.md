# EcoEPR — every screen, and what is still missing

An inventory of what each page in this app actually does, taken from the source rather
than from the write-ups, and a list of the capabilities that are not built.

**Scope:** 21 pages, 5 layouts, 9 route handlers, as counted on 10 Oct 2026.

**Method, stated so it can be checked:** every claim below was produced by reading the
files and running the commands in [How to re-verify](#how-to-re-verify). This is a
source audit, not a browser walkthrough: it does not claim that a screen *looks* right,
only what it reads, what it can send, and what it cannot do. One file is not read in
full — `components/features/ai/live-analysis.tsx`, whose endpoints are all present and
gated, so a subtly unreachable branch inside that one panel is the only thing this
document could have missed.

---

## How the pages get their data

| Fact | Evidence |
|---|---|
| **No page or component imports `@/db` directly.** | Nothing under `app/` or `components/` imports the database module. |
| The only database code in the repository is the media archive | `lib/s3/media-assets.ts` — a `media_assets` insert, the listing the evidence screen reads, and a `users` lookup by `cognito_sub`. |
| **One screen reads the database: the evidence archive.** | `app/(product)/evidence/page.tsx` lists archived objects through `lib/s3/media-assets.ts`; every other product screen reads fixtures. |
| **16 of 21 pages render fixtures**; the 5 that do not are the four auth pages and the evidence screen | Every page except `app/(auth)/*` and `app/(product)/evidence/` imports from `@/lib/data`. |
| **Only six components can respond to a click** | `live-analysis`, `intake-console`, `decision-queue`, `evidence-viewer` (all `features/`), plus the two nav rails in `components/layout/`. |
| **Nine route handlers exist** | 3 AI, 5 auth, 1 media read. There is no endpoint for pickups, collectors, recyclers, dispatch or settlement. |
| **No dead links.** | Every `href` and form `action` resolves to a route that exists. The gaps are capabilities, not broken navigation. |

So the shape is: a real AI pipeline, a real auth boundary, a real media archive with one
screen that reads it back — and a complete, honest interface over sample data, with no way
to change state from any screen.

---

## Public pages

| Page | File | Renders | Live | Missing |
|---|---|---|---|---|
| Landing `/` | `app/(landing)/page.tsx` | Pitch over fixtures; reads no session, so it is the same for everyone | links only | — |
| Docs `/doc` | `app/doc/page.tsx` | The feature index, ranked | — | — |
| Write-ups | `app/doc/features/<slug>/page.tsx` for `intake`, `valuation`, `gatekeeper`, `pickup`, `heatmap`, `roadmap` | Static prose over fixtures | — | — |

## Auth pages

| Page | File | Renders | Live | Missing |
|---|---|---|---|---|
| Sign in | `app/(auth)/login/page.tsx` | Form → `POST /api/auth/sign-in` (`USER_PASSWORD_AUTH`) | **yes** | password reset, MFA |
| Create account | `app/(auth)/signup/page.tsx` | Form → `POST /api/auth/sign-up` | **yes** | role choice, by design |
| Confirm | `app/(auth)/confirm/page.tsx` | Code form + resend, address read from an httpOnly cookie | **yes** | password reset |
| No access | `app/(auth)/no-access/page.tsx` | The role ladder with the caller's own rung marked | **yes** | role self-service, by design |

## Product pages

| Page | File | Renders | Live | Missing |
|---|---|---|---|---|
| Dashboard | `app/(product)/dashboard/page.tsx` | Fixture stats, activity feed, ward meters, "Needs attention" counts | — | every figure is a fixture; no query backs any count |
| Intake | `app/(product)/intake/page.tsx` | **Live analysis** (photo + Hindi audio → Foundry, transcribed by Azure Speech), a four-fixture console, a fixture table | **the AI only** | no `intakes` row is written; stats and the "Intakes captured" table are fixtures |
| Valuations | `app/(product)/valuation/page.tsx` | **Live analysis**, a fixture queue with assay, receipt and gatekeeper decision | **the AI only** | nothing is persisted; the queue never grows; no approve or route action |
| Validation queue | `app/(product)/validation/page.tsx` | **Live analysis**, fixture decisions, and a queue that records decisions in component state | **the AI, plus session-local decisions** | decisions vanish on reload (the panel says so); metrics are fixtures |
| Pickups | `app/(product)/pickups/page.tsx` | Fixture board, transit timeline, credit note, withheld-payout case | — | no pickup creation, no status change, no van assignment, no settlement |
| Evidence archive | `app/(product)/evidence/page.tsx` | Recent archived objects with kind, size, digest, time and uploader, and a signed read per object | **the database and the read API** | nothing ties an object to the submission or valuation it came from; attribution is usually null; no retention policy |
| Collectors | `app/(product)/collectors/page.tsx` | Fixture roster, credits share, language coverage | — | no collector records, no per-collector ledger, no search or filter (server-rendered) |
| Recyclers | `app/(product)/recyclers/page.tsx` | Fixture directory, capacity allocation, licence watch | — | registration numbers are not verified against anything |
| Hotspot map | `app/(product)/map/page.tsx` | Fixture scatter, ward list, priority round, hotspot table | — | no geometry, no basemap, no clustering service, no live tracking, no dispatch |

---

## Features still to be implemented

1. **Persistence.** Beyond `media_assets`, nothing is written: no `users` row on first
   sign-in, no `intakes`, no `valuations`, no gatekeeper decisions, no `pickups`, no
   credit notes, no `ledger_entries`. `organization_members` has no writer at all.
2. **Every mutating action.** Nothing can approve a held item, route a load, assign a
   van, or settle a note. The map's round links "Send a van to…" to `/pickups`, which is
   read-only — a deliberate dead end rather than a thin one.
3. **Evidence screen — built, with a residual gap.**
   `app/(product)/evidence/page.tsx` lists the archive and
   `components/features/evidence/evidence-viewer.tsx` is the only caller of
   `GET /api/media/read`, so the photo and voice note behind a submission can finally be
   seen from the product. What is still missing is the *join*, not the screen: nothing
   links an object to the submission or valuation that produced it.
4. **The gatekeeper's evidence.** Precision `0.94`, recall `0.87`, F1 `0.90`, ROC-AUC
   `0.96` and a 1,840-item holdout "last trained 06 Oct 2026" are hardcoded in
   `lib/data/model.ts`. There is no training, no holdout and no classifier: rules R-01–R-04
   are prompt instructions validated against a closed list in `lib/ai/proposal.ts`.
5. **Auth gaps.** No `ForgotPassword` / `ConfirmForgotPassword` screens or routes, no
   MFA, no refresh (sessions end after an hour), no user-management UI, and no mirror of
   identity or roles into Postgres.
6. **Channels.** WhatsApp intake, the low-data Android app with an offline queue, and
   missed-call IVR are all unstarted, ranked 6 and below.
7. **Vendor path.** The Bedrock and Amazon Transcribe route is unwritten; Microsoft
   Foundry and Azure Speech stand in.
8. **Deployment.** `amplify.yml` deliberately keeps `DATABASE_URL` out of
   `.env.production`, so on the deployed app the media archive writes objects while
   `records.configured` stays false — objects archived, rows not recorded.

---

## Four strings that claim more than the code does

Each is a one-line fix against a capability that genuinely does not exist yet.

| Where | Claim | Reality |
|---|---|---|
| `app/(product)/intake/page.tsx` | "Audit trail — the parsed record is kept before valuation, so nothing is priced off thin air." | No `intakes` row is written. Only the S3 object and its `media_assets` row outlive the request. |
| `app/(product)/map/page.tsx` | Section heading "The same numbers, sortable". | The list is sorted by density on the server and numbered; there is no client-side sort control. |
| `app/(product)/collectors/page.tsx` | "Standing is earned on pickup history, not typed in by an operator." | Tiers are hardcoded fixture values. |
| `components/features/product/map/van-round.tsx` | "Send a van to <ward> →". | Links to a pickups board that cannot assign or create anything. |

The map screen is the one that states its own limits plainly — normalised coordinates
rather than a basemap, a priority list rather than a route, and never live tracking. That
is the standard the four rows above should meet.

---

## How to re-verify

```bash
# 1. nothing under app/ or components/ touches the database
grep -rn 'from "@/db' app components || echo "no db access"

# 2. how many pages render fixtures
for f in $(find app -name page.tsx); do grep -q 'from "@/lib/data' "$f" && echo "$f"; done | wc -l

# 3. which components are interactive
grep -rl '"use client"' components

# 4. who consumes the archived evidence (expect the viewer, plus one comment in roles.ts)
grep -rln "api/media/read" app components lib | grep -v "app/api/media/read/route.ts" || echo "no caller"

# 5. every link resolves (route groups ignored)
find app -name page.tsx -o -name route.ts \
  | sed -E 's|^app||; s|/page.tsx$||; s|/route.ts$||; s|\([^)]*\)/?||g; s|^$|/|' | sort -u

# 6. the gatekeeper's metrics are fixtures
sed -n '1,45p' lib/data/model.ts
```

Route counts at the time of writing: 21 pages, 5 layouts, 9 route handlers.
