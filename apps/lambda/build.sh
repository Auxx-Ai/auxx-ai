#!/usr/bin/env bash
# apps/lambda/build.sh
#
# Cross-compiles lambda-runtime.ts into a Linux ARM64 bootstrap binary
# for deployment on AWS Lambda provided.al2023.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
BUILD_DIR=$(mktemp -d)

echo "[build] Project root: $PROJECT_ROOT"
echo "[build] Build dir:    $BUILD_DIR"
echo "[build] Dist dir:     $DIST_DIR"

# Clean dist
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Copy source files into build dir (preserving import map paths)
# deno.json sits at build root; @auxx/sdk maps to ./packages/sdk/lib/root/index.js
cp "$SCRIPT_DIR/deno.json" "$BUILD_DIR/deno.json"
cp -r "$SCRIPT_DIR/src" "$BUILD_DIR/src"
mkdir -p "$BUILD_DIR/packages/sdk"
cp -r "$PROJECT_ROOT/packages/sdk/lib" "$BUILD_DIR/packages/sdk/lib"

# The sandbox runner — the child process that evaluates untrusted code. Kept in
# lockstep with Dockerfile.server on purpose (plan D15): if only the Railway build
# is updated, this binary keeps the old permission set and the §10 escape tests pass
# against a binary that is not the one running. Drift here is how a hardened
# permission set silently regresses.
echo "[build] Compiling sandbox runner (aarch64-unknown-linux-gnu)..."

deno compile \
  --target aarch64-unknown-linux-gnu \
  --config "$BUILD_DIR/deno.json" \
  --deny-env --deny-read --deny-write --deny-ffi --deny-run --deny-sys \
  --allow-net \
  --v8-flags=--max-old-space-size=256 \
  --output "$DIST_DIR/runner" \
  "$BUILD_DIR/src/sandbox/runner.ts"

chmod +x "$DIST_DIR/runner"

echo "[build] Compiling bootstrap binary (aarch64-unknown-linux-gnu)..."

deno compile \
  --target aarch64-unknown-linux-gnu \
  --config "$BUILD_DIR/deno.json" \
  --allow-net \
  --allow-env \
  --allow-read=/var/task,/tmp,/bundles \
  --allow-sys \
  --allow-run=/var/task/runner \
  --output "$DIST_DIR/bootstrap" \
  "$BUILD_DIR/src/lambda-runtime.ts"

chmod +x "$DIST_DIR/bootstrap"

# Print info
echo "[build] Done."
ls -lh "$DIST_DIR/bootstrap" "$DIST_DIR/runner"
file "$DIST_DIR/bootstrap" 2>/dev/null || true

# The runner must be deployed alongside the bootstrap at /var/task/runner — the
# path baked into the --allow-run grant above. Set LAMBDA_RUNNER_PATH if it lands
# elsewhere, or spawn.ts will fail closed rather than execute anything.

# Cleanup
rm -rf "$BUILD_DIR"
