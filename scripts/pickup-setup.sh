#!/usr/bin/env bash
#
# Provision feature 4 — Smart Pickup & Digital Credit — with the AWS CLI, idempotently,
# and write the resulting endpoints, table names and function name into `.env.local`.
#
#   DynamoDB     three tables: the licensed-recycler directory, the loads, and the
#                collector's credit notes
#   Lambda       `ecoepr-smart-pickup`, deployed as source files with no dependencies
#                `ecoepr-pickup-payout`, the same files, invoked by the pickups
#                table's DynamoDB Stream to send the (simulated) UPI credit
#   API Gateway  an HTTP API in front of it, every route behind the Cognito pool the
#                app already uses, with stage-level throttling
#   IAM          a role that can write those three tables and nothing else, and a
#                payout role that can read the stream and update pickups, no more
#
# Region defaults to `ap-south-1`, where Cognito and RDS live: a collector's identity,
# their load and their credit note are the same subject's data, and `db/README.md`
# already records that it stays in India. The Amplify app runs in `eu-north-1`, so an
# operator's request crosses a region to reach this API — see the write-up for that
# trade-off, which is real and deliberate.
#
# Usage:
#   bash scripts/pickup-setup.sh [--region ap-south-1] [--env-file .env.local]
#                                [--no-env] [--seed] [--runtime nodejs22.x]
#
# Re-running is safe. Every create is guarded by a read, so a second run updates the
# function code and leaves the rest alone. Nothing here deletes a table, a load or a
# note: revoking access is a policy change, and destroying a compliance trail is not a
# thing this script is willing to do.
set -euo pipefail

cd "$(dirname "$0")/.."

# Every argument below is an AWS name, ARN, URL or resource path, and Git Bash on
# Windows rewrites arguments that look like POSIX paths before the native `aws` binary
# sees them: a log group called `/aws/lambda/...` arrives as `C:/Program Files/...`, and
# the API answers a validation error about a regular expression that has nothing to do
# with the real problem. Off for this script; harmless everywhere else.
export MSYS_NO_PATHCONV=1

REGION="${PICKUP_REGION:-ap-south-1}"
FUNCTION_NAME="${PICKUP_FUNCTION:-ecoepr-smart-pickup}"
ROLE_NAME="${PICKUP_ROLE:-ecoepr-smart-pickup-role}"
PAYOUT_FUNCTION="${PICKUP_PAYOUT_FUNCTION:-ecoepr-pickup-payout}"
PAYOUT_ROLE="${PICKUP_PAYOUT_ROLE:-ecoepr-pickup-payout-role}"
PAYOUT_POLICY="${PICKUP_PAYOUT_POLICY:-EcoEPRPickupPayout}"
POLICY_NAME="${PICKUP_POLICY:-EcoEPRSmartPickup}"
API_NAME="${PICKUP_API_NAME:-ecoepr-pickup-api}"
AUTHORIZER_NAME="${PICKUP_AUTHORIZER:-ecoepr-cognito}"
TABLE_RECYCLERS="${PICKUP_TABLE_RECYCLERS:-ecoepr-recyclers}"
TABLE_PICKUPS="${PICKUP_TABLE_PICKUPS:-ecoepr-pickups}"
TABLE_NOTES="${PICKUP_TABLE_CREDIT_NOTES:-ecoepr-credit-notes}"
RUNTIME="nodejs22.x"
ENV_FILE=".env.local"
WRITE_ENV=1
SEED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --function) FUNCTION_NAME="$2"; shift 2 ;;
    --api-name) API_NAME="$2"; shift 2 ;;
    --runtime) RUNTIME="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --no-env) WRITE_ENV=0; shift ;;
    --seed) SEED=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
awsd() { aws --region "$REGION" "$@"; }

if ! command -v aws >/dev/null 2>&1; then
  say "The AWS CLI is not on PATH. Install it, then run 'aws configure'." >&2
  exit 1
fi

ACCOUNT="$(awsd sts get-caller-identity --query Account --output text)"
CALLER="$(awsd sts get-caller-identity --query Arn --output text)"
say "Account: ${ACCOUNT}"
say "Caller:  ${CALLER}"
say "Region:  ${REGION}"

