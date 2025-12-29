#!/bin/bash
# scripts/docker/build-app.sh

set -e

# Parse arguments
APP_NAME=$1
ENVIRONMENT=${2:-development}
BUILD_ONLY=${3:-false}
TAG=${4:-latest}

# Validate app name
if [[ ! "$APP_NAME" =~ ^(web|worker|docs|kb)$ ]]; then
    echo "Error: Invalid app name. Must be one of: web, worker, docs, kb"
    exit 1
fi

# Helper function to get port
get_port() {
    case $1 in
        web) echo 3000 ;;
        worker) echo 8080 ;;
        docs) echo 3004 ;;
        kb) echo 3002 ;;
    esac
}

# Set variables
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKERFILE_PATH="$PROJECT_ROOT/apps/$APP_NAME/Dockerfile"
IMAGE_NAME="auxx-ai-$APP_NAME"
FULL_IMAGE_NAME="$IMAGE_NAME:$TAG"

# Check if Dockerfile exists
if [ ! -f "$DOCKERFILE_PATH" ]; then
    echo "Error: Dockerfile not found at $DOCKERFILE_PATH"
    exit 1
fi

echo "Building $APP_NAME for $ENVIRONMENT environment..."

# Load environment variables if available
if [ -f "$PROJECT_ROOT/.env.$ENVIRONMENT" ]; then
    export $(cat "$PROJECT_ROOT/.env.$ENVIRONMENT" | grep -v '^#' | xargs)
fi

# Build the image
docker build \
    --file "$DOCKERFILE_PATH" \
    --tag "$FULL_IMAGE_NAME" \
    --build-arg PROJECT="$APP_NAME" \
    --build-arg PROJECT_PATH="apps/$APP_NAME" \
    --build-arg BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    --build-arg VCS_REF="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')" \
    --platform linux/amd64 \
    "$PROJECT_ROOT"

echo "Successfully built $FULL_IMAGE_NAME"

# Run container if not build-only
if [ "$BUILD_ONLY" != "true" ]; then
    PORT=$(get_port $APP_NAME)
    echo "Starting container on port $PORT..."
    
    # Stop existing container if running
    docker stop "$APP_NAME-$ENVIRONMENT" 2>/dev/null || true
    docker rm "$APP_NAME-$ENVIRONMENT" 2>/dev/null || true
    
    # Start new container
    if [ -f "$PROJECT_ROOT/.env.$ENVIRONMENT" ]; then
        docker run -d \
            --name "$APP_NAME-$ENVIRONMENT" \
            --env-file "$PROJECT_ROOT/.env.$ENVIRONMENT" \
            -p "$PORT:$PORT" \
            "$FULL_IMAGE_NAME"
    else
        docker run -d \
            --name "$APP_NAME-$ENVIRONMENT" \
            -p "$PORT:$PORT" \
            "$FULL_IMAGE_NAME"
    fi
    
    echo "Container started: $APP_NAME-$ENVIRONMENT"
    echo "Access at: http://localhost:$PORT"
fi