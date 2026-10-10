# ImpactProof / EcoEPR

A vernacular AI bridge that turns informal kabadiwalas into digitised frontline
workers — moving toxic e-waste into CPCB-registered recyclers while generating
verifiable brand EPR credit.

**One line:** photo or Hindi voice note in → metal assay and EPR valuation out →
routed to a licensed recycler → digital credit note issued to the collector.

**Problem:** India generates 3.2M+ tonnes of e-waste a year. Over 90% flows through
informal scrap collectors with no safety protocol and no paper trail, while brands
carry a legal EPR mandate from CPCB with no reliable way to prove compliance.

---

## Status at a glance

The pipeline is real. The data underneath it is not. Both halves are stated here so
nothing has to be discovered by reading code.

| Area | State |
|---|---|
| Live AI pipeline (Microsoft Foundry) | **Real** — three working endpoints, closed-list validation |
| Authentication & roles (Cognito) | **Real** — JWKS verification, httpOnly session, enforced role matrix |
| Product screens | **Built** — 9 role-gated screens; the evidence archive and the hotspot map read live data, the rest render fixtures |
| Doc site | **Built** — 6 feature write-ups, public |
| Media archive (S3) | **Real** — every submitted photo and voice note is written to `impact-proof-bucket` under a content-addressed key |
| Intake records | **Real** — an analysed submission with evidence writes `intakes`, `items`, `material_lines`, `item_hazards`, `gatekeeper_verdicts` and, with a GPS fix, a `geopoints` row |
| Hotspot map | **Real** — live geotagged intakes clustered on real BMC ward boundaries over an OpenStreetMap basemap; empty, and saying so, until real intakes arrive |
| Database schema | **Applied to real RDS, partly wired** — 39 tables; media, intake and geo tables are read and written, the rest are not |
| Money | **Simulated** — no payout, no ledger writes |

---

## What is built

### The AI pipeline

Three endpoints under [`app/api/ai/`](app/api/ai), backed by
[`lib/ai/`](lib/ai):

| Endpoint | Does |
|---|---|
| `POST /api/ai/intake` | Photo and/or Hindi audio in; transcript, extracted fields and the priced item back in one round trip |
| `POST /api/ai/valuation` | Identify, assay, price and gate one submission |
| `POST /api/ai/gatekeeper` | The same pass, answered as a `valid` / `held` / `rejected` decision with the rule that fired |

The pipeline runs on **Microsoft Foundry**, over its OpenAI-compatible chat completions
API. The deployment is named by `AZURE_OPENAI_DEPLOYMENT` (currently `gpt-4.1-mini`)
and every screen shows which model actually answered.

**The Hindi voice note is a second call.** Foundry's vision deployment cannot read audio,
and this subscription's region policy and per-model quotas admit no audio-capable model
(the `gpt-audio` family) and no Whisper. So the voice note is transcribed first by
**Azure Speech** (`hi-IN`, in the same account) and the verbatim transcript is handed to
the model as the collector's own words. Two calls, one answer: `lib/ai/transcribe.ts`
hears the audio, `lib/ai/foundry.ts` reads the photograph and the transcript. A silent
clip returns no transcript rather than an invented one — the model never sees audio.

**The one design decision worth defending: the model never states a rupee figure.**
It returns an item class from a closed list, material ids with mass estimates, and a
verdict with a confidence. Every price is computed on the server from the rate card in
[`lib/data/rate-card.ts`](lib/data/rate-card.ts), and a reply whose ids or verdict fall
outside those closed lists is discarded rather than guessed at. The money is arithmetic
a reviewer can check line by line — which is what makes the valuation defensible in an
audit instead of a number a language model produced.

### The media archive

The photo or voice note behind a valuation is written to S3 as it passes through, so
the evidence outlives the request that priced it — `db/schema/intake.ts` has always
reserved `media_assets.storage_key` for exactly this. Keys are content-addressed (the
SHA-256 of the bytes, under a `media/` prefix), so the same file submitted twice is one
object, a retry cannot duplicate evidence, and S3 verifies the digest on write rather
than accepting a truncated upload.

