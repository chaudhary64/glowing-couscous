# EcoEPR — ImpactProof

**Prove it went to a licensed recycler.**

EcoEPR turns a photo or a Hindi voice note into a metal assay, a price the server computes,
and an EPR credit note — and routes the load only to CPCB-registered recyclers, paying the
collector after the recycler confirms the handoff.

Built for the Indian EPR regime: brands must prove where the electronics their products
become actually end up, and today almost none of it leaves a paper trail.

---

## 1. The problem

- India generates **3.2 million tonnes** of e-waste a year.
- **Over 90%** moves through informal collectors — no geotag, no weight, no receipt.
- So the tonnage never reaches the brand's compliance file, an invented rupee figure can
  earn a credit, and nothing can be reconstructed by an auditor.

## 2. How it works

One item goes through four steps. Nothing is promised to the collector until step 3 clears it.

1. **Identify** — a photo or a Hindi voice note goes in; item, brand, materials and hazard
   class come out.
2. **Value** — assay the metals by mass and price them on the server from the rate card, so
   the rupee figure is the server's arithmetic and an auditor can re-run it line by line.
3. **Gatekeep** — refuse anything that isn't e-waste before any credit is promised.
4. **Pick up and credit** — route the load to a licensed recycler, verify it at the gate with
   a one-time PIN, and pay the collector exactly once.

The AI **never states a price**. It answers in closed vocabularies (an item class, material
IDs with mass estimates, a verdict, a confidence); the server rejects anything outside those
lists and prices the materials itself.

## 3. What runs today

The pipeline is real, end to end. What is still sample data is labelled on the screen
that shows it, and listed in section 11.

| Area | State |
| --- | --- |
| AI pipeline (Azure AI Foundry + Azure Speech) | **Real**: three endpoints, closed-list validation, Hindi transcription |
| Sign-in and roles (Cognito) | **Real**: JWKS-verified httpOnly session, four roles, one enforced access table |
| Media archive (S3) | **Real**: every photo and voice note, keyed by SHA-256, read back through signed URLs |
| Intake records (RDS) | **Real**: submission, item, assay, valuation, verdict and officer decisions |
| Hotspot map | **Real**: geotagged intakes filed to India's districts and Mumbai's BMC wards |
| Smart pickup and handoff | **Real**: API Gateway, two Lambdas, DynamoDB; routing, PIN handoff, settlement, payout |
| Database schema | **Applied to RDS, partly wired**: 39 tables; media, intake, record and geo tables are used |
| Money | **Simulated**: the UPI payout moves no money |

### The gatekeeper

Every upload is judged *verified*, *review* or *rejected* before anything is promised, and
a rejection names its rule:

| Rule | Means |
| --- | --- |
| R-01 | Not e-waste |
| R-02 | Duplicate submission |
| R-03 | Working device: it goes to reuse, so the credit is shown, then withheld |
| R-04 | Swollen battery: forced onto a licensed battery route |

A verified outcome needs a photo; a voice note alone is held for review. Each
submission's id is derived from its photo, so the same photo can never be paid twice.
Held items wait on `/validation` for an officer, and every decision records who made it
and when.

### Smart pickup

One HTTP API (API Gateway) in front of one Lambda, [`aws/pickup/`](aws/pickup), with three
DynamoDB tables: `ecoepr-recyclers`, `ecoepr-pickups` and `ecoepr-credit-notes`. Every
route needs the user's own Cognito ID token; there is no API key.

1. **Route:** the load goes only to a recycler licensed for its stream and within that
   site's daily capacity. A load with no licensed destination is refused, never stored.
2. **Handoff:** the collector's phone shows a 4-digit PIN. It expires after 15 minutes and
   locks after 5 wrong tries.
3. **Settle:** at the gate, staff weigh the load and type the PIN. The right PIN issues a
   credit note; a weight far from the declared mass is flagged.
4. **Pay:** the pickups table's DynamoDB Stream triggers `ecoepr-pickup-payout`, which
   sends the simulated UPI credit exactly once per settled load.

Every step is written to the load's audit trail.

### Hotspot map

