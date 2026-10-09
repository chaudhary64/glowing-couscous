# EcoEPR authentication and role-based access

Cognito holds the credentials; Postgres holds the authority. Sessions are id tokens in
an httpOnly cookie, and every product screen re-checks the role server-side before it
renders. The screens read fixtures and the pool is real — the part that must not be
faked, isn't.

```
sign in / sign up ──► Amazon Cognito (ecosystem of users + groups)
                            │ id token, 1 hour
                            ▼
                     httpOnly cookie  ecoepr.session
                            │
      ┌─────────────────────┼──────────────────────────────┐
      ▼                     ▼                              ▼
   proxy.ts            lib/auth/dal.ts              components/layout
   optimistic           requireAccess()              role-filtered rail
   redirects            the real check               + sign out
```

## Files

```
proxy.ts                    Next 16's middleware: optimistic redirect per request
lib/auth/config.ts          Cognito settings, read lazily so a missing var fails one route
lib/auth/roles.ts           the access matrix — one table, three readers
lib/auth/cognito.ts         SignUp / ConfirmSignUp / ResendConfirmationCode / InitiateAuth
lib/auth/token.ts           real JWKS verification; returns null on every failure
lib/auth/session.ts         the cookie: read, write, end, and the pending-address cookie
lib/auth/dal.ts             getCurrentUser / requireUser / requireAccess — where access is decided
lib/auth/form.ts            form parsing, relative redirects, the same-origin guard
lib/auth/copy.ts            every failure turned into a sentence
app/api/auth/*/route.ts     sign-in, sign-up, confirm, resend, sign-out
app/(auth)/*                login, signup, confirm, no-access — one shell, route group adds no URL
```

## The access matrix

Authority is a rank; a user may open a screen when their rank is **≤** the screen's
minimum. Cognito groups are the source of the role, taken from `cognito:groups` on the
verified token. A user in several groups keeps the strongest.

The five group names below are not a convention this code invented — they are what the
pool actually contains, confirmed with `aws cognito-idp list-groups`. A group name that
is not in this table contributes no role, and an account holding only unknown groups opens
nothing.

| Rank | Role | Cognito group | Opens |
|---|---|---|---|
| 1 | Owner | `eco-owner` | everything, including members and billing |
| 2 | Admin | `eco-admin` | organization settings, members, rate cards |
| 3 | Officer | `eco-officer` | valuation, validation queue, recyclers |
| 4 | Operator | `eco-operator` | intake, pickups, collectors |
| 5 | Viewer | `eco-viewer` | dashboard, hotspot map (read-only) |

| Screen | Path | Minimum |
|---|---|---|
| Dashboard | `/` | any role |
| Hotspot map | `/map` | any role |
| Intake | `/intake` | operator |
| Pickups | `/pickups` | operator |
| Collectors | `/collectors` | operator |
| Valuations | `/valuation` | officer |
| Validation queue | `/validation` | officer |
| Recyclers | `/recyclers` | officer |
| Docs | `/doc`, `/doc/features/*` | public |

A signed-in account with no group is not a special case: it opens nothing and lands on
`/no-access`, which names the requirement and shows the whole ladder with the caller's
own role marked. A 404 would be a lie — the screen exists and the answer is no.

## Where the decision is made, and why twice

`proxy.ts` runs first, so an unauthorised visitor never sees a shell or a flash of the
wrong rail. It is explicitly **not** the authorization boundary: it does not run for
API routes, it can be skipped by anything that does not pass through it, and Next's own
guidance is that proxy checks are optimistic. So every product page calls
`requireAccess("/its-own-path")`, which re-verifies the token and re-consults the same
matrix.

The three AI endpoints are gated by that same matrix, one screen each, precisely because
the proxy never sees `/api`: `POST /api/ai/intake` needs `/intake`'s operator, and
`/api/ai/valuation` and `/api/ai/gatekeeper` need the officer that `/valuation` and
`/validation` require. A session on its own is not authority here — an account holding
no group is turned away by every screen, and it must not be able to spend the model's
quota instead.

