#!/usr/bin/env bash
#
# Provision Microsoft Foundry for the EcoEPR AI pipeline, idempotently, with the Azure
# CLI, and write the resulting endpoint, key and deployment name into `.env.local`.
#
# The pipeline reads a photograph and a Hindi voice note in one call, so the deployment
# it needs is an audio-capable multimodal model. That family (`gpt-audio`) is not offered
# in every Region; it is offered in `eastus2` and `swedencentral`, which is why the
# default Region here is `eastus2` and not the subscription's home Region.
#
# Usage:
#   bash scripts/foundry-setup.sh [--location eastus2] [--resource-group NAME]
#                                 [--account NAME] [--deployment NAME]
#                                 [--env-file .env.local] [--no-env]
#
# Everything can also come from the environment (FOUNDRY_LOCATION, FOUNDRY_ACCOUNT, …).
# Re-running is safe: an existing resource group, account and deployment are reused.
#
# The key is never printed. It is written to the env file only, and this script prints a
# masked form, so a shared terminal or CI log does not become a credential leak.
set -euo pipefail

LOCATION="${FOUNDRY_LOCATION:-eastus2}"
RESOURCE_GROUP="${FOUNDRY_RESOURCE_GROUP:-ecoepr-foundry-rg}"
ACCOUNT="${FOUNDRY_ACCOUNT:-}"
DEPLOYMENT="${FOUNDRY_DEPLOYMENT:-gpt-audio}"
MODEL_NAME="${FOUNDRY_MODEL_NAME:-gpt-audio}"
MODEL_VERSION="${FOUNDRY_MODEL_VERSION:-2025-08-28}"
SKU_NAME="${FOUNDRY_SKU:-GlobalStandard}"
SKU_CAPACITY="${FOUNDRY_CAPACITY:-1}"
ENV_FILE="${FOUNDRY_ENV_FILE:-.env.local}"
WRITE_ENV=1

while [ $# -gt 0 ]; do
  case "$1" in
    --location) LOCATION="$2"; shift 2 ;;
    --resource-group) RESOURCE_GROUP="$2"; shift 2 ;;
    --account) ACCOUNT="$2"; shift 2 ;;
    --deployment) DEPLOYMENT="$2"; shift 2 ;;
    --model-name) MODEL_NAME="$2"; shift 2 ;;
    --model-version) MODEL_VERSION="$2"; shift 2 ;;
    --sku) SKU_NAME="$2"; shift 2 ;;
    --capacity) SKU_CAPACITY="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --no-env) WRITE_ENV=0; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }

if ! command -v az >/dev/null 2>&1; then
  say "az (Azure CLI) is not on PATH. Install it, then run 'az login'." >&2
  exit 1
fi

if ! az account show >/dev/null 2>&1; then
  say "Not signed in. Run 'az login --use-device-code' first." >&2
  exit 1
fi

SUBSCRIPTION="$(az account show --query name -o tsv)"
say "Subscription: ${SUBSCRIPTION}"
say "Region:       ${LOCATION}   (the gpt-audio family is not offered everywhere)"

# ------------------------------------------------------------------ resource group
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --only-show-errors >/dev/null
say "Resource group ready: ${RESOURCE_GROUP}"

# ------------------------------------------------------------------------- account
if [ -z "$ACCOUNT" ]; then
  # The endpoint is derived from the account name and must be globally unique, so a
  # fresh name is minted when one is not supplied. Re-runs that pass --account reuse it.
  ACCOUNT="ecoepr-foundry-$(od -An -N3 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' || printf '%06x' $((RANDOM * RANDOM)))"
fi

if az cognitiveservices account show -n "$ACCOUNT" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
  say "AI Services account already exists: ${ACCOUNT}"
else
  say "Creating AI Services account: ${ACCOUNT}"
  az cognitiveservices account create \
    --name "$ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --kind AIServices \
    --sku S0 \
    --custom-domain "$ACCOUNT" \
    --yes \
    --only-show-errors >/dev/null
fi

# ---------------------------------------------------------------------- deployment
if az cognitiveservices account deployment show \
  -n "$ACCOUNT" -g "$RESOURCE_GROUP" --deployment-name "$DEPLOYMENT" >/dev/null 2>&1; then
  say "Deployment already exists: ${DEPLOYMENT}"
else
  say "Deploying ${MODEL_NAME}@${MODEL_VERSION} as ${DEPLOYMENT}"
  az cognitiveservices account deployment create \
    --name "$ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --deployment-name "$DEPLOYMENT" \
    --model-name "$MODEL_NAME" \
    --model-version "$MODEL_VERSION" \
    --model-format OpenAI \
    --sku-name "$SKU_NAME" \
    --sku-capacity "$SKU_CAPACITY" \
    --only-show-errors >/dev/null
fi

# -------------------------------------------------------------------------- output
ENDPOINT="$(az cognitiveservices account show -n "$ACCOUNT" -g "$RESOURCE_GROUP" \
  --query properties.endpoint -o tsv)"
KEY="$(az cognitiveservices account keys list -n "$ACCOUNT" -g "$RESOURCE_GROUP" \
  --query key1 -o tsv)"

say ""
say "Provisioned."
say "  AZURE_OPENAI_ENDPOINT=${ENDPOINT}"
say "  AZURE_OPENAI_DEPLOYMENT=${DEPLOYMENT}"
say "  AZURE_SPEECH_REGION=${LOCATION}"
say "  AZURE_OPENAI_API_KEY=${KEY:0:4}…${KEY: -4}  (masked; not printed in full)"

if [ "$WRITE_ENV" = "1" ]; then
  # Upsert each key in place, so re-running never stacks duplicate lines and a value
  # containing `/`, `+` or `=` is written literally (awk -v, not sed, for that reason).
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
  upsert_env "$ENV_FILE" AZURE_OPENAI_ENDPOINT "$ENDPOINT"
  upsert_env "$ENV_FILE" AZURE_OPENAI_API_KEY "$KEY"
  upsert_env "$ENV_FILE" AZURE_OPENAI_DEPLOYMENT "$DEPLOYMENT"
  # Azure Speech lives in the same account and region, so the region is the one fact the
  # voice note needs beyond the key it already shares.
  upsert_env "$ENV_FILE" AZURE_SPEECH_REGION "$LOCATION"
  say ""
  say "Wrote the three AZURE_OPENAI_* values into ${ENV_FILE}."
  say "Restart the dev server so the new environment is read."
else
  say ""
  say "Skipped writing ${ENV_FILE} (--no-env). Add the three values yourself."
fi