Intakes are filed by point-in-polygon to India's 735 districts and, inside Mumbai, to its
24 BMC wards. A **hotspot** is four or more detections within 150 m of each other in a
rolling 21-day window, found by distance rather than grid cell so GPS jitter can't split a
site. Gatekeeper-rejected items never count. The rule is one pure function,
[`lib/heatmap/cluster.ts`](lib/heatmap/cluster.ts). Location is captured only with the
visitor's consent, asked once up front. Operators can assign a van to a hotspot from the
map.

### Regions

Collector, load and credit data stays in India (ap-south-1: Cognito, RDS, the pickup API
and DynamoDB). The app on Amplify and the S3 archive run in eu-north-1, so an operator's
request crosses regions to reach the pickup API, a deliberate trade-off.

## 4. Screens

| Group | Screens |
| --- | --- |
| Operations | Dashboard · New intake · Valuations · Validation queue · Pickups · Collector handoff · Recycler gate · Handoff demo · Evidence |
| Network | Hotspot map · Collectors · Recyclers |
| Administration | Team · Rate card |

Plus the public landing page (`/`) and the sign-in, sign-up and confirm screens.

## 5. Roles and access

One table — [`lib/auth/roles.ts`](lib/auth/roles.ts) — drives the proxy, the data access
layer and the navigation, so a screen a role cannot open is neither shown nor linked, and a
direct visit answers with a page explaining what is required.

| Role | Meant for | Opens |
| --- | --- | --- |
| **Admin** | Team and prices | Team (including changing roles), Rate card, and everything an Officer can |
| **Officer** | Compliance decisions | Valuations, Validation queue, Recyclers, and everything an Operator can |
| **Operator** | Field work | Intake, Pickups, Collector handoff, Recycler gate, Handoff demo, Evidence, Collectors, Dispatch, Dashboard, Map |
| **Viewer** | A municipality or brand analyst | Dashboard and Hotspot map, read-only |

> Rank is authority: lower is more powerful. `eco-owner` was folded into `eco-admin`, so an
> older Owner account keeps working and reads as Admin.

## 6. Demo accounts

Sign in with **email and password** only. These exist on the demo Cognito pool and each
account's role is a Cognito group.

| # | Role | Email | Password | Access |
| --- | --- | --- | --- | --- |
| 1 | Admin | `demo.admin@example.com` | `Ecoepr1234` | All 14 screens |
| 2 | Admin (legacy Owner) | `demo.owner@example.com` | `Ecoepr1234` | All 14 screens — the `eco-owner` group reads as Admin |
| 3 | Officer | `demo.officer@example.com` | `Ecoepr1234` | 12 screens — hidden: Team, Rate card |
| 4 | Operator | `demo.operator@example.com` | `Ecoepr1234` | 9 screens — hidden: Valuations, Validation queue, Recyclers, Team, Rate card |
| 5 | Viewer | `demo.viewer@example.com` | `Ecoepr1234` | Dashboard and Hotspot map only — hidden: 12 screens |

These are **demo-only accounts** with a shared password. Do not reuse them for anything
that holds real data. The enforced matrix is [`lib/auth/roles.ts`](lib/auth/roles.ts); the
navigation simply hides what the matrix refuses.

## 7. Tech stack

- **Next.js 16** (App Router, React 19, server-side rendering) — one app serves the landing
  page and every working screen.
- **AWS Amplify Hosting** for the build and the SSR compute.
- **Amazon Cognito** for sign-up, sign-in and sessions (the session is the ID token in an
  httpOnly cookie; the Cognito group is the role).
- **Amazon RDS for PostgreSQL** + **Drizzle ORM** for submissions, items, assays,
  valuations, verdicts, decisions, users and map points.
- **Amazon S3** for the private media archive, keyed by SHA-256 and read back only through
  short-lived signed URLs.
- **API Gateway + Lambda + DynamoDB (with Streams)** for smart pickup: routing, one-time
  PINs, settlement and a single simulated UPI payout per settled load.
- **Microsoft Azure** — AI Foundry (`gpt-4.1-mini`) reads the photo and transcript; Azure
  Speech transcribes the Hindi voice note.
- **MapLibre GL** with OpenFreeMap tiles for the hotspot map.

The full architecture diagram and a service-by-service breakdown are in
[docs/demo-video-script.md](docs/demo-video-script.md).

## 8. Getting started

**Prerequisites:** Node.js 20.9 or newer, npm, and access to the demo Cognito pool,
PostgreSQL database and S3 bucket.