The archive runs **beside** the model call, not after it, and can never fail the
request: a storage fault is reported in `storage.error` and in the response's warnings,
while a model call that fails still leaves the submission archived. With no bucket
configured the routes analyse and price exactly as they did before and report the
archive as off.

Bucket, IAM policy, key layout and its honest gaps are in
[`docs/s3-media-archive.md`](docs/s3-media-archive.md).

### Spatial heatmapping

`/map` clusters geotagged intakes into collection sites on Mumbai's real ward map.

- **Capture.** The intake screen takes a GPS fix with one explicit tap and lets the
  operator pick the collector (walk-in by default). `lib/intake/record.ts` files the
  submission — intake, item, material lines, hazards, gatekeeper verdict and geopoint —
  in one transaction, idempotent on the evidence row, and never fails the request.
- **Wards.** The 24 BMC administrative wards with real boundaries, from DataMeet's open
  data (CC BY-SA 2.5 India), simplified to 56 KB by `npm run geo:wards`. Points are filed
  by point-in-polygon; there is no PostGIS.
- **Clustering.** On every read: ~150 m geohash cells (precision 7); four or more
  detections in 21 days make a cell hot; touching hot cells are one site. Gatekeeper-
  rejected items never count. The rule is one pure function, `lib/heatmap/cluster.ts`,
  covered by `npm run test:heatmap`.
- **Map.** MapLibre GL on an OpenFreeMap basemap — open source end to end, no key.
  Wards shaded by relative pressure, heat weighted by recency, sites at true radius.
- **Dispatch.** Operators and above can assign a van, clear or reopen a live site
  (`POST /api/heatmap/dispatch`, guarded at `/map/dispatch`); only that decision is stored.
- **Real data only.** No sample, fixture or fallback. With no geotagged intakes the map is
  empty and tells the operator how to fill it. The dashboard's hotspot figures come from
  the same computation; the public write-up shows only the real ward geography.

Design, privacy and gaps: [`docs/spatial-heatmapping.md`](docs/spatial-heatmapping.md).

### Authentication and roles

Cognito holds the credentials; the access matrix holds the authority. Sign-in goes
through `USER_PASSWORD_AUTH` with the app's own forms — not the hosted UI. Sessions are
id tokens in an httpOnly cookie, verified against Cognito's real JWKS on every request.

```
proxy.ts              optimistic redirect per request (NOT the boundary)
lib/auth/dal.ts       requireAccess() — the real check, per page
lib/auth/roles.ts     the access matrix, one table, three readers
```

Five roles, ranked owner → admin → officer → operator → viewer. A user opens a screen
when their rank is ≤ the screen's minimum. A signed-in account with no group opens
nothing and lands on `/no-access`, which shows the whole ladder with the caller's own
role marked.

Full detail, including the reasoning behind each choice and the list of gaps, is in
[`docs/auth.md`](docs/auth.md).

### Screens

| Screen | Path | Minimum role |
|---|---|---|
| Landing | `/` | public |
| Dashboard | `/dashboard` | any |
| Hotspot map | `/map` | any |
| Intake | `/intake` | operator |
| Pickups | `/pickups` | operator |
| Collectors | `/collectors` | operator |
| Evidence archive | `/evidence` | operator |
| Valuations | `/valuation` | officer |
| Validation queue | `/validation` | officer |
| Recyclers | `/recyclers` | officer |
| Docs | `/doc`, `/doc/features/*` | public |

The core loop is four of these: intake → valuation → gatekeeper → pickup. The
gatekeeper sits after valuation but before anything is promised to a collector, so a
credit is only minted once the item clears the valid/invalid boolean. Heatmapping reads
the same pickup stream afterwards.

### Database schema

[`db/schema/`](db/schema) models the whole domain: 39 tables, 24 Postgres enum types
and 70 foreign keys, **generated, migrated and applied** to AWS RDS for PostgreSQL 16.

Money is `bigint` **paise** with a `_paise` suffix; mass is `numeric(12,2)` **grams**
with a `_g` suffix; scores are `numeric(4,3)` in [0, 1]. The suffixes exist so a 100×
bug is visible in review. Three things the fixtures carry are deliberately *not* stored
(item status, pickup hazard, hotspot counts) because each would be a second copy of a
fact another table already owns.

