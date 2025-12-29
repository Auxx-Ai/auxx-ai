#!/bin/bash
# scripts/docker/build-docs.sh
# Quick build script for docs app

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/build-app.sh" docs "$@"