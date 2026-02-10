#!/bin/bash
# scripts/setup-github-ci.sh
# Sets up GitHub environments, secrets, and variables for CI/CD.
# Reads values from your local .env file.
#
# Usage:
#   gh auth login          # if not already authenticated
#   bash scripts/setup-github-ci.sh

set -e

REPO="auxxai/auxx-ai"
ENV_FILE="$(dirname "$0")/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env file not found at $ENV_FILE"
  exit 1
fi

# Helper: read a value from .env by key
env_val() {
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d'=' -f2-
}

echo "=== Step 1: Create GitHub Environments ==="
echo "Creating 'dev' environment..."
gh api "repos/$REPO/environments/dev" -X PUT --silent || true
echo "Creating 'prod' environment..."
gh api "repos/$REPO/environments/prod" -X PUT --silent || true
echo "Done."
echo ""

echo "=== Step 2: Set Repository Secrets ==="
# These are sensitive values — stored encrypted on GitHub

SECRETS=(
  REDIS_PASSWORD
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  MAILGUN_API_KEY
  OPENAI_API_KEY
  ANTHROPIC_API_KEY
  GOOGLE_API_KEY
  PUSHER_SECRET
  BETTER_AUTH_SECRET
  GOOGLE_CLIENT_EMAIL
  GOOGLE_PROJECT_ID
  GOOGLE_PRIVATE_KEY
  AUTH_GOOGLE_SECRET
)

for key in "${SECRETS[@]}"; do
  val=$(env_val "$key")
  if [ -n "$val" ]; then
    echo "  Setting secret: $key"
    echo "$val" | gh secret set "$key" --repo "$REPO" --body -
  else
    echo "  SKIPPED (not in .env): $key"
  fi
done
echo "Done."
echo ""

echo "=== Step 3: Set Repository Variables ==="
# These are non-sensitive — visible to anyone with repo access

VARIABLES=(
  NEXT_PUBLIC_BASE_URL
  NEXT_PUBLIC_APP_URL
  NEXT_PUBLIC_S3_REGION
  NEXT_PUBLIC_S3_BUCKET
  NEXT_PUBLIC_PUSHER_KEY
  NEXT_PUBLIC_PUSHER_CLUSTER
  NEXT_PUBLIC_POSTHOG_KEY
  NEXT_PUBLIC_POSTHOG_HOST
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
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
)

for key in "${VARIABLES[@]}"; do
  val=$(env_val "$key")
  if [ -n "$val" ]; then
    echo "  Setting variable: $key = $val"
    gh variable set "$key" --repo "$REPO" --body "$val" 2>/dev/null || \
      gh variable set "$key" --repo "$REPO" --body "$val"
  else
    echo "  SKIPPED (not in .env): $key"
  fi
done
echo "Done."
echo ""

echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Push to main to trigger a dev deploy"
echo "  2. Watch it at: https://github.com/$REPO/actions"
echo ""
echo "If dev and prod need DIFFERENT values (e.g. NEXT_PUBLIC_BASE_URL),"
echo "set them per-environment in GitHub Settings > Environments instead."
