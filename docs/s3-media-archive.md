# The S3 media archive

The photo or Hindi voice note behind a valuation used to exist only for the duration of
one request. It arrived base64-encoded at `/api/ai/intake`, `/api/ai/valuation` or
`/api/ai/gatekeeper`, went out to the model in that same call, and was dropped when the
response was written — so the rupee figure outlived the evidence it was computed from,
and "show me what you were looking at" had no answer that was not a shrug.

This is the fix, and it is the thing `db/schema/intake.ts` was always pointing at:

> `storage_key` — S3 object key. The bucket and region are configuration, not data.

Nothing else about the pipeline changed. What changed is that the submission is still
there afterwards.

## What was provisioned

Done under `chirag-cli` in account **721954827635**, with the AWS CLI, in the repo's own
account. Every fact below is verifiable with the commands in the last section.

| Thing | Value | Notes |
|---|---|---|
| Bucket | `impact-proof-bucket` | already existed, empty, named for this project — reused rather than a second one created |
| Region | **`eu-north-1`** | see the honest note below; every other resource in this project is in `ap-south-1` |
| Encryption | AES-256, bucket default | applied to every object; the code does not name an algorithm per object so a future KMS default is not overridden |
| Public access | all four block flags **on** | no public object, no public policy, no bucket ACL can open it |
| Versioning | off | keys are content-addressed, so a re-upload is the same object rather than a second version — versioning would buy nothing and cost storage |
| Lifecycle rules | none | nothing is auto-expired or moved. For an evidence archive that is deliberate, not an omission: a retention rule is a decision about legal exposure and belongs to whoever owns the compliance story |

### The IAM principal the app uses

| Thing | Value |
|---|---|
| User | `ecoepr-app-s3` |
| Inline policy | `EcoEPRMediaArchive` |
| Access key | `AKIA2QF64NVZZ…` (created 2026-10-09) — the full id and the secret are in `.env.local` and the IAM console |
| Secret | in `.env.local` only, which is gitignored — never in this repo, never in this document, never in chat |

The key id is redacted here not because an identifier is a credential — it is not, and it
shows up in every S3 error message and in CloudTrail — but because this repository's
visibility is not a thing this document controls, and there is no reason to hand a reader
the exact string to go looking for.

The policy grants exactly this, and nothing else:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LocateBucket",
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
      "Resource": "arn:aws:s3:::impact-proof-bucket",
      "Condition": { "StringLike": { "s3:prefix": ["media/*"] } }
    },
    {
      "Sid": "ReadWriteArchiveObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:HeadObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::impact-proof-bucket/media/*"
    }
  ]
}
```

Four things about that are on purpose. It is **one bucket**, not `Resource: "*"`. It is
**one prefix**, so a bug in this app cannot write into another part of the bucket. There
is **no `s3:ListAllMyBuckets`**, so a leaked key cannot enumerate the account. And it is a
**dedicated user, not an admin** — the credentials in `.env.local` are not the credentials
in `~/.aws/credentials`, so rotating or revoking the app's access cannot lock the
operator out of the console.

The scoping is checked, not asserted: `npm run s3:check` attempts a write outside the
prefix and fails the run if it succeeds.

### Two honest caveats

**The bucket is in `eu-north-1`, and that is where the app runs — but not where the data
lives.** The Amplify app (`glowing-couscous`) is in `eu-north-1`, so the bucket and the
SSR compute that writes to it are **co-located**: an upload does not cross a region on
its way to S3, and the model call in the same request is orders of magnitude slower than
that write. The bucket already existed in this account under a name that is this
project's name, so reusing it beat creating a second, empty one.

The open question is residency, not latency. Cognito and RDS are in `ap-south-1` on
purpose — `db/README.md` records that user PII stays in India — while the evidence now
lives in Stockholm. If India-resident evidence is a requirement rather than a
preference, the bucket should move to `ap-south-1` (a re-run of the commands below with
a different region, plus one line of `S3_REGION`), and the upload then crosses regions
instead, because the compute does not move with it.

**The static key is a deployment artifact.** `amplify.yml` copies `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` into `.env.production` because Amplify's running SSR compute gets
none of the app's environment variables — the same limitation that file already
documents for `GEMINI_API_KEY`. That means the key is readable by anyone who can read the
deployment artifacts. The design answer is already in the code: `lib/s3/archive.ts` reads
these two names if they are present and otherwise lets the SDK resolve its own chain, so
the day the compute is given an IAM role (`computeRoleArn`, currently unset) both lines
can be deleted and nothing in `lib/` changes.

**They cannot be called `AWS_ACCESS_KEY_ID`.** This is not a style choice; Amplify
refuses the name outright. Setting it answers:

```
An error occurred (BadRequestException) when calling the UpdateApp operation:
Environment variables cannot start with the reserved prefix "AWS".
```

Any `amplify.yml` that greps for the standard pair is grepping for something that can
never exist on this platform, which is how the `S3_*` names in `lib/s3/archive.ts` came
to be — the first version of this integration shipped exactly that mistake and it was
caught by trying to write the variables rather than by reading the documentation.

## What a key looks like, and why

```
media/73/73749d17cb2e46e2a9526d8b319409c6a94a81a48167e9565892fd70b11199a4.jpg
  │   │  └── the SHA-256 of the bytes, in hex
  │   └───── its first byte, as a two-character fan-out
  └───────── the prefix the IAM policy grants, and the only one it does
