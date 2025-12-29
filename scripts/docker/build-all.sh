#!/bin/bash
# scripts/docker/build-all.sh

set -e

ENVIRONMENT=${1:-development}
BUILD_ONLY=${2:-true}
TAG=${3:-latest}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================="
echo "Building all apps for $ENVIRONMENT environment"
echo "Tag: $TAG"
echo "Build only: $BUILD_ONLY"
echo "========================================="

# Array of apps to build
apps=("web" "worker" "docs" "kb")

# Track build status
declare -a pids
declare -a app_names
failed=false

# Build apps in parallel
for app in "${apps[@]}"; do
    echo ""
    echo "Starting build for $app..."
    
    # Run build in background
    "$SCRIPT_DIR/build-app.sh" "$app" "$ENVIRONMENT" "$BUILD_ONLY" "$TAG" &
    
    # Store PID and app name for tracking
    pids+=($!)
    app_names+=($app)
done

echo ""
echo "Waiting for all builds to complete..."
echo ""

# Wait for all builds and check their status
for i in "${!pids[@]}"; do
    if wait "${pids[$i]}"; then
        echo "✅ ${app_names[$i]} build completed successfully"
    else
        echo "❌ ${app_names[$i]} build failed"
        failed=true
    fi
done

echo ""
echo "========================================="

if [ "$failed" = true ]; then
    echo "⚠️  Some builds failed. Please check the logs above."
    exit 1
else
    echo "✅ All apps built successfully!"
    echo ""
    echo "Built images:"
    docker images | head -1
    docker images | grep "auxx-ai-" | grep "$TAG" || echo "No images found with tag: $TAG"
fi

echo "========================================="