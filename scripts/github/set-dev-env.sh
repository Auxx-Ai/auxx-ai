#!/usr/bin/env bash
set -euo pipefail

# Upload GitHub Environment variables and secrets for a given environment (default: dev)
#
# Requirements:
# - GitHub CLI installed and authenticated (gh auth login)
# - Permissions to manage repo environments/variables/secrets
#
# Usage:
#   ./scripts/github/set-dev-env.sh            # sets dev by default
#   ./scripts/github/set-dev-env.sh prod       # sets prod

ENV_NAME="${1:-dev}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh (GitHub CLI) is required. Install: https://cli.github.com/" >&2
  exit 1
fi

# Detect owner/repo from origin
ORIGIN_URL=$(git remote get-url origin 2>/dev/null || true)
if [ -z "$ORIGIN_URL" ]; then
  ORIGIN_URL=$(git remote -v 2>/dev/null | awk '/origin/ && /fetch/ {print $2; exit}')
fi
if [[ "$ORIGIN_URL" =~ github.com[/:]([^/]+)/([^/.]+) ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
else
  echo "Error: Could not detect GitHub owner/repo from origin: $ORIGIN_URL" >&2
  exit 1
fi

ROOT_DIR=$(git rev-parse --show-toplevel)
DOTENV_FILE="$ROOT_DIR/.env"

ensure_env() {
  echo "Ensuring GitHub environment '$ENV_NAME' exists..."
  if gh api -H "Accept: application/vnd.github+json" \
      "/repos/$OWNER/$REPO/environments/$ENV_NAME" >/dev/null 2>&1; then
    echo "Environment '$ENV_NAME' exists."
    return 0
  fi
  # Create environment with no protection rules (compatible with all plans)
  gh api --method PUT -H "Accept: application/vnd.github+json" \
    "/repos/$OWNER/$REPO/environments/$ENV_NAME" >/dev/null
  echo "Environment '$ENV_NAME' created."
}

get_val() {
  local key="$1"
  # 1) shell env
  if [ -n "${!key-}" ]; then
    printf '%s' "${!key}"
    return 0
  fi
  # 2) .env file
  if [ -f "$DOTENV_FILE" ]; then
    local line
    line=$(grep -E "^${key}=" "$DOTENV_FILE" | tail -n1 | sed -E 's/^'"$key"'=//') || true
    if [ -n "$line" ]; then
      line=$(printf '%s' "$line" | sed -E 's/^"(.*)"$/\1/; s/^\'"'"'(.*)\'"'"'$/\1/')
      printf '%s' "$line"
      return 0
    fi
  fi
  return 1
}

set_var() {
  local name="$1"; shift
  local value="$1"; shift
  echo "[vars] $name"
  gh variable set "$name" --env "$ENV_NAME" --repo "$OWNER/$REPO" --body "$value" >/dev/null
}

set_secret() {
  local name="$1"; shift
  local value="$1"; shift
  echo "[secrets] $name"
  # Convert escaped newlines to real newlines for multiline secrets like GOOGLE_PRIVATE_KEY
  if [ "$name" = "GOOGLE_PRIVATE_KEY" ]; then
    value=$(printf '%b' "$value")
  fi
  gh secret set "$name" --env "$ENV_NAME" --repo "$OWNER/$REPO" --body "$value" >/dev/null
}

VARS=(
  ANTHROPIC_MODEL
  OPENAI_MODEL
  CLOUDFRONT_CERT_ARN
  REDIS_HOST
  REDIS_PORT
  MAILGUN_DOMAIN
  MAILGUN_REGION
  PUSHER_APP_ID
  PUSHER_KEY
  PUSHER_CLUSTER
  SYSTEM_FROM_EMAIL
  SUPPORT_EMAIL
  SUPPORT_NAME
  AUTH_GOOGLE_ID
  GOOGLE_CLIENT_EMAIL
  GOOGLE_PROJECT_ID
  GOOGLE_PUBSUB_TOPIC
  GOOGLE_PUBSUB_SUBSCRIPTION
  OUTLOOK_CLIENT_ID
  DROPBOX_CLIENT_ID
  POSTHOG_HOST
)

SECRETS=(
  DATABASE_URL
  REDIS_PASSWORD
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  MAILGUN_API_KEY
  OPENAI_API_KEY
  ANTHROPIC_API_KEY
  GOOGLE_API_KEY
  AUTH_GOOGLE_SECRET
  PUSHER_SECRET
  # BetterAuth
  BETTER_AUTH_SECRET
  # Google Service Account
  GOOGLE_PRIVATE_KEY
  OUTLOOK_CLIENT_SECRET
  SHOPIFY_API_KEY
  SHOPIFY_API_SECRET
  DROPBOX_CLIENT_SECRET
  POSTHOG_KEY
)

echo "Repo: $OWNER/$REPO"
echo "Environment: $ENV_NAME"
ensure_env

for k in "${VARS[@]}"; do
  if val=$(get_val "$k"); then
    set_var "$k" "$val"
  else
    echo "[vars] Skipping $k (not found in env or .env)"
  fi
done

for k in "${SECRETS[@]}"; do
  if val=$(get_val "$k"); then
    set_secret "$k" "$val"
  else
    echo "[secrets] Skipping $k (not found in env or .env)"
  fi
done

echo "Done. Review variables/secrets in GitHub → Settings → Environments → $ENV_NAME."