# Values the authorizer needs. They are not secrets — a pool id and a public app client
# id are shipped to the browser by `lib/auth/config.ts` — so reading them from the file
# the app already uses is fine, and the process environment still wins if it is set.
env_value() {
  local name="$1"
  local injected="${!name:-}"
  if [ -n "$injected" ]; then printf '%s' "$injected"; return 0; fi
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^${name}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true
}

COGNITO_REGION="$(env_value COGNITO_REGION)"
COGNITO_POOL="$(env_value COGNITO_USER_POOL_ID)"
COGNITO_CLIENT="$(env_value COGNITO_CLIENT_ID)"
if [ -z "$COGNITO_REGION" ] || [ -z "$COGNITO_POOL" ] || [ -z "$COGNITO_CLIENT" ]; then
  say ""
  say "COGNITO_REGION, COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are needed to authorise" >&2
  say "the API against the existing pool, and at least one is missing from ${ENV_FILE}." >&2
  exit 1
fi
ISSUER="https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_POOL}"
say "Issuer:  ${ISSUER}"

# Scratch files live under `dist/`, not in the system temp directory, because the AWS
# CLI is a native binary: on Windows it cannot open a path that only MSYS understands,
# and `file:///tmp/...` is exactly that. `dist/` is build output and is ignored.
TMPDIR_SETUP="dist/.setup"
rm -rf "$TMPDIR_SETUP"
mkdir -p "$TMPDIR_SETUP"
trap 'rm -rf "$TMPDIR_SETUP"' EXIT

# ---------------------------------------------------------------- DynamoDB tables

# Three explicit definitions rather than a helper: the keys and the two indexes are the
# design, and a parameterised creator would hide exactly the part worth reading.
write_table_definition() {
  local name="$1" file="$2"
  case "$name" in
    "$TABLE_RECYCLERS")
      cat > "$file" <<JSON
{
  "TableName": "${TABLE_RECYCLERS}",
  "BillingMode": "PAY_PER_REQUEST",
  "SSESpecification": { "Enabled": true },
  "AttributeDefinitions": [
    { "AttributeName": "pk", "AttributeType": "S" },
    { "AttributeName": "sk", "AttributeType": "S" },
    { "AttributeName": "stream", "AttributeType": "S" },
    { "AttributeName": "facilityId", "AttributeType": "S" },
    { "AttributeName": "catalogueKey", "AttributeType": "S" },
    { "AttributeName": "code", "AttributeType": "S" }
  ],
  "KeySchema": [
    { "AttributeName": "pk", "KeyType": "HASH" },
    { "AttributeName": "sk", "KeyType": "RANGE" }
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "stream-index",
      "KeySchema": [
        { "AttributeName": "stream", "KeyType": "HASH" },
        { "AttributeName": "facilityId", "KeyType": "RANGE" }
      ],
      "Projection": { "ProjectionType": "ALL" }
    },
    {
      "IndexName": "catalogue-index",
      "KeySchema": [
        { "AttributeName": "catalogueKey", "KeyType": "HASH" },
        { "AttributeName": "code", "KeyType": "RANGE" }
      ],
      "Projection": { "ProjectionType": "ALL" }
    }
  ]
}
JSON
      ;;
    "$TABLE_PICKUPS")
      cat > "$file" <<JSON
{
  "TableName": "${TABLE_PICKUPS}",
  "BillingMode": "PAY_PER_REQUEST",
  "SSESpecification": { "Enabled": true },
  "AttributeDefinitions": [
    { "AttributeName": "pickupId", "AttributeType": "S" },
    { "AttributeName": "sk", "AttributeType": "S" },
    { "AttributeName": "collectorKey", "AttributeType": "S" },
    { "AttributeName": "requestedAt", "AttributeType": "S" },
    { "AttributeName": "facilityKey", "AttributeType": "S" },
    { "AttributeName": "facilityDay", "AttributeType": "S" }
  ],
  "KeySchema": [
    { "AttributeName": "pickupId", "KeyType": "HASH" },
    { "AttributeName": "sk", "KeyType": "RANGE" }
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "collector-index",
      "KeySchema": [
        { "AttributeName": "collectorKey", "KeyType": "HASH" },
        { "AttributeName": "requestedAt", "KeyType": "RANGE" }
      ],
      "Projection": { "ProjectionType": "ALL" }
    },
    {
      "IndexName": "facility-index",
      "KeySchema": [
        { "AttributeName": "facilityKey", "KeyType": "HASH" },
        { "AttributeName": "facilityDay", "KeyType": "RANGE" }
      ],
      "Projection": { "ProjectionType": "ALL" }
    }
  ]
}
JSON
      ;;
    "$TABLE_NOTES")
      cat > "$file" <<JSON
{
  "TableName": "${TABLE_NOTES}",
  "BillingMode": "PAY_PER_REQUEST",
  "SSESpecification": { "Enabled": true },
  "AttributeDefinitions": [
    { "AttributeName": "noteId", "AttributeType": "S" },
    { "AttributeName": "sk", "AttributeType": "S" },
    { "AttributeName": "collectorKey", "AttributeType": "S" },
    { "AttributeName": "issuedAt", "AttributeType": "S" },
    { "AttributeName": "pickupId", "AttributeType": "S" }
  ],
  "KeySchema": [
    { "AttributeName": "noteId", "KeyType": "HASH" },
    { "AttributeName": "sk", "KeyType": "RANGE" }
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "collector-index",
      "KeySchema": [
        { "AttributeName": "collectorKey", "KeyType": "HASH" },
        { "AttributeName": "issuedAt", "KeyType": "RANGE" }
      ],
      "Projection": { "ProjectionType": "ALL" }
    },
    {
      "IndexName": "pickup-index",
      "KeySchema": [
        { "AttributeName": "pickupId", "KeyType": "HASH" },
        { "AttributeName": "issuedAt", "KeyType": "RANGE" }
      ],
      "Projection": { "ProjectionType": "ALL" }
    }
  ]
}
JSON
      ;;
    *) say "No table definition for ${name}" >&2; exit 1 ;;
  esac
}

