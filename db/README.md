# EcoEPR database schema

Drizzle ORM against **AWS RDS for PostgreSQL 16.15** — the `ecoepr-db` instance in
ap-south-1. The schema is **applied**: 39 tables, 24 enum types, 70 foreign keys, and
one migration recorded in `drizzle.__drizzle_migrations`. Migrations live in
`db/migrations` and apply with `npm run db:migrate`. The screens still read the fixtures
in `lib/data`, with one exception: the S3 media archive is the first and so far only
runtime query. It writes one `media_assets` row per object it stores, through
`db/client.ts`, and reads the key back by its unique index — see
`docs/s3-media-archive.md`. Every other table remains unqueried, which is why the
fixtures are still the source the UI reads.

```
db/client.ts     the runtime connection (pg + Drizzle), shared by everything below

db/schema/
  columns.ts     shared column factories — ids, timestamps, money, mass, scores
  enums.ts       24 Postgres enum types
  identity.ts    users, organizations, organization_members
  network.ts     collectors, waste_streams, facilities, facility_streams
  intake.ts      media_assets, intakes, intake_fields
  catalog.ts     items, item_hazards, material_lines, rate_cards, rate_card_lines
  valuation.ts   valuations, gatekeeper_verdicts, verdict_signals,
                 validation_decisions, model_versions, model_metrics,
                 reject_rules, rule_blocks
  logistics.ts   pickups, pickup_steps, credit_notes, epr_credit_notes,
                 epr_obligations, ledger_entries
  geo.ts         wards, geopoints, hotspot_clusters, hotspot_detections
  ops.ts         activity_events, notifications, audit_log, delivery_channels,
                 channel_blockers, channel_decisions
  index.ts       re-exports everything
```

39 tables. Import from `@/db/schema` for the whole set, or from one module when a
query only needs that layer.

## The connection

`db/client.ts` is the only place a pool is created, and it takes the same posture as the
other integrations in this app: **no `DATABASE_URL` is not an error.** `database()`
returns `null`, the caller reports `configured: false`, and the request still answers.
The pool is parked on `globalThis` so a dev reload or a warm container reuses it instead
of leaking a connection per module instance, and `connectionTimeoutMillis` is 5s because
Amplify cuts a server-rendered request off at about thirty seconds and a hung connection
would spend the rest of it.

TLS is not configured in code: it comes from the URL, which carries `sslmode=no-verify`
for the reason described below.

That module is also imported by `npm run s3:check` under plain Node, which is why the
scripts run with `--import ./scripts/ts-paths.mjs` — Node resolves specifiers literally,
so without that resolver the check could not import `@/db/client` or `./schema` at all.

## Layering

Imports flow one way only. A module may import from the ones above it and never
from the ones below — this is what keeps the Drizzle table graph acyclic, which
matters because Drizzle resolves `references(() => x.id)` closures at module
evaluation time.

```
columns, enums  →  identity  →  network  →  intake  →  catalog
                →  valuation  →  logistics  →  geo  →  ops
```

The one place a cycle tried to appear was the intake ↔ item link. An intake
"resolves to" an item and an item "came from" an intake — two columns, one fact,
and a circular foreign key. It is modelled as a single unique link,
`items.intake_id`: one intake resolves to one item, so the second column would have
been redundant as well as circular. Same reasoning put ward references
(`items.ward_code`, `collectors.ward_code`) as plain text values instead of foreign
keys into `geo.wards`, which keeps intake and network above geo.

## Conventions

| Decision | Rule | Why |
|---|---|---|
| Ids | UUID v4, `defaultRandom()` | Ids travel to the client and appear in URLs; sequential ids leak volume |
| Time | `timestamptz` everywhere | Collectors write on IST, the platform runs UTC, the map groups by local day |
| Money | `bigint` **paise**, `mode: "number"`, name ends `_paise` | ₹1,13,050 must never be 113050.00000001; the suffix makes a 100× bug visible in review |
| Mass | `numeric(12,2)` **grams**, name ends `_g` | A motherboard is 240 g; 0.25 g stays exact and still sums in SQL |
| Scores | `numeric(4,3)` in [0, 1] | Matches the model's own precision |
| Percent | `numeric(5,2)`, name ends `_pct` | Share of 100, never a 0–1 fraction — the two are never guessed at |
| Closed sets | Postgres enum types | An invalid state cannot be written by a buggy handler |
| Open sets | `text` | A new language, waste stream or material must not need a migration |
| Counters | Denormalised only where marked, always rebuildable | `ledger_entries` is the source of truth and `collectors.lifetime_*` can be recomputed from it |

