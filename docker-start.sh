#!/usr/bin/env bash
# docker-start.sh - Helper script to start Docker Compose with proper environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if docker is installed
if ! [ -x "$(command -v docker)" ]; then
  echo -e "${RED}Error: Docker is not installed.${NC}"
  echo "Please install Docker and try again: https://docs.docker.com/engine/install/"
  exit 1
fi

# Check if docker daemon is running
if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}Error: Docker daemon is not running.${NC}"
  echo "Please start Docker and try again."
  exit 1
fi

# Load environment variables
if [ ! -f .env ]; then
  echo -e "${RED}Error: .env file not found.${NC}"
  echo "Please create a .env file based on .env.example"
  exit 1
fi

# Source the .env file
set -a
source .env
set +a

# Extract database password and port from DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}Error: DATABASE_URL not set in .env file.${NC}"
  exit 1
fi

# Parse DATABASE_URL
DATABASE_PASSWORD=$(echo "$DATABASE_URL" | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
DATABASE_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')

# Export for docker-compose
export DATABASE_PASSWORD
export DATABASE_PORT

# Determine which compose file to use
COMPOSE_FILE="docker-compose.dev.yml"
ENVIRONMENT="development"

# Check for production flag
if [ "$1" == "prod" ] || [ "$1" == "production" ]; then
  COMPOSE_FILE="docker-compose.prod.yml"
  ENVIRONMENT="production"
fi

echo -e "${GREEN}Starting Auxx.ai in ${ENVIRONMENT} mode...${NC}"
echo "Using compose file: $COMPOSE_FILE"

# Check if we should rebuild
if [ "$2" == "build" ] || [ "$2" == "--build" ]; then
  echo -e "${YELLOW}Building images...${NC}"
  docker-compose -f $COMPOSE_FILE build
fi

# Start services
echo -e "${YELLOW}Starting services...${NC}"
docker-compose -f $COMPOSE_FILE up -d

# Wait for services to be healthy
echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
sleep 5

# Run database migrations if in development
if [ "$ENVIRONMENT" == "development" ]; then
  echo -e "${YELLOW}Running database migrations...${NC}"
  docker-compose -f $COMPOSE_FILE exec -T web || true
fi

# Show status
echo -e "${GREEN}Services started successfully!${NC}"
docker-compose -f $COMPOSE_FILE ps

echo ""
echo "Access the applications at:"
echo "  - Web App: http://localhost:3000"
echo "  - Knowledge Base: http://localhost:3002"
echo "  - Worker: http://localhost:8080"
echo "  - WebSocket: http://localhost:4000"
echo ""
echo "To view logs: docker-compose -f $COMPOSE_FILE logs -f"
echo "To stop: docker-compose -f $COMPOSE_FILE down"