```

The key is derived from the **content**, never from the clock, the request or the user.
Three things follow, and each is a decision rather than a side effect:

- **The same photograph submitted twice is one object.** `media_assets.storage_key`
  carries a unique index in the schema; a random or per-request key would have made that
  index a formality, because two submissions of the same file could never collide. Here
the collision *is* the point.
- **A retry is idempotent.** A PUT of bytes that are already at that key is the same
  object afterwards. A retried request whose response was lost costs one write, not a
  duplicate of the evidence.
- **The extension is for the human reading the bucket.** The MIME type is stored as
  object metadata, so nothing downstream has to infer a type from a suffix — which is
  why an unrecognised type becomes `.bin` rather than an invented extension.

The digest also goes out as `ChecksumSHA256`, so **S3 itself refuses a body that does not
match it**: a truncated upload cannot be stored as the evidence a price came from.

## How one request uses it

All three AI routes do the same thing, and the shape matters more than the details:

```ts
const access = await authorizeUser(request, "/intake");
if (!access.ok) return access.denied;

const [analysed, archived] = await Promise.allSettled([
  analyseItem({ media, note, declaredMassGrams }),
  archiveAndRecord(archiveRequests(parsed.payload), {
    uploaderCognitoSub: access.user.sub,
  }),
]);
```

**Beside, not after.** The two are independent, and a storage write is not worth adding
to the latency of a request that already spends seconds on inference.

**Both awaited.** This runs on Lambda-backed SSR compute, where work still in flight when
the response is written can be cut off with it. An archive that loses a race against its
own reply is not an archive.

**Never fatal.** The archive cannot fail the request. A write that fails is reported in
`storage.error`, appended to the response's own `warnings`, and logged server-side — it
does not throw away a model call that has already been paid for. Note what that means in
the failure direction too: because the archive is independent, a submission that came
back `ai_at_capacity` (503) still left its photograph in the bucket. The evidence exists
before the model passes judgement on it, which is the correct order for a system whose
whole claim is that a valuation is defensible.

**Off by default, and honest about it.** With no bucket configured the routes analyse and
price exactly as before, return `storage.configured: false`, and raise no warning — the
route is not broken, the archive is simply not switched on. That is the same posture
`aiConfigured()` takes for the model, and it is why the demo still runs on a laptop with
no AWS credentials at all. The same is true of the database half: no `DATABASE_URL` means
`records.configured: false`, no rows, and no complaint.

The response carries three things a screen can use: `storage` (what was written, and
where — including `readUrls`, see below), `records` (the `media_assets` rows, with their
ids, and whether this call created them), and `warnings`, which holds one plain sentence
per half that did not work.

## Reading the evidence back

An archive nobody can read is a bucket with extra steps, so retrieval is part of the
same integration and has two halves.

### The row

One `media_assets` row per object, written after the bytes and never gating them:

| Column | Value |
|---|---|
| `storage_key` | the content-addressed key. **Unique**, so a resubmission is one row |
| `kind` | `photo` or `voice` — the same `intake_mode` enum the schema already had |
| `mime_type`, `byte_size`, `checksum_sha256` | what the bytes were, and the digest the key was derived from |
| `uploader_user_id` | the session's Cognito subject, resolved through `users.cognito_sub`, or `null` when no user row exists yet |
| `uploaded_at` | now, because the object is in S3 by the time this runs |

Idempotence comes from the unique index rather than from application logic: the insert is
`ON CONFLICT DO NOTHING`, so the same photograph submitted twice is one object *and* one
row, and a retry whose response was lost cannot manufacture a second row claiming a
second upload. A failure here is reported in `records.error` and in the warnings — the
object stays, because a row that pointed at an object which was never written would be a
lie the database tells forever.

The join to a person is real but one step short: the column wants a `users.id` and a
fresh Cognito account has no such row, because nothing in the app *provisions* users yet.
So attribution is `null` today for a new account and resolves the moment those rows
exist — `npm run s3:check` proves both branches by creating one.

### The read

```
GET /api/media/read?key=media/<two hex>/<sha256>.<ext>
```

Returns `{ key, url, expiresInSeconds, expiresAt }`, where `url` is a `GetObject`
presigned with the app's own `media/*`-scoped key. Four decisions, each a choice between
two reasonable designs:

- **Guarded as a submission is, not as the bucket is.** The authority is `/intake` —
  operator or above — because these bytes are a collector's photograph and voice note. A
  read-only viewer account is refused. The session is required and the request must be
  same-origin: a cross-site `<img>` can spend a signed read as easily as a script can
  spend a model call.
- **The key is validated by shape, never looked up in the database.** Only
  `media/<2 hex>/<sha256>.<ext>` under the configured prefix can be signed, so the route
  cannot be used to walk the bucket or to probe for guessable names. It is deliberately
  not a `media_assets` lookup: requiring the row would make an object unreadable whenever
  the row write failed, turning the database into a gate on evidence that exists.
- **Signing is local, so a signature is not an existence check.** A well-formed key whose
  object was never written still produces a URL, and its `GET` answers 403/404 from S3.
- **JSON, not a `302`.** A redirect would put a signed URL into browser history and into
  any log that records `Location`. The caller decides where the URL goes.

Expiry is bounded from both ends — 30 seconds to one hour, five minutes by default —
because the URL is a bearer capability for private evidence and its only brake is how soon
it dies. The archive also returns one of these per object it writes, as `storage.readUrls`,
so the evidence behind a valuation is reachable the moment it exists rather than after a
second round trip.

`@aws-sdk/s3-request-presigner` is the whole dependency: signing is local, S3 never signs
anything for us.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `S3_BUCKET` | to switch the archive on | the bucket. Empty or missing means off |
| `S3_REGION` | with the bucket | `eu-north-1` for this bucket. `AWS_REGION` is honoured as a fallback |
| `S3_PREFIX` | no | defaults to `media`. Changing it without changing the IAM policy revokes the app's own access |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | locally, yes | a real secret, and deliberately **not** the standard `AWS_*` names — Amplify refuses those. With neither set, the SDK's default chain decides |
| `DATABASE_URL` | to record rows | the RDS URL. Missing means `records.configured: false`: the bytes are archived and nothing is recorded |

Locally these live in `.env.local`, which is gitignored. On Amplify they must be in the
app's environment variables **and** copied into `.env.production` by `amplify.yml`, for
the reason that file explains.

## Where it runs

The deployment is the Amplify app `glowing-couscous` (`d1oj56ggqzeg50`) in `eu-north-1`,
branch `main`, platform `WEB_COMPUTE`. Its app-level environment variables carry the
pool settings, `DATABASE_URL`, the model ids and — added with this integration —
`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.

```bash
aws amplify get-app --app-id d1oj56ggqzeg50 --region eu-north-1 \
  --query 'app.environmentVariables' --output json   # names; it prints values too
```

The archive is **not** live on that deployment until it is rebuilt: Amplify applies new
environment variables at build time, and the running compute keeps the environment it
was deployed with. `npm run s3:check` against a laptop proves the code and the
credentials; it proves nothing about a deployment nobody has rebuilt.

There is a second, sharper gap on that host. Amplify's SSR compute receives **no**
app-level environment variables at all — that is the documented limitation `amplify.yml`
exists to work around — and `DATABASE_URL` is deliberately not among the variables that
file copies into `.env.production`, because that file becomes part of the deployment
artifacts and the URL carries the database password. So the honest reading of the
deployed state is: **objects are archived, rows are not recorded**, and every response
says so through `records.configured: false`. Closing it means either accepting the
password in the build artifacts or moving the connection behind Secrets Manager with an
instance role — the same missing role the archive's static key is waiting on.

## Verifying it

```bash
npm run s3:check
```

This is the real thing against the real bucket **and the real database**, not a mock: it
writes three small probe objects, records their rows, and deletes both before exiting. It
asserts the configuration resolves, the key is content-addressed and matches a digest
computed locally, S3 reports the object as AES-256 encrypted with the right content type
and metadata, reading it back returns the exact bytes, identical bytes land on the
identical key, different bytes do not, a row describes each object and re-recording is one
row rather than two, the uploader's Cognito subject resolves through `users.cognito_sub`,
a presigned read serves the exact bytes, its expiry is bounded at both ends and refused
by S3 once stale, ten malformed keys are refused instead of signed, a write outside the
`media/` prefix is **refused**, and both halves degrade instead of throwing when their
configuration is absent. It exits non-zero on the first thing that is wrong.

It is run as `node --import ./scripts/ts-paths.mjs --env-file=.env.local scripts/s3-check.mts`.
The resolver is what lets a plain Node process import `@/db/client` and `./schema`: Node
resolves specifiers literally, with no bundler, no `paths` and no directory index. The
check is only worth having if it calls the modules the routes call, so the small loader is
the price of that; it is never used by the app.

By hand:

```bash
aws s3 ls s3://impact-proof-bucket/media/ --recursive --human-readable
aws s3api head-object --bucket impact-proof-bucket --key "<key from the listing>"
```

## What is not built

Stated so it does not have to be discovered by reading code:

- **No screen shows any of it.** The keys, the rows and the signed reads are all real and
  all consumed by nothing but tests: no page lists a valuation's evidence and no `src`
  points at `/api/media/read`. The API is finished; the UI for it is not started.
- **No user provisioning, so attribution stays `null` in practice.** Every other table is
  still unqueried: `users` gets no row when someone signs in, which is why
  `uploader_user_id` resolves only where a row already exists. Wiring sessions to `users`
  is the next piece of the schema, not an S3 concern.
- **No `intakes` either.** A submission does not yet create an `intake` row linking a
  collector to the asset, so nothing ties an archived object to a *submission* — only to
  its own content hash. `intakes.media_id` exists and is a `restrict` foreign key waiting
  for that write.
- **No lifecycle or retention policy,** and no Object Lock. Both are compliance decisions
  rather than engineering ones, and deleting evidence on a schedule is exactly the kind of
  thing that should not be decided by a default.
- **No multipart upload.** A single PUT covers the sizes these routes accept. The
  platform's 6 MiB request-body ceiling is what actually bounds an upload here, and it is
  enforced in `lib/ai/http.ts` before the archive is ever reached.
- **No role, so the key is still static.** `S3_ACCESS_KEY_ID` is a long-lived credential
  in an environment variable. It exists only because the compute has no instance role to
  assume; the day it has one, the explicit names can be deleted and nothing else changes.

## Rotating or removing it

```bash
# a fresh key (two are allowed per user; delete the old one after the new one is in place)
aws iam create-access-key --user-name ecoepr-app-s3
aws iam delete-access-key --user-name ecoepr-app-s3 --access-key-id AKIA2QF64NVZZ…

# take the app's access away entirely
aws iam delete-user-policy --user-name ecoepr-app-s3 --policy-name EcoEPRMediaArchive
aws iam delete-user --user-name ecoepr-app-s3
```

Deleting the user does not touch the objects. The app keeps working: the configuration
still resolves, every write fails into `storage.error`, and each response says the
submission was analysed but not archived. To switch the archive off cleanly rather than
have it fail, empty `S3_BUCKET` instead.