## Roles and Cognito

Cognito owns credentials — password hash, MFA state, refresh tokens. None of that
is duplicated in Postgres. What lives here is the half Cognito does not model:
**which organization a person acts for, and what they may do inside it.**

- `users.cognito_sub` is the join between the id token and the database. It is
  unique and never updated, because it is stable for the life of the account and
  email is not.
- `organizations` is a single table for brands, recyclers, municipalities,
  cooperatives and the platform itself, so a load points at one `organizations.id`
  whether the other side is a brand or a recycler.
- `organization_members` is the authorisation table: one row per
  (organization, user), carrying a `membership_role`.

### The provisioned pool

`ecoepr-users` in **ap-south-1**, created with the AWS CLI. The pool id and app
client id are not secrets — a public browser client ships them — so they live in
`.env.local` for local work and in the Amplify app's environment variables for
deploys (app `glowing-couscous`, **eu-north-1**, branch `main`).

| Setting | Value |
|---|---|
| User pool id | `ap-south-1_ArcnyY9aL` |
| App client id | `1cch6c9f1ukp3ojtgvd9r6ntr4` — no client secret |
| Region | `ap-south-1` |
| Issuer | `https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_ArcnyY9aL` |
| Hosted UI | `https://ecoepr-721954827635.auth.ap-south-1.amazoncognito.com` |
| Sign-in | email, auto-verified. `name`, `phone_number`, `locale` are read/write attributes |
| App client flows | SRP, `USER_PASSWORD_AUTH`, refresh, and authorization-code for the hosted UI |
| Tokens | access and id 60 minutes, refresh 30 days, revocation on |
| MFA | `OFF` |

Env var names: `NEXT_PUBLIC_COGNITO_{REGION,USER_POOL_ID,CLIENT_ID,DOMAIN,REDIRECT_URI}`
for the browser, and the same values without the prefix plus `COGNITO_ISSUER` for the
server. Callback URLs registered on the client: `http://localhost:3000/`,
`http://localhost:3000/api/auth/callback/cognito`, and the same two on
`https://main.d1oj56ggqzeg50.amplifyapp.com`.

Three decisions worth knowing before they bite:

- **Sign-in is by email, and aliases cannot be added later.** Cognito refuses to add
  an alias to an existing pool, so phone-first sign-in for a collector with no email
  means a new pool. Nothing depends on this one yet, which is exactly why changing it
  now is cheap and changing it in a month is not.
- **MFA is `OFF`** because `OPTIONAL` requires an SNS SMS configuration and an
  India-registered sender. TOTP for officers can be enabled without any of that; SMS
  MFA cannot.
- **The pool lives in ap-south-1 while the Amplify app runs in eu-north-1.** That is
  deliberate — user PII stays in India and RDS will sit next to it — and it costs one
  cross-region call per sign-in, not per request, because token verification only
  needs the cached JWKS.

Groups, one per `membership_role`, already created in that pool:

| Cognito group | Role | May do |
|---|---|---|
| `eco-owner` | `owner` | Everything, including members and billing |
| `eco-admin` | `admin` | Organization settings, members, facilities, rate cards |
| `eco-officer` | `officer` | Validation decisions, EPR filings, credit approvals |
| `eco-operator` | `operator` | Intake, pickups, settlements — no rate cards, no members |
| `eco-viewer` | `viewer` | Read-only, for a municipality or brand analyst |

**Resolve the role from the database, not from the token.** `cognito:groups` does
arrive in the id token, but the row in `organization_members` is what authorises
anything: read `cognito_sub` from the verified id token, look up the user, then look
up their membership in the organization being acted for. A role cached in a token cannot be revoked until that
token expires; a role read from `organization_members` is revoked the moment the
row is deleted. Put the *active organization* in the token if you like (`custom:org_id`),
and an optional `custom:role` to avoid a round trip — but treat the database as the
answer and the token as a hint.

Every request that touches per-organization data must scope by the resolved
`organization_id` and never by an id supplied by the client.

## Deletion policy

