#!/usr/bin/env bash
# apps/lambda/scripts/probe-isolation.sh
#
# Runs the process-isolation probe (D3, §10 row 9) in Docker.
#
# Docker is not optional. `deno compile` invoked from apps/lambda on a host Mac grows
# unbounded — ~84 GB RSS, swap exhausted, session killed, with a 0-byte dist/*.tmp-<hash>
# as the tell. A file with zero imports reproduces it, so it is not our code. The
# identical compile in a container takes about a second.
#
# Usage:  ./apps/lambda/scripts/probe-isolation.sh
# Exits nonzero if any isolation expectation is violated.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DENO_IMAGE="${DENO_IMAGE:-denoland/deno:2.7.14}"

echo "[probe] image: $DENO_IMAGE"

# --allow-run so the probe can compile and spawn the runners; --allow-read/write for
# the compile output. These are the PARENT's permissions and are deliberately wide —
# what is under test is the child binary, which gets nothing.
exec docker run --rm \
  -v "$SCRIPT_DIR/isolation-probe:/probe:ro" \
  --tmpfs /work:exec,size=1g \
  --entrypoint deno \
  "$DENO_IMAGE" \
  run --no-config --allow-run --allow-read --allow-write --allow-env \
  /probe/probe.ts