The design, the deletion policy, the role model and the instance details are in
[`db/README.md`](db/README.md).

---

## What is **not** built

### The database is only partly wired to the app

This is the largest remaining gap and it is deliberate, not an oversight. The schema is
fully designed and applied to RDS, and three parts of the app now use it:

- [`lib/s3/media-assets.ts`](lib/s3/media-assets.ts) writes `media_assets` rows as evidence
  is archived and lists them for [`/evidence`](app/(product)/evidence/page.tsx).
- [`lib/intake/record.ts`](lib/intake/record.ts) files each analysed intake — `intakes`,
  `items`, `material_lines`, `item_hazards`, `gatekeeper_verdicts`, `geopoints` — so the
  evidence can now be found from the item it priced.
- [`lib/heatmap/store.ts`](lib/heatmap/store.ts) reads those geopoints for
  [`/map`](app/(product)/map/page.tsx) and stores dispatch decisions in `hotspot_clusters`.

Everything else — valuations, pickups, credit notes, the ledger, every dashboard stat —
still renders hardcoded fixtures from [`lib/data/`](lib/data). In particular no
`valuations` row is written (the priced lines are stored as `material_lines`, the totals
are not), and the pickup board does not yet read the intakes that now exist.

### Auth gaps

- **No token refresh.** Sessions end after one hour and the user signs in again. The
  `RevokeToken` hook in the sign-out route is marked for when refresh lands.
- **No password reset.** Cognito has `ForgotPassword` / `ConfirmForgotPassword`; those
  two screens are not written.
- **No MFA.** `signIn` fails loudly rather than half-completing a challenge the app
  cannot answer.
- **No user-management UI.** Granting a role is a Cognito console action.
- **Roles are one per person, not one per organisation.** The role comes from a Cognito
  group. `organization_members` exists in the schema to fix this and nothing writes to
  it yet.

### Features and channels

- **Bedrock and Transcribe were the plan and are blocked.** Every Bedrock call in this
  AWS account returns `AccessDeniedException: Your account is currently being verified`.
  **Microsoft Foundry** is the provider that runs now, over its OpenAI-compatible API;
  the transcript would come from the model rather than from Amazon Transcribe. Only the
  transport is vendor-specific, so moving back is one file.
- **WhatsApp intake is deliberately last.** A channel, not a capability: it
  re-transports the exact pipeline already shipped in-app, adding webhook plumbing and
  business-account approval, and proves no new intelligence on stage. Ranked 06.
- **A low-data Android app with an offline queue** is the next channel. Not started.
- **Missed-call IVR** for feature-phone collectors is deferred.
- **The heatmap has no road network.** Sites are on real geography, but the van round
  is a priority order by detection count, not a driving route. No basemap tiles, no live van
  tracking, and a cluster is a routing suggestion — never an accusation about a site.

### Credibility limits, stated on the screens themselves

- **Credits are simulated.** This is not a payout system — which is exactly why the
  gatekeeper exists. Precision, F1 and ROC-AUC are the evidence that a simulated payout
  is not trivially gameable.
- **We route to CPCB-registered recyclers; we do not process waste.**
- **The RDS security group is open on `0.0.0.0/0`** because Amplify SSR has no static
  egress and cannot join a VPC. Compensating controls are `rds.force_ssl=1` (plaintext
  is *refused by the server*, not merely discouraged) and a 32-character AWS-generated
  master password in Secrets Manager. This is the one part of the setup that must not
  survive the demo — see [`db/README.md`](db/README.md).

---

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 5 · Tailwind CSS 4 ·
Drizzle ORM + Drizzle Kit · PostgreSQL 16 on AWS RDS · `pg` · `jose` (JWKS) ·
Amazon Cognito · Amazon S3 (`@aws-sdk/client-s3`) · Microsoft Foundry · Amplify Hosting.

The UI is a deliberate brutalist black-and-white system: thick ink borders, square
components, no shadows, no rounded corners, monospace for anything numeric or
identifier-like. Copper is reserved for value and emphasis.

---

## Getting started

```bash
npm ci
cp .env.example .env.local   # then fill it in
npm run dev
```