for table in "$TABLE_RECYCLERS" "$TABLE_PICKUPS" "$TABLE_NOTES"; do
  if awsd dynamodb describe-table --table-name "$table" >/dev/null 2>&1; then
    say "Table exists:    ${table}"
  else
    definition="${TMPDIR_SETUP}/${table}.json"
    write_table_definition "$table" "$definition"
    awsd dynamodb create-table --cli-input-json "file://${definition}" >/dev/null
    say "Table created:   ${table}"
  fi
done

# Point-in-time recovery is on from the start, not added later: a load and a credit note
# are the artefact the compliance claim rests on, and the window in which a restore is
# possible is not something to decide after the fact.
#
# It is retried because a table that was only just created answers
# `ContinuousBackupsUnavailableException` — enabling backups is asynchronous on
# DynamoDB's side, and a setup script that gives up on the first 400 is a script that
# works only the second time it is run.
enable_pitr() {
  local table="$1" attempt=1
  while [ "$attempt" -le 10 ]; do
    if awsd dynamodb update-continuous-backups \
      --table-name "$table" \
      --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
    attempt=$((attempt + 1))
  done
  return 1
}

for table in "$TABLE_RECYCLERS" "$TABLE_PICKUPS" "$TABLE_NOTES"; do
  awsd dynamodb wait table-exists --table-name "$table"
  if enable_pitr "$table"; then
    say "PITR enabled:   ${table}"
  else
    say "PITR FAILED:    ${table} — enable it by hand before trusting a restore" >&2
    PITR_FAILED=1
  fi
done
if [ "${PITR_FAILED:-0}" = "1" ]; then
  say "" >&2
  say "At least one table has no point-in-time recovery. Continuing, so the rest of the" >&2
  say "setup can be inspected, but the trail is not protected until this is fixed." >&2
fi

# ---------------------------------------------------------------- pickups stream

