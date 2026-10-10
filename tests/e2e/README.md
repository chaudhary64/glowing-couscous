# End-to-end tests (Playwright)

79 tests covering every feature on `main`, driven through a real browser and the app's
own API routes.

```bash
npm run test:e2e            # builds the app, starts it and DynamoDB Local, runs everything
npm run test:e2e:report     # opens the HTML report (traces, screenshots, videos of failures)
npx playwright test pickup  # one file
npx playwright test --ui    # watch it click
```

## ⚠️ These run live

| What | Talks to | Cost / side effect |
|---|---|---|
| Sign-in | Cognito `ecoepr-users` (ap-south-1) | none |
| Valuation, intake, gatekeeper | **Azure Foundry** `gpt-4.1-mini` + Azure Speech (hi-IN) | **~10 paid model calls per run** |
| Archive | **S3** `impact-proof-bucket` | test photos and the Hindi clip are stored under `media/` |
| Records, decisions | **RDS** `ecoepr-db`, the same database the deployed site uses | new `intakes` / `items` rows each run; the validation decision is recorded and then undone (a marked row, never deleted) |
| Smart pickup | DynamoDB Local (started by the config) | local only |

## Setup

1. `.env.local` with the Cognito, Azure, S3 and RDS settings (see `.env.example`), plus
   the demo accounts' password:
   ```
   E2E_PASSWORD=…
   ```
2. Java for DynamoDB Local: `brew install openjdk`, then `npm run pickup:local -- --install` once.
3. `npx playwright install chromium` once.

The five demo accounts (`demo.{owner,admin,officer,operator,viewer}@example.com`) must exist
in the pool with their `eco-*` groups. `global-setup.ts` signs each in once and saves the
session to `tests/e2e/.auth/` (gitignored).

To run against an already-running app instead of building one, set
`E2E_BASE_URL=http://localhost:3000` (it then needs `PICKUP_LOCAL=true` and
`npm run pickup:local` running itself).

## What is covered

| File | Feature | Highlights |
|---|---|---|
| `public.spec.ts` | Landing, `/doc` | public pages render; every guarded screen redirects to sign-in with `?next`; every API answers 401 signed out |
| `auth.spec.ts` | Sign-in / sign-out / sign-up | wrong password message; redirect back to the wanted page; sign-out ends the session; sign-up validation (empty, mismatch, weak password, cross-site) |
| `access.spec.ts` | Role matrix | all 5 roles × 12 screens open or land on `/no-access`; nav shows exactly the allowed links |
| `screens.spec.ts` | Every product screen | renders with no server or console errors |
| `valuation.spec.ts` | #1 Valuation (+ records, decisions, evidence) | UI upload → priced and stamped; API pricing, S3 key, RDS item; same photo never priced twice; bad input 400/415; officer-only; decision recorded → shown → **undone in the UI**; signed S3 read returns the image; malformed keys never signed; viewer refused |
| `intake.spec.ts` | #2 Multi-modal intake | photo + **Hindi WAV** → Devanagari transcript, translation, fields, price; WAV-only; viewer refused |
| `gatekeeper.spec.ts` | #3 Gatekeeper | motherboard passes; **bananas rejected under R-01** with the credit withheld (UI and API); officer-only |
| `pickup.spec.ts` | #4 Smart pickup | `/demo`: hand over → PIN → wrong PIN → right PIN → **₹450.00 UPI screen** → audit trail; 5 wrong PINs lock → new PIN → settles; weight-variance warning; standalone `/gate` and `/handoff`; viewer refused |

Fixtures and their licences: `fixtures/ATTRIBUTION.md`. Each upload gets random bytes
after the JPEG end marker so its content hash is new; the archive deduplicates by hash.

Not covered, on purpose: completing a sign-up (needs a real inbox for the code) and the
deployed AWS pickup API (`npm run pickup:check` does that, with AWS credentials).
