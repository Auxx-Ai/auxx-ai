#!/bin/bash
# Debug script for updating the SDK in an existing test app

set -e

# Check if test app path is provided
if [ -z "$1" ]; then
  echo "Usage: ./debug-update.sh <test-app-path>"
  echo ""
  echo "Example: ./debug-update.sh /tmp/auxx-test-1234567890/test-app"
  exit 1
fi

TEST_APP_DIR="$1"

if [ ! -d "$TEST_APP_DIR" ]; then
  echo "Error: Directory not found: $TEST_APP_DIR"
  exit 1
fi

# Determine SDK directory using git root
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
  echo "Error: Not in a git repository"
  exit 1
fi
SDK_DIR="$REPO_ROOT/packages/sdk"

echo "Updating SDK in test app..."
echo "SDK directory: $SDK_DIR"
echo "Test app directory: $TEST_APP_DIR"
echo ""

# Build the SDK
echo "Building SDK..."
cd "$SDK_DIR"
pnpm build

# Create tarball
echo "Creating SDK tarball..."
TARBALL=$(pnpm pack --pack-destination /tmp 2>&1 | grep -o '[^/]*\.tgz$')
TARBALL_PATH="/tmp/$TARBALL"

echo "Tarball created: $TARBALL_PATH"

# Install in test app
echo "Installing SDK from tarball..."
cd "$TEST_APP_DIR"
pnpm remove @auxx/sdk 2>/dev/null || true
pnpm add "file:$TARBALL_PATH"

echo ""
echo "✅ SDK updated successfully!"
echo ""
echo "Now restart your dev server:"
echo "  cd $TEST_APP_DIR"
echo "  pnpm dev"
echo ""
