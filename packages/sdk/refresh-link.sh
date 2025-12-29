#!/bin/bash
# packages/sdk/refresh-link.sh
# Rebuild and refresh the globally linked SDK

set -e

VERBOSE=false
SKIP_BUILD=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --verbose|-v)
      VERBOSE=true
      set -x
      shift
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

cd "$SDK_DIR"

echo "=========================================="
echo "Rebuilding @auxx/sdk"
echo "=========================================="

# Build the SDK
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo "Building SDK..."
  pnpm build
  echo ""
  echo "✓ Build complete"
else
  echo ""
  echo "⚠️  Skipping build (--skip-build flag set)"
fi

echo ""
echo "=========================================="
echo "✓ SDK rebuilt successfully!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Restart any dev servers using this SDK"
echo "2. Changes will be reflected immediately (file: protocol symlink)"
echo ""
