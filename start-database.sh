#!/usr/bin/env bash
# Use this script to start a docker container for a local development database

# TO RUN ON WINDOWS:
# 1. Install WSL (Windows Subsystem for Linux) - https://learn.microsoft.com/en-us/windows/wsl/install
# 2. Install Docker Desktop for Windows - https://docs.docker.com/docker-for-windows/install/
# 3. Open WSL - `wsl`
# 4. Run this script - `./start-database.sh`

# On Linux and macOS you can run this script directly - `./start-database.sh`

DB_CONTAINER_NAME="auxx-ai-postgres"

if ! [ -x "$(command -v docker)" ]; then
  echo -e "Docker is not installed. Please install docker and try again.\nDocker install guide: https://docs.docker.com/engine/install/"
  exit 1
fi

if ! docker info > /dev/null 2>&1; then
  echo "Docker daemon is not running. Please start Docker and try again."
  exit 1
fi

if [ "$(docker ps -q -f name=$DB_CONTAINER_NAME)" ]; then
  echo "Database container '$DB_CONTAINER_NAME' already running"
else
  if [ "$(docker ps -q -a -f name=$DB_CONTAINER_NAME)" ]; then
    docker start "$DB_CONTAINER_NAME"
    echo "Existing database container '$DB_CONTAINER_NAME' started"
  else
    # import env variables from .env
    set -a
    source .env

    DB_PASSWORD=$(echo "$DATABASE_URL" | awk -F':' '{print $3}' | awk -F'@' '{print $1}')
    DB_PORT=$(echo "$DATABASE_URL" | awk -F':' '{print $4}' | awk -F'\/' '{print $1}')

    if [ "$DB_PASSWORD" = "password" ]; then
      echo "You are using the default database password"
      read -p "Should we generate a random password for you? [y/N]: " -r REPLY
      if ! [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Please change the default password in the .env file and try again"
        exit 1
      fi
      # Generate a random URL-safe password
      DB_PASSWORD=$(openssl rand -base64 12 | tr '+/' '-_')
      sed -i -e "s#:password@#:$DB_PASSWORD@#" .env
    fi

    docker run -d \
      --name $DB_CONTAINER_NAME \
      -e POSTGRES_USER="postgres" \
      -e POSTGRES_PASSWORD="$DB_PASSWORD" \
      -e POSTGRES_DB=auxx-ai \
      -p "$DB_PORT":5432 \
      ankane/pgvector:latest && echo "Database container '$DB_CONTAINER_NAME' with pgvector was successfully created"

    # docker run -d \
    #   --name $DB_CONTAINER_NAME \
    #   -e POSTGRES_USER="postgres" \
    #   -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    #   -e POSTGRES_DB=auxx-ai \
    #   -p "$DB_PORT":5432 \
    #   docker.io/postgres && echo "Database container '$DB_CONTAINER_NAME' was successfully created"
  fi
fi

# # Wait for PostgreSQL to be ready
# echo "Waiting for PostgreSQL to start..."
# sleep 5

# # Check if pgvector is already installed
# EXTENSION_EXISTS=$(docker exec "$DB_CONTAINER_NAME" psql -U postgres -d auxx-ai -tAc "SELECT 1 FROM pg_extension WHERE extname='vector';")

# if [ "$EXTENSION_EXISTS" != "1" ]; then
#   echo "pgvector extension not found. Installing..."

#   # Update and install necessary packages inside the running container
#   docker exec "$DB_CONTAINER_NAME" bash -c "apt update && apt install -y postgresql-17-pgvecto.rs"

#   # Now try creating the extension again
#   docker exec "$DB_CONTAINER_NAME" psql -U postgres -d auxx-ai -c "CREATE EXTENSION vector;" && echo "pgvector extension installed."
# else
#   echo "pgvector extension already exists. No action needed."
# fi
