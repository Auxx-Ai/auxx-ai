#!/usr/bin/env bash
# docker-stop.sh - Helper script to stop Docker Compose services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Determine which compose file to use
COMPOSE_FILE="docker-compose.yml"

# Check for production flag
if [ "$1" == "prod" ] || [ "$1" == "production" ]; then
  COMPOSE_FILE="docker-compose.prod.yml"
fi

echo -e "${YELLOW}Stopping Auxx.ai services...${NC}"
echo "Using compose file: $COMPOSE_FILE"

# Stop services
docker-compose -f $COMPOSE_FILE down

# Check if volumes should be removed
if [ "$2" == "--volumes" ] || [ "$2" == "-v" ]; then
  echo -e "${RED}WARNING: This will delete all data in volumes!${NC}"
  read -p "Are you sure? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    docker-compose -f $COMPOSE_FILE down -v
    echo -e "${GREEN}Services stopped and volumes removed.${NC}"
  else
    echo -e "${YELLOW}Volume removal cancelled.${NC}"
  fi
else
  echo -e "${GREEN}Services stopped successfully.${NC}"
  echo "To remove volumes as well, use: $0 $1 --volumes"
fi