# The payout function runs off this stream: settlement writes `payoutStatus = pending`
# and the stream carries that change to `ecoepr-pickup-payout`. Old *and* new images,
# because "just moved to settled" is a comparison between the two — a new image alone
# cannot tell a fresh settlement from a later write to a settled load.
STREAM_ENABLED="$(awsd dynamodb describe-table --table-name "$TABLE_PICKUPS" \
  --query 'Table.StreamSpecification.StreamEnabled' --output text 2>/dev/null || true)"
if [ "$STREAM_ENABLED" != "True" ]; then
  awsd dynamodb update-table \
    --table-name "$TABLE_PICKUPS" \
    --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES >/dev/null
  awsd dynamodb wait table-exists --table-name "$TABLE_PICKUPS"
  say "Stream enabled:  ${TABLE_PICKUPS} (NEW_AND_OLD_IMAGES)"
else
  say "Stream exists:   ${TABLE_PICKUPS}"
fi
PICKUPS_STREAM_ARN="$(awsd dynamodb describe-table --table-name "$TABLE_PICKUPS" \
  --query 'Table.LatestStreamArn' --output text)"

# --------------------------------------------------------------------- IAM role

ROLE_ARN="$(awsd iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || true)"

if [ -z "$ROLE_ARN" ] || [ "$ROLE_ARN" = "None" ]; then
  cat > "${TMPDIR_SETUP}/trust.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON
  ROLE_ARN="$(awsd iam create-role \
    --role-name "$ROLE_NAME" \
    --description "EcoEPR smart pickup: the three feature-4 tables and CloudWatch Logs" \
    --assume-role-policy-document "file://${TMPDIR_SETUP}/trust.json" \
    --query 'Role.Arn' --output text)"
  say "Role created:    ${ROLE_NAME}"
else
  say "Role exists:     ${ROLE_NAME}"
fi

awsd iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" >/dev/null

# The inline policy names six resources: three tables and the index ARNs that the
# routing index belongs to. A `Resource: "*"` here would let a bug in this function read
# the archive's metadata or any table added later, and the whole point of a dedicated
# role is that the mistake is bounded.
#
# The action list is what the routes actually issue, and `dynamodb:Scan` earns its place
# in it: the operator's board — `GET /pickups` with no `collectorId` — is a full read of
# the loads table, which is the one question its keys cannot answer (see the note above
# `scan` in `aws/pickup/dynamo.mjs`). It was missing when that read shipped, and the
# omission reached the operator as a 500 on a route whose code was correct, which is why
# the list is here rather than only in the handler's head.
cat > "${TMPDIR_SETUP}/policy.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SmartPickupTables",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:ConditionCheckItem",
        "dynamodb:TransactWriteItems"
      ],
      "Resource": [
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE_RECYCLERS}",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE_RECYCLERS}/index/*",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE_PICKUPS}",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE_PICKUPS}/index/*",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE_NOTES}",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE_NOTES}/index/*"
      ]
    }
  ]
}
JSON

awsd iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "file://${TMPDIR_SETUP}/policy.json" >/dev/null
say "Inline policy:   ${POLICY_NAME} (six resources, no wildcard table)"

# ------------------------------------------------------------------ payout role

# A second role rather than a wider first one. The payout function reads one stream and
# updates one table; it has no reason to read the recycler directory or write a credit
# note, and the API function has no reason to read the stream.
PAYOUT_ROLE_ARN="$(awsd iam get-role --role-name "$PAYOUT_ROLE" --query 'Role.Arn' --output text 2>/dev/null || true)"
if [ -z "$PAYOUT_ROLE_ARN" ] || [ "$PAYOUT_ROLE_ARN" = "None" ]; then
  cat > "${TMPDIR_SETUP}/trust.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON
  PAYOUT_ROLE_ARN="$(awsd iam create-role \
    --role-name "$PAYOUT_ROLE" \
    --description "EcoEPR pickup payout: the pickups stream, and payout fields on the pickups table" \
    --assume-role-policy-document "file://${TMPDIR_SETUP}/trust.json" \
    --query 'Role.Arn' --output text)"
  say "Role created:    ${PAYOUT_ROLE}"
else
  say "Role exists:     ${PAYOUT_ROLE}"