Open <http://localhost:3000>. `/` is the landing page and `/doc` holds the feature
write-ups; both are public, so the pitch is readable without signing in. The working
screens live behind the guards and start at `/dashboard`.

### Environment

[`.env.example`](.env.example) names every variable and carries no values. Four groups:

- **`NEXT_PUBLIC_COGNITO_*` / `COGNITO_*`** — pool and app client settings. Not secrets;
  a public browser client ships them. Amplify's SSR compute receives no environment
  variables at runtime, so `amplify.yml` copies an explicit list of names — including
  `DATABASE_URL`, which `/evidence`, intake recording and `/map` need — into
  `.env.production` at build time, and explains the cost of each.
- **`AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_DEPLOYMENT`** —
  the Microsoft Foundry endpoint, a real secret key, and the deployment name. The key
  belongs in `.env.local` (gitignored) and never in the template. Without them, live
  analysis is off and the screens fall back to the sample data. `scripts/foundry-setup.sh`
  provisions the resource and writes all three.
- **`S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`** — the
  media archive. The bucket and region are configuration; the key is a real secret and
  belongs to a dedicated IAM user scoped to `media/*` in one bucket, never to an admin.
  It is named `S3_*` and not `AWS_*` because Amplify refuses to store any variable with
  the reserved `AWS` prefix, so the standard name cannot exist on the deployment at all.
  With neither key set the SDK's own credential chain decides. Leave `S3_BUCKET` empty
  and the archive is off rather than broken: the AI routes still analyse and price a
  submission. `S3_PREFIX` is optional and defaults to `media`.
- **`DATABASE_URL`** — a real secret. The URL carries `sslmode=no-verify` because
  `node-postgres` reads `require` as `verify-full`, which *fails* against RDS's own
  certificate chain. Moving to `verify-full` with the RDS CA bundle is a real
  improvement and a fifteen-minute job.

Nothing throws at import time. A missing variable fails the request that needs it, not
`next build`.

### Database

```bash
npm run db:generate   # emit SQL for a schema change into db/migrations
npm run db:migrate    # apply pending migrations to RDS
npm run db:check      # verify migration consistency
npm run db:studio     # browse the data
```

### Media archive

```bash
npm run s3:check      # write, verify and delete two probe objects against the real bucket
```

It uses the same module, environment and bucket the routes use, and exits non-zero on the
first thing that is wrong — including a write outside the `media/` prefix, which the IAM
policy must refuse.

All four read `DATABASE_URL` through [`drizzle.config.ts`](drizzle.config.ts), which
loads env with Next's own loader — so the CLI and the app cannot end up disagreeing
about which value is in force.

---

## Checks

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Two throwaway harnesses used during development live in the gitignored `.freebuff/`:
`auth-matrix.mjs`, which asserts the access matrix and that every page guards the path
the matrix gates, and `auth-flow-check.sh`, which drives the full HTTP auth flow against
a running `next start`.

One caveat for raw SQL: `node-postgres` returns `bigint` as a **string**, because a JS
number cannot hold 64 bits safely. Every money column is `bigint` paise, which is why
the schema declares them `bigint(..., { mode: "number" })` — Drizzle converts on read.
A raw query has to do it by hand: `Number(row.net_to_collector_paise)`.

---

## Documentation

| Document | Covers |
|---|---|
| [`docs/ecoepr-track03.md`](docs/ecoepr-track03.md) | The ranked feature plan, the build order, and the post-build note recording what actually runs |
| [`docs/auth.md`](docs/auth.md) | Authentication and role-based access — architecture, decisions, and gaps |
| [`docs/spatial-heatmapping.md`](docs/spatial-heatmapping.md) | The hotspot map — capture, ward filing, the clustering rule, privacy, dispatch, and what is not built |
| [`docs/s3-media-archive.md`](docs/s3-media-archive.md) | The media archive — the bucket, the IAM policy, the key layout, `s3:check`, and what is deliberately not built |
| [`db/README.md`](db/README.md) | The database schema, layering rules, conventions, deletion policy and the instance |
| `/doc` in the app | Six feature write-ups, ranked, each linked to the working screen that delivers it |
