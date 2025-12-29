#!/bin/bash
# Debug script for testing the auxx init command

set -e

# Parse command line arguments
USE_TEST_ENV=false
VERBOSE=false
APP_SLUG="test-app"
while [[ $# -gt 0 ]]; do
  case $1 in
    --test)
      USE_TEST_ENV=true
      shift
      ;;
    --verbose|-v)
      VERBOSE=true
      set -x  # Enable bash debugging
      shift
      ;;
    -s|--slug)
      APP_SLUG="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Determine SDK directory using git root (path-independent)
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
  echo "Error: Not in a git repository. Please run this script from within the auxx-ai repository."
  exit 1
fi
SDK_DIR="$REPO_ROOT/packages/sdk"

# Verify SDK directory exists
if [ ! -d "$SDK_DIR" ]; then
  echo "Error: SDK directory not found at $SDK_DIR"
  exit 1
fi

[ "$VERBOSE" = true ] && echo "Using SDK directory: $SDK_DIR"

# Build the SDK
echo "Building SDK..."
cd "$SDK_DIR"
pnpm build

# Create tarball
echo "Creating SDK tarball..."
TARBALL=$(pnpm pack --pack-destination /tmp 2>&1 | grep -o '[^/]*\.tgz$')
TARBALL_PATH="/tmp/$TARBALL"

echo "Tarball created: $TARBALL_PATH"

# Create test directory
TEST_DIR="/tmp/auxx-test-$(date +%s)"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo ""
echo "Test directory: $TEST_DIR"
echo ""

# Helper function to check if error is keytar-related
is_keytar_error() {
  local error_output="$1"
  echo "$error_output" | grep -qi "keytar\|prebuild-install\|node-gyp\|bindings"
}

# Helper function to rebuild keytar
rebuild_keytar() {
  echo ""
  echo "=========================================="
  echo "Attempting to rebuild keytar binaries..."
  echo "=========================================="
  cd "$SDK_DIR"
  if pnpm run build:keytar; then
    echo "✓ Keytar rebuild successful"
    return 0
  else
    echo "✗ Keytar rebuild failed"
    echo ""
    echo "Troubleshooting tips:"
    echo "1. Ensure you have build tools installed:"
    if [[ "$OSTYPE" == "darwin"* ]]; then
      echo "   - macOS: xcode-select --install"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
      echo "   - Linux: sudo apt-get install build-essential libsecret-1-dev"
    fi
    echo "2. Try: pnpm clean && pnpm install"
    echo "3. Check Node.js version (requires >= 18.0.0)"
    return 1
  fi
}

# Function to execute init command with retry logic
execute_init() {
  local temp_output
  temp_output=$(mktemp)
  local exit_code=0

  echo ""
  echo "=========================================="
  echo "Running auxx init command..."
  echo "=========================================="

  # Run the init command and capture output
  if [ "$USE_TEST_ENV" = true ]; then
    echo "Running with NODE_ENV=test"
    NODE_ENV=test node "$SDK_DIR/lib/auxx.js" init "$APP_SLUG" 2>&1 | tee "$temp_output"
    exit_code=${PIPESTATUS[0]}
  else
    node "$SDK_DIR/lib/auxx.js" init "$APP_SLUG" 2>&1 | tee "$temp_output"
    exit_code=${PIPESTATUS[0]}
  fi

  # Check if command failed
  if [ $exit_code -ne 0 ]; then
    local error_content
    error_content=$(cat "$temp_output")

    # Check if it's a keytar-related error
    if is_keytar_error "$error_content"; then
      echo ""
      echo "⚠️  Detected keytar binary issue"

      if rebuild_keytar; then
        echo ""
        echo "=========================================="
        echo "Retrying init command after rebuild..."
        echo "=========================================="

        # Retry the init command
        if [ "$USE_TEST_ENV" = true ]; then
          NODE_ENV=test node "$SDK_DIR/lib/auxx.js" init "$APP_SLUG"
          exit_code=$?
        else
          node "$SDK_DIR/lib/auxx.js" init "$APP_SLUG"
          exit_code=$?
        fi

        if [ $exit_code -eq 0 ]; then
          echo "✓ Init command succeeded after keytar rebuild"
        else
          echo "✗ Init command still failed after keytar rebuild"
        fi
      else
        echo ""
        echo "✗ Cannot proceed without keytar binaries"
        rm -f "$temp_output"
        exit 1
      fi
    else
      # Not a keytar error, just propagate the failure
      rm -f "$temp_output"
      exit $exit_code
    fi
  else
    echo "✓ Init command succeeded"
  fi

  rm -f "$temp_output"
  return $exit_code
}

# Run init command with error handling
execute_init

# Install from tarball
echo ""
echo "Installing SDK from local tarball..."
cd "$APP_SLUG"
pnpm remove @auxx/sdk 2>/dev/null || true
pnpm add "file:$TARBALL_PATH"

echo ""
echo "Test completed successfully!"
echo "Test directory: $TEST_DIR/$APP_SLUG"
echo "SDK installed from: $TARBALL_PATH"
echo ""
echo "To test the app:"
echo "  cd $TEST_DIR/$APP_SLUG"
echo "  pnpm dev"
