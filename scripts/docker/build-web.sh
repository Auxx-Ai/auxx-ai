#!/bin/bash
# scripts/docker/build-web.sh
# Quick build script for web app

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/build-app.sh" web "$@"