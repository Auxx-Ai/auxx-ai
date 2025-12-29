#!/bin/bash
# scripts/docker/build-worker.sh
# Quick build script for worker app

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/build-app.sh" worker "$@"