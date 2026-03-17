#!/bin/bash
# scripts/integration-test.sh
# Startup script for billing integration tests.
# Manages: stripe listen → capture CLI secret → dev server → run tests → cleanup.
#
# Prerequisites:
#   - Stripe CLI installed and authenticated (`stripe login`)
#   - PostgreSQL running with DATABASE_URL set in .env
#   - Node.js / pnpm available
#
# Usage:
#   ./scripts/integration-test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cleanup() {
  echo ""
  echo "Cleaning up..."
  [ -n "${STRIPE_PID:-}" ] && kill "$STRIPE_PID" 2>/dev/null || true
  [ -n "${DEV_PID:-}" ] && kill "$DEV_PID" 2>/dev/null || true
  exit "${EXIT_CODE:-1}"
}
trap cleanup EXIT INT TERM

echo "=== Billing Integration Tests ==="

# 1. Get CLI webhook secret
echo "→ Capturing Stripe CLI webhook secret..."
CLI_SECRET=$(stripe listen --forward-to localhost:3000/api/billing/webhook --print-secret 2>/dev/null)
if [ -z "$CLI_SECRET" ]; then
  echo "ERROR: Could not capture Stripe CLI webhook secret."
  echo "Make sure you're logged in: stripe login"
  exit 1
fi
echo "  Captured: ${CLI_SECRET:0:15}..."

# 2. Start stripe listen in background
echo "→ Starting Stripe CLI listener..."
stripe listen --forward-to localhost:3000/api/billing/webhook &
STRIPE_PID=$!
sleep 2

# 3. Export for dev server
export STRIPE_WEBHOOK_SECRET="$CLI_SECRET"

# 4. Check if dev server is already running
if curl -s http://localhost:3000 > /dev/null 2>&1; then
  echo "→ Dev server already running at localhost:3000"
  echo "  WARNING: Make sure STRIPE_WEBHOOK_SECRET matches the CLI secret."
  echo "  If tests fail with signature errors, restart the dev server with:"
  echo "  STRIPE_WEBHOOK_SECRET=$CLI_SECRET pnpm dev"
else
  echo "→ Starting dev server..."
  cd "$ROOT_DIR"
  STRIPE_WEBHOOK_SECRET="$CLI_SECRET" pnpm dev &
  DEV_PID=$!

  # Wait for dev server to be ready
  echo "→ Waiting for dev server..."
  RETRIES=60
  while ! curl -s http://localhost:3000 > /dev/null 2>&1; do
    RETRIES=$((RETRIES - 1))
    if [ "$RETRIES" -le 0 ]; then
      echo "ERROR: Dev server did not start within 60 seconds."
      exit 1
    fi
    sleep 1
  done
  echo "  Dev server ready."
fi

# 5. Run tests
echo "→ Running billing integration tests..."
cd "$ROOT_DIR/packages/billing"
pnpm test:integration
EXIT_CODE=$?

if [ "$EXIT_CODE" -eq 0 ]; then
  echo ""
  echo "=== All integration tests passed ==="
else
  echo ""
  echo "=== Integration tests failed (exit code: $EXIT_CODE) ==="
fi
