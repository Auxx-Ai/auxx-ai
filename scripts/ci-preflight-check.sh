#!/bin/bash
# scripts/ci-preflight-check.sh
# Validates everything is ready before running setup-github-ci.sh.
# Checks: gh auth, repo access, AWS role, .env values, environments.
#
# Usage: bash scripts/ci-preflight-check.sh

set -e

REPO="auxxai/auxx-ai"
ENV_FILE="$(dirname "$0")/../.env"
ERRORS=0
WARNINGS=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; ERRORS=$((ERRORS+1)); }
warn() { echo "  ! $1"; WARNINGS=$((WARNINGS+1)); }

# Helper: read a value from .env by key, strip surrounding quotes
env_val() {
  local raw
  raw=$(grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d'=' -f2-)
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  echo "$raw"
}

# Vars that SST computes from infrastructure — setup script will skip these
SST_MANAGED=(NEXT_PUBLIC_BASE_URL NEXT_PUBLIC_APP_URL REDIS_HOST REDIS_PORT)

is_sst_managed() {
  for v in "${SST_MANAGED[@]}"; do
    [ "$1" = "$v" ] && return 0
  done
  return 1
}

echo "=== 1. GitHub CLI ==="

if ! command -v gh &>/dev/null; then
  fail "gh CLI not installed. Run: brew install gh"
else
  pass "gh CLI installed ($(gh --version | head -1))"
fi

if gh auth status &>/dev/null; then
  ACCOUNT=$(gh auth status 2>&1 | grep "account" | awk '{print $NF}' | tr -d '()')
  pass "Authenticated as $ACCOUNT"
else
  fail "Not authenticated. Run: gh auth login"
fi

echo ""
echo "=== 2. Repository Access ==="

if gh repo view "$REPO" --json name &>/dev/null; then
  pass "Can access $REPO"
else
  fail "Cannot access $REPO — check repo name and permissions"
fi

# Check required token scopes
SCOPES=$(gh auth status 2>&1 | grep "Token scopes" || echo "")
if echo "$SCOPES" | grep -q "repo"; then
  pass "Token has 'repo' scope"
else
  fail "Token missing 'repo' scope"
fi
if echo "$SCOPES" | grep -q "workflow"; then
  pass "Token has 'workflow' scope"
else
  fail "Token missing 'workflow' scope — needed to trigger Actions"
fi

echo ""
echo "=== 3. GitHub Environments ==="

for ENV_NAME in dev prod; do
  STATUS=$(gh api "repos/$REPO/environments/$ENV_NAME" --silent 2>&1 && echo "exists" || echo "missing")
  if [ "$STATUS" = "exists" ]; then
    pass "Environment '$ENV_NAME' exists"
  else
    warn "Environment '$ENV_NAME' doesn't exist yet (setup script will create it)"
  fi
done

echo ""
echo "=== 4. AWS IAM Role ==="

if command -v aws &>/dev/null; then
  pass "AWS CLI installed"
  if aws sts get-caller-identity &>/dev/null; then
    pass "AWS credentials valid"
    TRUST=$(aws iam get-role --role-name AuxxGithubDeployRole \
      --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringLike' \
      --output text 2>/dev/null || echo "NOT_FOUND")
    if echo "$TRUST" | grep -q "auxxai/auxx-ai"; then
      pass "AuxxGithubDeployRole trusts repo:auxxai/auxx-ai"
    elif echo "$TRUST" | grep -q "NOT_FOUND"; then
      fail "AuxxGithubDeployRole not found"
    else
      fail "AuxxGithubDeployRole trusts wrong repo: $TRUST"
    fi
  else
    warn "AWS credentials not configured — can't check IAM role"
  fi
else
  warn "AWS CLI not installed — can't check IAM role"
fi

echo ""
echo "=== 5. .env File ==="

if [ ! -f "$ENV_FILE" ]; then
  fail ".env file not found at $ENV_FILE"
else
  pass ".env file found ($(wc -l < "$ENV_FILE" | tr -d ' ') lines)"

  echo ""
  echo "  --- Secrets (will be pushed) ---"
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
      preview="${val:0:4}****"
      pass "$key ($preview)"
    else
      fail "$key — missing from .env"
    fi
  done

  echo ""
  echo "  --- Variables (will be pushed) ---"
  VARIABLES=(
    NEXT_PUBLIC_S3_REGION
    NEXT_PUBLIC_S3_BUCKET
    NEXT_PUBLIC_PUSHER_KEY
    NEXT_PUBLIC_PUSHER_CLUSTER
    POSTHOG_KEY
    POSTHOG_HOST
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    CLOUDFRONT_CERT_ARN
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
      pass "$key = $val"
    else
      warn "$key — missing from .env (will be skipped)"
    fi
  done

  echo ""
  echo "  --- SST-managed (will be skipped) ---"
  for key in "${SST_MANAGED[@]}"; do
    val=$(env_val "$key")
    if [ -n "$val" ]; then
      pass "$key = $val (SST sets this at deploy time, won't push)"
    else
      pass "$key (not in .env, SST handles it)"
    fi
  done
fi

echo ""
echo "================================"
if [ $ERRORS -gt 0 ]; then
  echo "RESULT: $ERRORS error(s), $WARNINGS warning(s)"
  echo "Fix the errors above before running setup-github-ci.sh"
  exit 1
else
  echo "RESULT: All clear! $WARNINGS warning(s)"
  echo "You're ready to run: bash scripts/setup-github-ci.sh"
  exit 0
fi