fi

awsd iam attach-role-policy \
  --role-name "$PAYOUT_ROLE" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" >/dev/null

cat > "${TMPDIR_SETUP}/payout-policy.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PickupsStream",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:ListStreams"
      ],
      "Resource": "${PICKUPS_STREAM_ARN}"
    },
    {
      "Sid": "PayoutWrite",
      "Effect": "Allow",
      "Action": ["dynamodb:UpdateItem", "dynamodb:PutItem", "dynamodb:TransactWriteItems"],
      "Resource": "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE_PICKUPS}"
    }
  ]
}
JSON
awsd iam put-role-policy \
  --role-name "$PAYOUT_ROLE" \
  --policy-name "$PAYOUT_POLICY" \
  --policy-document "file://${TMPDIR_SETUP}/payout-policy.json" >/dev/null
say "Inline policy:   ${PAYOUT_POLICY} (one stream, one table)"

# ----------------------------------------------------------------- CloudWatch logs

LOG_GROUP="/aws/lambda/${FUNCTION_NAME}"
if ! awsd logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" \
  --query "logGroups[?logGroupName=='${LOG_GROUP}'].logGroupName" --output text | grep -q .; then
  awsd logs create-log-group --log-group-name "$LOG_GROUP" >/dev/null
  say "Log group created: ${LOG_GROUP}"
else
  say "Log group exists:  ${LOG_GROUP}"
fi
# The group is created before the function, on purpose: a Lambda that creates its own
# group gets "never expire", and a 14-day retention has to be set on an existing group.
awsd logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 14 >/dev/null
say "Log retention:   14 days"

PAYOUT_LOG_GROUP="/aws/lambda/${PAYOUT_FUNCTION}"
if ! awsd logs describe-log-groups --log-group-name-prefix "$PAYOUT_LOG_GROUP" \
  --query "logGroups[?logGroupName=='${PAYOUT_LOG_GROUP}'].logGroupName" --output text | grep -q .; then
  awsd logs create-log-group --log-group-name "$PAYOUT_LOG_GROUP" >/dev/null
  say "Log group created: ${PAYOUT_LOG_GROUP}"
fi
awsd logs put-retention-policy --log-group-name "$PAYOUT_LOG_GROUP" --retention-in-days 14 >/dev/null

# -------------------------------------------------------------------- Lambda zip

