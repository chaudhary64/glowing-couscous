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

**The bucket is in `eu-north-1` while the rest of the project is in `ap-south-1`.** The
bucket already existed in this account and was already named for this project, so
reusing it beat creating a second, empty one. It costs latency rather than
correctness: an upload travels from Amplify's SSR compute to Stockholm, and the model
call in the same request is two orders of magnitude slower than that hop. Moving the
archive to `ap-south-1` is a re-run of the creation commands with a different region,
plus a one-line change to `S3_REGION` — but for a data-protection story that is also a
compliance question, and India-resident evidence may well be the requirement rather than
a preference.

**The static key is a deployment artifact.** `amplify.yml` copies `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` into `.env.production` because Amplify's running SSR compute gets
none of the app's environment variables — the same limitation that file already
documents for `GEMINI_API_KEY`. That means the key is readable by anyone who can read the
deployment artifacts. The design answer is already in the code: `lib/s3/archive.ts`
creates its client without credentials of its own and lets the SDK resolve the standard
chain, so the day the compute is given an IAM role (`computeRoleArn`, currently unset)
both of those lines can be deleted and nothing in `lib/` changes.

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
const [analysed, archived] = await Promise.allSettled([
  analyseItem({ media, note, declaredMassGrams }),
  archiveMediaParts(archiveRequests(parsed.payload)),
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
no AWS credentials at all.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `S3_BUCKET` | to switch the archive on | the bucket. Empty or missing means off |
| `S3_REGION` | with the bucket | `eu-north-1` for this bucket. `AWS_REGION` is honoured as a fallback |
| `S3_PREFIX` | no | defaults to `media`. Changing it without changing the IAM policy revokes the app's own access |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | locally, yes | a real secret. Read through the SDK's default chain, so an instance role can replace them |

Locally these live in `.env.local`, which is gitignored. On Amplify they must be in the
app's environment variables **and** copied into `.env.production` by `amplify.yml`, for
the reason that file explains.

## Verifying it

```bash
npm run s3:check
```

This is the real thing against the real bucket, not a mock: it writes two small probe
objects, checks them, and deletes both before exiting. It asserts the configuration
resolves, the key is content-addressed and matches a digest computed locally, S3 reports
the object as AES-256 encrypted with the right content type and metadata, reading it back
returns the exact bytes, identical bytes land on the identical key, different bytes do
not, a write outside the `media/` prefix is **refused**, and an unconfigured archive
degrades instead of throwing. It exits non-zero on the first thing that is wrong.

By hand:

```bash
aws s3 ls s3://impact-proof-bucket/media/ --recursive --human-readable
aws s3api head-object --bucket impact-proof-bucket --key "<key from the listing>"
```

## What is not built

Stated so it does not have to be discovered by reading code:

- **No screen lists the archive.** The buckets and keys are real; nothing in the product
  shows them. The response carries the key, and no UI consumes it.
- **No presigned reads.** The bucket is private and there is no public URL, so the only
  ways to read an object today are the AWS console, the CLI, or the SDK with these
  credentials. A `GetObject` presigned for a few minutes is the obvious next step and
  `@aws-sdk/s3-request-presigner` is the one import it needs.
- **No database write.** `media_assets.storage_key` is still a column with nothing in
  it: the response reports the key, and no code inserts the row. This is the same gap the
  README describes for the whole schema, and wiring one table of thirty-nine would be a
  stranger thing to do than wiring none.
- **No lifecycle or retention policy,** and no Object Lock. Both are compliance decisions
  rather than engineering ones.
- **No multipart upload.** A single PUT covers the sizes these routes accept. The
  platform's 6 MiB request-body ceiling is what actually bounds an upload here, and it is
  enforced in `lib/ai/http.ts` before the archive is ever reached.

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