The matrix lives in exactly one module and is imported by all three readers — the proxy,
the data access layer, and the rail that hides links a role cannot open. Hiding a link
is a courtesy; the page check is the control.

`lib/auth/roles.ts` deliberately has no `next/headers` or React import so it can be read
from all three places without dragging a server-only dependency into a client component.

## Why these choices

| Decision | Why |
|---|---|
| `fetch` against Cognito's JSON API, not the AWS SDK | `SignUp`, `InitiateAuth`, `ConfirmSignUp` and `ResendConfirmationCode` are authenticated by the app client id, not IAM. The SDK would try to sign them with credentials the SSR runtime may not have, for no benefit |
| Only the **id** token is stored | It carries `sub`, `email` and `cognito:groups`. The refresh token would buy longer sessions at the cost of a 30-day credential in the browser, and nothing here refreshes it — one hour is the honest session |
| Plain HTML form POSTs to route handlers, not Server Actions | The session seat is a cookie; only a route handler or a server function may set one. Routes also keep the flow drivable with `curl`, which is how it is tested |
| Errors come back as a short code in the query string | A code is safe to log. A provider message in a URL — or in the page — leaks architecture, and sign-in failures must stay indistinguishable whether the account exists or the password is wrong |
| The pending confirmation address lives in a 15-minute httpOnly cookie | An email in a query string is written to every proxy log and travels on in `Referer`; and confirm/resend must act on the address the code was sent to, never on a posted one |
| Redirects use a **relative** `Location` | `request.url` in a route handler is normalised to the server's own origin, so an absolute redirect built from it points at an internal host in a deployment |
| `Sec-Fetch-Site` plus the `Origin`/`Host` comparison for mutations | `SameSite=Lax` handles the cookie-bearing case; sign-in and sign-up have no cookie yet, so the two endpoints that mint a session need their own guard |
| Roles are granted in the Cognito console, not at sign-up | A sign-up form that could choose its own authority is a public "sign up as owner" button |

## What is not built

- **No refresh.** Sessions end after an hour and the user signs in again. Adding refresh
  means calling `RevokeToken` in `app/api/auth/sign-out/route.ts` — the hook is marked.
- **No password reset.** Cognito has `ForgotPassword` / `ConfirmForgotPassword`; the two
  screens are not written.
- **No MFA.** `signIn` fails loudly rather than half-completing a challenge the app
  cannot answer.
- **No mirror into Postgres.** `db/schema/identity.ts` has `users` keyed by
  `cognito_sub` and `organization_members` for per-organization roles, and nothing writes
  to either yet. Until then the role comes from a Cognito group, which is one role per
  person and not one per organization.
- **No user management UI.** Granting a role is a console action.

## Configuration

`.env.example` names every variable. `COGNITO_*` and the `NEXT_PUBLIC_COGNITO_*` pair are
both accepted, so the server half works whether it was configured with one or the other.
Nothing throws at import time: a missing variable fails the request that needs it, not
`next build`.

Three names in the template are **not read** by this build: `NEXT_PUBLIC_COGNITO_DOMAIN`,
`NEXT_PUBLIC_COGNITO_REDIRECT_URI` and `NEXT_PUBLIC_APP_URL`. They belong to Cognito's
hosted UI, which this app does not use — sign-in goes through `USER_PASSWORD_AUTH` with
its own forms, and every redirect is relative, so there is no app URL to configure. They
are left in place because they name where the hosted-UI path would start, not because
anything reads them.

## Checks

`npx tsc --noEmit`, `npm run lint`, `npm run build`, plus two throwaway harnesses that
live in the gitignored `.freebuff/` — `auth-matrix.mjs` asserts the matrix and that every
page guards the path the matrix gates, and `auth-flow-check.sh` drives the HTTP flow
against a running `next start`.
