#!/bin/bash
# packages/sdk/debug-link.sh
# Debug script using pnpm link for faster iteration

set -e

# Parse command line arguments
USE_TEST_ENV=false
VERBOSE=false
APP_SLUG="test-app"
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --test)
      USE_TEST_ENV=true
      shift
      ;;
    --verbose|-v)
      VERBOSE=true
      set -x
      shift
      ;;
    -s|--slug)
      APP_SLUG="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Determine SDK directory
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
  echo "Error: Not in a git repository."
  exit 1
fi
SDK_DIR="$REPO_ROOT/packages/sdk"

if [ ! -d "$SDK_DIR" ]; then
  echo "Error: SDK directory not found at $SDK_DIR"
  exit 1
fi

[ "$VERBOSE" = true ] && echo "Using SDK directory: $SDK_DIR"

# Build the SDK (unless skipped)
if [ "$SKIP_BUILD" = false ]; then
  echo "Building SDK..."
  cd "$SDK_DIR"
  pnpm build
else
  echo "Skipping build (--skip-build flag set)"
fi

# Create test directory
TEST_DIR="/tmp/auxx-test-$(date +%s)"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo ""
echo "Test directory: $TEST_DIR"
echo ""

# Run auxx init
echo "=========================================="
echo "Running auxx init command..."
echo "=========================================="

if [ "$USE_TEST_ENV" = true ]; then
  echo "Running with NODE_ENV=test"
  NODE_ENV=test node "$SDK_DIR/lib/auxx.js" init "$APP_SLUG"
else
  node "$SDK_DIR/lib/auxx.js" init "$APP_SLUG"
fi

# Install SDK in the created app using file: protocol (creates symlink)
echo ""
echo "Installing SDK from local directory..."
cd "$TEST_DIR/$APP_SLUG"

# Remove existing SDK if installed
pnpm remove @auxx/sdk 2>/dev/null || true

# Install SDK from local directory (using file: protocol)
pnpm add "file:$SDK_DIR"

echo ""
echo "✓ Test completed successfully!"
echo ""
echo "Test directory: $TEST_DIR/$APP_SLUG"
echo "SDK linked from: $SDK_DIR"
echo ""
echo "To test the app:"
echo "  cd $TEST_DIR/$APP_SLUG"
echo "  pnpm dev"
echo ""
echo "To refresh SDK after changes:"
echo "  cd $SDK_DIR"
echo "  pnpm build"
echo "  # Restart your test app's dev server"
echo ""
echo "Note: The SDK is installed using file: protocol."
echo "Changes require rebuilding the SDK and restarting dev server."
echo ""
