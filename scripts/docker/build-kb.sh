#!/bin/bash
# scripts/docker/build-kb.sh
# Quick build script for kb app

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/build-app.sh" kb "$@"