```bash
npm ci                 # install (preserves package-lock.json)
cp .env.example .env.local   # then fill in the values described below
npm run db:migrate     # create/sync the schema
npm run dev            # http://localhost:3000
```

Environment variables, grouped as they appear in [`.env.example`](.env.example):

| Group | Keys | Notes |
| --- | --- | --- |
| Browser | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_COGNITO_*` | Public; inlined into the bundle |
| Cognito (server) | `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_ISSUER` | Needed or sign-in reports the pool as unconfigured |
| Team admin | `COGNITO_ADMIN_ACCESS_KEY_ID`, `COGNITO_ADMIN_SECRET_ACCESS_KEY` | Optional; without it `/team` is read-only |
| AI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_SPEECH_REGION` | Vision model for the photo, Speech for Hindi |
| Database | `DATABASE_URL` | Secret. `sslmode=no-verify` against RDS |
| Archive | `S3_BUCKET`, `S3_REGION`, `S3_PREFIX`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Leave the bucket empty and the archive is simply off |
| Pickup | `PICKUP_API_URL` | The private API behind Cognito |
| Local pickup | `PICKUP_LOCAL`, `PICKUP_DYNAMODB_ENDPOINT` | Run the handoff screens without AWS |

`.env.example` is committed on purpose — it carries key names, never values.

### Running the handoff demo without AWS

`PICKUP_LOCAL=true` runs the Lambda's own handler in-process against DynamoDB Local, which
`npm run pickup:local` starts, seeds and relays the payout stream for. That gives you
`/handoff`, `/gate` and `/demo` on a laptop with no AWS account.

## 9. Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Run, build and serve the app |
| `npm run lint` | ESLint |
| `npm run db:generate` / `db:migrate` / `db:check` / `db:studio` | Drizzle schema workflow |
| `npm run s3:check` | Verify the media archive can read and write |
| `npm run test:e2e` | Playwright end-to-end suite (needs a production build) |
| `npm run test:heatmap` / `test:heatmap:db` | Hotspot clustering unit and integration tests |
| `npm run pickup:setup` / `seed` / `check` / `local` / `test` | Provision or exercise the smart-pickup service |
| `npm run geo:wards` / `geo:districts` | Regenerate boundary data |

`predev` and `prebuild` copy the MapLibre worker into `public/vendor/` from `node_modules`.

## 10. Testing

The Playwright suite in [`tests/e2e`](tests/e2e) (83 tests in 10 files) runs against a production build with real
Cognito sign-ins, live Azure calls, and real S3 and RDS writes; the pickup tests run against
DynamoDB Local. It covers auth and public pages, per-role access, the dashboard, intake,
the gatekeeper verdicts, valuation, pickup and settlement, and the team screen.

On Amplify, `amplify.yml` copies the server-side variables into `.env.production` before the
build, because Amplify's SSR compute does not inherit the app's environment settings.

## 11. What we are not claiming

- Credits are **simulated**. This prototype moves no money — which is exactly why the
  gatekeeper exists.
- EcoEPR **routes** e-waste to CPCB-registered recyclers; it does not process waste itself.
- The rate card is a labelled demo card; replacing it with a licensed feed changes nothing
  else.
- WhatsApp is the next channel, not part of this build.

### Not built yet

- **Still sample data, and labelled as such:** the dashboard's "Loads in play" board, and
  the intake screen's worked examples. Collectors have no profile records yet, so
  `/collectors` is an activity view built from the loads.
- **Auth gaps:** no token refresh (sessions end after an hour), no password reset, no MFA,
  one role per person rather than per organisation, and no separate collector role.
- **AI on Azure, not AWS:** Bedrock was the plan, but the AWS account was blocked from it
  while this was built. Only the transport in `lib/ai/foundry.ts` is vendor-specific.
- **The van round is not a driving route:** it is a priority order by detection count.
- **The RDS security group is open to `0.0.0.0/0`**, because Amplify's SSR compute has no
  static egress. It is compensated by `rds.force_ssl=1` and a long generated password.
  The fix is an IAM role on the Amplify compute reading secrets from Secrets Manager. This
  must not outlive the demo.
  -thank you.

---

Recording the demo? [docs/demo-video-script.md](docs/demo-video-script.md) has the video
script, the architecture diagram, the AWS service table and a pre-recording checklist.