# The handler is plain ESM with no dependencies, so the deployment package is the
# source files themselves — no bundler, no `node_modules`, nothing to keep in sync.
build_zip() {
  local out="$1"
  rm -f "$out"
  mkdir -p "$(dirname "$out")"
  if command -v zip >/dev/null 2>&1; then
    ( cd aws/pickup && zip -q -X "../../${out}" ./*.mjs )
  else
    # `command -v` alone is not enough: on Windows, `python3` is often the Microsoft
    # Store stub, which exists on PATH and refuses to run. The probe asks whether the
    # interpreter can actually import `zipfile`, so the stub is skipped rather than
    # picked and failed on.
    local py=""
    for candidate in python python3 py; do
      if command -v "$candidate" >/dev/null 2>&1 &&
        "$candidate" -c "import zipfile" >/dev/null 2>&1; then
        py="$candidate"
        break
      fi
    done
    if [ -z "$py" ]; then
      say "Neither 'zip' nor python is available to build the deployment package." >&2
      exit 1
    fi
    ( cd aws/pickup && "$py" -m zipfile -c "../../${out}" ./*.mjs )
  fi
}

ZIP="dist/${FUNCTION_NAME}.zip"
build_zip "$ZIP"
say "Packaged:        ${ZIP}"

ENVIRONMENT="Variables={PICKUP_TABLE_RECYCLERS=${TABLE_RECYCLERS},PICKUP_TABLE_PICKUPS=${TABLE_PICKUPS},PICKUP_TABLE_CREDIT_NOTES=${TABLE_NOTES}}"

# ------------------------------------------------------------------------- Lambda

if awsd lambda get-function --function-name "$FUNCTION_NAME" >/dev/null 2>&1; then
  say "Function exists: ${FUNCTION_NAME} — updating code and configuration"
  awsd lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://${ZIP}" >/dev/null
  awsd lambda wait function-updated --function-name "$FUNCTION_NAME"
  awsd lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --handler "index.handler" \
    --timeout 10 \
    --memory-size 256 \
    --environment "$ENVIRONMENT" >/dev/null
  awsd lambda wait function-updated --function-name "$FUNCTION_NAME"
else
  # arm64: this is a small, bursty, JSON-shaped function and Graviton is the cheaper
  # choice for exactly that shape. Nothing here is x86-specific.
  awsd lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --description "Feature 4: route a load to a licensed recycler, then issue the collector's credit note" \
    --runtime "$RUNTIME" \
    --role "$ROLE_ARN" \
    --handler "index.handler" \
    --architectures arm64 \
    --timeout 10 \
    --memory-size 256 \
    --zip-file "fileb://${ZIP}" \
    --environment "$ENVIRONMENT" >/dev/null
  awsd lambda wait function-active --function-name "$FUNCTION_NAME"
  say "Function created: ${FUNCTION_NAME}"
fi

FUNCTION_ARN="$(awsd lambda get-function --function-name "$FUNCTION_NAME" \
  --query 'Configuration.FunctionArn' --output text)"

# ----------------------------------------------------------------- payout Lambda

# Same zip, different entry point: `payout.handler` shares the marshaller and the
# repository with the API, so a payout writes the trail in exactly the shape the API
# reads it back in.
if awsd lambda get-function --function-name "$PAYOUT_FUNCTION" >/dev/null 2>&1; then
  say "Function exists: ${PAYOUT_FUNCTION} — updating code and configuration"
  awsd lambda update-function-code \
    --function-name "$PAYOUT_FUNCTION" \
    --zip-file "fileb://${ZIP}" >/dev/null
  awsd lambda wait function-updated --function-name "$PAYOUT_FUNCTION"
  awsd lambda update-function-configuration \
    --function-name "$PAYOUT_FUNCTION" \
    --runtime "$RUNTIME" \
    --handler "payout.handler" \
    --timeout 30 \
    --memory-size 128 \
    --environment "$ENVIRONMENT" >/dev/null
  awsd lambda wait function-updated --function-name "$PAYOUT_FUNCTION"
else
  # A role created a moment ago is not yet assumable by Lambda — IAM is eventually
  # consistent — and `create-function` says so with an InvalidParameterValueException.
  # Retried briefly rather than failed, for the same reason PITR is.
  attempt=1
  until awsd lambda create-function \
    --function-name "$PAYOUT_FUNCTION" \
    --description "Feature 4: send the collector's UPI credit when a load settles (simulated rail)" \
    --runtime "$RUNTIME" \
    --role "$PAYOUT_ROLE_ARN" \
    --handler "payout.handler" \
    --architectures arm64 \
    --timeout 30 \
    --memory-size 128 \
    --zip-file "fileb://${ZIP}" \
    --environment "$ENVIRONMENT" >/dev/null 2>"${TMPDIR_SETUP}/payout-create.err"; do
    if [ "$attempt" -ge 10 ]; then
      cat "${TMPDIR_SETUP}/payout-create.err" >&2
      exit 1
    fi
    sleep 3
    attempt=$((attempt + 1))
  done
  awsd lambda wait function-active --function-name "$PAYOUT_FUNCTION"
  say "Function created: ${PAYOUT_FUNCTION}"
fi

# The filter keeps the function from being invoked for every write to the table — the
# PIN counter, the event rows, the payout's own update. Only a META item that now reads
# settled with a pending payout gets through; the handler checks the old image too.
cat > "${TMPDIR_SETUP}/payout-filter.json" <<'JSON'
{
  "Filters": [
    {
      "Pattern": "{\"eventName\":[\"MODIFY\"],\"dynamodb\":{\"NewImage\":{\"sk\":{\"S\":[\"META\"]},\"status\":{\"S\":[\"settled\"]},\"payoutStatus\":{\"S\":[\"pending\"]}}}}"
    }
  ]
}
JSON

MAPPING_ID="$(awsd lambda list-event-source-mappings \
  --function-name "$PAYOUT_FUNCTION" \
  --event-source-arn "$PICKUPS_STREAM_ARN" \
  --query 'EventSourceMappings[0].UUID' --output text)"
if [ -z "$MAPPING_ID" ] || [ "$MAPPING_ID" = "None" ]; then
  awsd lambda create-event-source-mapping \
    --function-name "$PAYOUT_FUNCTION" \
    --event-source-arn "$PICKUPS_STREAM_ARN" \
    --starting-position LATEST \
    --batch-size 10 \
    --maximum-retry-attempts 5 \
    --function-response-types ReportBatchItemFailures \
    --filter-criteria "file://${TMPDIR_SETUP}/payout-filter.json" >/dev/null
  say "Stream trigger created: ${TABLE_PICKUPS} -> ${PAYOUT_FUNCTION}"
else
  awsd lambda update-event-source-mapping \
    --uuid "$MAPPING_ID" \
    --filter-criteria "file://${TMPDIR_SETUP}/payout-filter.json" >/dev/null
  say "Stream trigger exists:  ${MAPPING_ID}"
fi

# --------------------------------------------------------------- API Gateway (HTTP)

API_ID="$(awsd apigatewayv2 get-apis --query "Items[?Name=='${API_NAME}'].ApiId | [0]" --output text)"
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID="$(awsd apigatewayv2 create-api \
    --name "$API_NAME" \
    --protocol-type HTTP \
    --description "EcoEPR smart pickup and digital credit (feature 4)" \
    --query ApiId --output text)"
  say "API created:     ${API_NAME} (${API_ID})"
else
  say "API exists:      ${API_NAME} (${API_ID})"
fi

# One integration for all routes: same function, same payload format. The routes below
# differ only in method, path and the authorizer they share.
INTEGRATION_ID="$(awsd apigatewayv2 get-integrations --api-id "$API_ID" \
  --query "Items[?IntegrationUri=='${FUNCTION_ARN}'].IntegrationId | [0]" --output text)"
if [ -z "$INTEGRATION_ID" ] || [ "$INTEGRATION_ID" = "None" ]; then
  INTEGRATION_ID="$(awsd apigatewayv2 create-integration \
    --api-id "$API_ID" \
    --integration-type AWS_PROXY \
    --integration-uri "$FUNCTION_ARN" \
    --integration-method POST \
    --payload-format-version "2.0" \
    --timeout-in-millis 10000 \
    --query IntegrationId --output text)"
  say "Integration created: ${INTEGRATION_ID}"
else
  say "Integration exists:  ${INTEGRATION_ID}"
fi

# Identity is the existing Cognito pool — the same pool, the same groups and the same
# role ladder the product screens use. The API adds no second user store and no shared
# secret to distribute.
AUTHORIZER_ID="$(awsd apigatewayv2 get-authorizers --api-id "$API_ID" \
  --query "Items[?Name=='${AUTHORIZER_NAME}'].AuthorizerId | [0]" --output text)"
if [ -z "$AUTHORIZER_ID" ] || [ "$AUTHORIZER_ID" = "None" ]; then
  AUTHORIZER_ID="$(awsd apigatewayv2 create-authorizer \
    --api-id "$API_ID" \
    --name "$AUTHORIZER_NAME" \
    --authorizer-type JWT \
    --identity-source '$request.header.Authorization' \
    --jwt-configuration "Issuer=${ISSUER},Audience=${COGNITO_CLIENT}" \
    --query AuthorizerId --output text)"
  say "Authorizer created:  ${AUTHORIZER_NAME} (${AUTHORIZER_ID})"
else
  say "Authorizer exists:   ${AUTHORIZER_NAME} (${AUTHORIZER_ID})"
fi

create_route() {
  local route_key="$1"
  local existing
  existing="$(awsd apigatewayv2 get-routes --api-id "$API_ID" \
    --query "Items[?RouteKey=='${route_key}'].RouteId | [0]" --output text)"
  if [ -n "$existing" ] && [ "$existing" != "None" ]; then
    say "  route exists:  ${route_key}"
    return 0
  fi
  awsd apigatewayv2 create-route \
    --api-id "$API_ID" \
    --route-key "$route_key" \
    --target "integrations/${INTEGRATION_ID}" \
    --authorization-type JWT \
    --authorizer-id "$AUTHORIZER_ID" >/dev/null
  say "  route created: ${route_key}"
}

say "Routes:"
create_route "GET /"
create_route "GET /health"
create_route "GET /streams"
create_route "GET /recyclers"
create_route "POST /pickups"
create_route "GET /pickups"
create_route "GET /pickups/{pickupId}"
create_route "GET /pickups/{pickupId}/events"
create_route "POST /pickups/{pickupId}/pin"
create_route "POST /pickups/{pickupId}/settle"
create_route "GET /credit-notes/{pickupId}"

# API Gateway may invoke this one function, from this one API, and nothing wider.
awsd lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id "apigateway-${API_ID}" \
  --action "lambda:InvokeFunction" \
  --principal "apigateway.amazonaws.com" \
  --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT}:${API_ID}/*/*" >/dev/null 2>&1 || true

# The `$default` stage auto-deploys, which is what keeps route changes from needing a
# separate deployment step. Throttling is set at the stage because this API has no API
# key: the ceiling protects the tables, and the token is what protects the data.
STAGE="$(awsd apigatewayv2 create-stage \
  --api-id "$API_ID" --stage-name '$default' --auto-deploy \
  --query StageName --output text 2>/dev/null || true)"
awsd apigatewayv2 update-stage \
  --api-id "$API_ID" \
  --stage-name '$default' \
  --auto-deploy \
  --default-route-settings '{"ThrottlingBurstLimit":20,"ThrottlingRateLimit":10}' >/dev/null
say "Stage: \$default (auto-deploy, 10 req/s steady, 20 burst)"

API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com"

# ---------------------------------------------------------------------- write env

if [ "$WRITE_ENV" = "1" ]; then
  upsert_env() {
    local file="$1" key="$2" value="$3"
    [ -f "$file" ] || : > "$file"
    local tmp
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" '
      BEGIN { done = 0 }
      index($0, k "=") == 1 { print k "=" v; done = 1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
  }
  upsert_env "$ENV_FILE" PICKUP_API_URL "$API_URL"
  upsert_env "$ENV_FILE" PICKUP_API_ID "$API_ID"
  upsert_env "$ENV_FILE" PICKUP_REGION "$REGION"
  upsert_env "$ENV_FILE" PICKUP_TABLE_RECYCLERS "$TABLE_RECYCLERS"
  upsert_env "$ENV_FILE" PICKUP_TABLE_PICKUPS "$TABLE_PICKUPS"
  upsert_env "$ENV_FILE" PICKUP_TABLE_CREDIT_NOTES "$TABLE_NOTES"
  say "Wrote PICKUP_* configuration into ${ENV_FILE}."
fi

# -------------------------------------------------------------------------- seed

if [ "$SEED" = "1" ]; then
  say "Seeding the recycler directory…"
  PICKUP_TABLE_RECYCLERS="$TABLE_RECYCLERS" node --env-file="$ENV_FILE" scripts/pickup-seed.mjs
fi

say ""
say "Provisioned."
say "  API URL        ${API_URL}"
say "  Function       ${FUNCTION_NAME}"
say "  Payout         ${PAYOUT_FUNCTION} (stream-triggered)"
say "  Tables         ${TABLE_RECYCLERS}, ${TABLE_PICKUPS}, ${TABLE_NOTES}"
say "  Authorizer     ${ISSUER}"
say ""
say "Next:"
say "  node --env-file=${ENV_FILE} scripts/pickup-seed.mjs   # write the catalogue"
say "  node --env-file=${ENV_FILE} scripts/pickup-check.mjs  # drive the API end to end"
say ""
say "The API is private: every route needs a Cognito ID token for a user in one of the"
say "eco-* groups, and each route then names its own minimum — the loads and their reads"
say "need eco-operator or above, the recycler directory needs eco-officer. The check"
say "script creates a temporary operator, uses it, and deletes it."
