#!/bin/bash
# packages/sdk/unlink-sdk.sh
# Remove the global SDK link

set -e

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
echo "Unlinking @auxx/sdk from global pnpm store"
echo "=========================================="
echo ""

# Use pnpm to properly uninstall from global
if pnpm list --global --depth 0 2>/dev/null | grep -q "@auxx/sdk"; then
  echo "Found @auxx/sdk in global packages"
  echo "Removing via pnpm..."

  # Change to a temp directory to avoid conflicts
  TEMP_DIR=$(mktemp -d)
  cd "$TEMP_DIR"

  # Remove from global
  pnpm remove --global @auxx/sdk 2>/dev/null || true

  cd - > /dev/null
  rm -rf "$TEMP_DIR"

  echo "✓ @auxx/sdk unlinked successfully"
else
  echo "⚠️  @auxx/sdk is not currently linked globally"
fi

# Also clean up any leftover symlinks
GLOBAL_DIR=$(pnpm root -g 2>/dev/null)
if [ -n "$GLOBAL_DIR" ]; then
  if [ -e "$GLOBAL_DIR/@auxx/sdk" ] || [ -L "$GLOBAL_DIR/@auxx/sdk" ]; then
    echo "Cleaning up leftover symlink..."
    rm -rf "$GLOBAL_DIR/@auxx/sdk"
    # Also remove parent @auxx directory if it's empty
    if [ -d "$GLOBAL_DIR/@auxx" ] && [ -z "$(ls -A "$GLOBAL_DIR/@auxx")" ]; then
      rmdir "$GLOBAL_DIR/@auxx"
    fi
  fi
fi

echo ""
echo "=========================================="
echo "Cleanup complete"
echo "=========================================="
echo ""
echo "To relink: ./debug-link.sh or ./refresh-link.sh"
echo ""