70 foreign keys: 31 `cascade`, 37 `set null`, 2 `restrict`. The rule, and every
place it is deliberately not followed.

| Relationship | Behaviour | Why |
|---|---|---|
| A child of an item — assay, hazards, verdicts, valuation, pickup | `cascade` | None of it means anything without the item |
| `items.intake_id` | `cascade` | Deleting the submission removes what was resolved from it |
| `intakes.media_id` → `media_assets` | **`restrict`** | The one thing deletion must not do is remove the evidence a decision was taken on |
| `epr_credit_notes.brand_organization_id` → `organizations` | **`restrict`** | A brand's compliance record outlives the brand account |
| Any other → `organizations` | `cascade` from the owning org, `set null` when the org is merely referenced | `facilities` and obligation-free references own their rows; `wards.municipality_organization_id` only points at one |
| `organization_members`, `notifications` → `users` | `cascade` | A membership without its person is not a fact, and neither is an unsent message |
| Every other → `users` (14 keys) | `set null` | People leave; the record of what they did stays |
| `ledger_entries` | Never updated, never deleted | Corrections are new rows with `reference` pointing at what they correct |

## Deliberately not stored

Three things the fixtures carry that the schema refuses to keep a second copy of:

- **No `items.status`.** The verdict, the validation decision and the pickup each
  record one part of the lifecycle already; a status column would be a fourth copy
  and the first to drift.
- **No `pickups.hazardous`.** Hazard is a property of the item's materials
  (`item_hazards`). The failure mode of a stale copy is a swollen battery routed to
  a board line.
- **No stored hotspot counts.** `hotspot_clusters` has no `detections` or `density`
  column; those come from `hotspot_detections` and the ward's geopoints.

## The instance

| | |
|---|---|
| Instance | `ecoepr-db` — db.t4g.micro, PostgreSQL 16.15, 20 GiB gp3, single-AZ |
| Region | ap-south-1 |
| Endpoint | `ecoepr-db.c7oemi0c8pwx.ap-south-1.rds.amazonaws.com:5432` |
| Database / user | `ecoepr` / `ecoepr_admin` |
| Master password | RDS-managed — generated by AWS straight into Secrets Manager, never typed by a human |
| TLS | forced, via `rds.force_ssl=1` in the `ecoepr-pg16-ssl` parameter group |
| Security group | `ecoepr-db-sg` — port 5432 from `0.0.0.0/0` |

The same `DATABASE_URL` is in `.env.local` and in the Amplify app's environment
variables, so "the data" is one database whether you are on a laptop or on Amplify.

### The security group is open on purpose, and should not stay that way

Amplify Hosting's SSR compute has no static egress addresses and cannot be joined to a
VPC, so an IP allowlist would break the deploy the first time it scaled. What
compensates for `0.0.0.0/0` today:

- `rds.force_ssl=1`, so an unencrypted connection is **refused by the server**, not
  merely discouraged. Confirmed by attempting one: `no pg_hba.conf entry for host …
  no encryption`.
- A 32-character AWS-generated master password held in Secrets Manager, rotatable
  there without touching a line of app code.
- Nothing but schema in the database yet, so the exposure is empty.

Before real collector data lands, put the instance in a private subnet and reach it
through an RDS Proxy behind a small Lambda (or move the API off Amplify SSR). This is
the one part of the setup that should not survive the demo.

### Working with it

```bash
npm run db:generate   # emit SQL for a schema change into db/migrations
npm run db:migrate    # apply pending migrations to RDS
npm run db:studio     # browse the data
```

All three read `DATABASE_URL` through `drizzle.config.ts`, which loads env with Next's
own loader — so the CLI and the app cannot end up disagreeing about which value is in
force.

On TLS: `node-postgres` reads `sslmode=require` as `verify-full`, which **fails**
against RDS's own certificate chain. The URL therefore carries `sslmode=no-verify`
(encrypted, chain unverified). Moving to `verify-full` with the RDS CA bundle is a
real improvement and a fifteen-minute job; skipping it means a machine in the middle
could present its own certificate.

### One gotcha for raw SQL

`node-postgres` returns `bigint` as a **string**, because a JS number cannot hold 64
bits safely. Every money column here is `bigint` paise, which is why the schema
declares them `bigint(..., { mode: "number" })` — Drizzle converts on read. A raw
`pg` query has to do it by hand: `Number(row.net_to_collector_paise)`.
