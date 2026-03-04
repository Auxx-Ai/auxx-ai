#!/bin/bash
# docker/scripts/install.sh
# One-click Auxx.ai installer.
#
# Usage:
#   bash <(curl -sL https://raw.githubusercontent.com/Auxx-Ai/auxx-ai/main/docker/scripts/install.sh)

# ─── Check dependencies ──────────────────────────────────

echo "Checking dependencies..."

if ! command -v docker &>/dev/null; then
  echo -e "\t❌ Docker is not installed or not in PATH.\n\t\tSee https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo -e "\t❌ Docker Compose v2 is not installed (n.b. docker-compose is deprecated)\n\t\tUpdate Docker or install docker-compose-plugin\n\t\tOn Linux: sudo apt-get install docker-compose-plugin\n\t\tSee https://docs.docker.com/compose/install/"
  exit 1
fi

if ! docker info &>/dev/null; then
  echo -e "\t❌ Docker is not running.\n\t\tStart Docker Desktop or check https://docs.docker.com/config/daemon/start/"
  exit 1
fi

if ! command -v curl &>/dev/null; then
  echo -e "\t❌ curl is not installed.\n\t\tOn macOS: brew install curl\n\t\tOn Linux: sudo apt install curl"
  exit 1
fi

if ! command -v openssl &>/dev/null; then
  echo -e "\t❌ openssl is not installed.\n\t\tOn macOS: brew install openssl\n\t\tOn Linux: sudo apt install openssl"
  exit 1
fi

# Check Docker Compose version >= 2
if [ "$(docker compose version --short | cut -d'.' -f1)" -lt 2 ]; then
  echo -e "\t❌ Docker Compose is outdated. Please update to version 2+.\n\t\tSee https://docs.docker.com/compose/install/linux/"
  exit 1
fi

# Warn about legacy docker-compose
if command -v docker-compose &>/dev/null; then
  if [ "$(docker-compose version --short | cut -d'.' -f1)" -lt 2 ]; then
    echo -e "\n\t⚠️  'docker-compose' (legacy) is installed but outdated. Use 'docker compose' (plugin).\n\t\tSee https://docs.docker.com/compose/install/standalone/\n"
  fi
fi

# ─── Error handling ───────────────────────────────────────

set -e
function on_exit {
  local exit_status=$?
  if [ $exit_status -ne 0 ]; then
    echo "❌ Something went wrong, exiting: $exit_status"
  fi
}
trap on_exit EXIT

# ─── Version resolution ──────────────────────────────────

# Use VERSION env var, or fetch latest from GitHub Releases API
# Pin a specific version: VERSION=0.1.28 bash <(curl -sL ...)
version=${VERSION:-$(curl -s "https://api.github.com/repos/Auxx-Ai/auxx-ai/releases/latest" \
  | grep -o '"tag_name":"[^"]*"' | cut -d'"' -f4 | sed 's/^auxx-v//' || echo "latest")}

if [ -z "$version" ]; then
  version="latest"
fi

branch=${BRANCH:-main}

echo "🚀 Using image version: $version (branch: $branch)"

# ─── Directory setup ─────────────────────────────────────

dir_name="auxx"
function ask_directory {
  read -p "📁 Enter the directory name to setup the project (default: $dir_name): " answer
  if [ -n "$answer" ]; then
    dir_name=$answer
  fi
}

ask_directory

while [ -d "$dir_name" ]; do
  read -p "🚫 Directory '$dir_name' already exists. Do you want to overwrite it? (y/N) " answer
  if [ "$answer" = "y" ]; then
    echo "🗑️  Removing existing directory '$dir_name'"
    rm -rf "$dir_name"
    break
  else
    ask_directory
  fi
done

echo "📁 Creating directory '$dir_name'"
mkdir -p "$dir_name" && cd "$dir_name" || { echo "❌ Failed to create/access directory '$dir_name'"; exit 1; }

# ─── Download config files ───────────────────────────────

echo -e "\t• Downloading docker-compose.yml"
curl -sLo docker-compose.yml "https://raw.githubusercontent.com/Auxx-Ai/auxx-ai/$branch/docker/docker-compose.yml"

echo -e "\t• Downloading .env.example"
curl -sLo .env "https://raw.githubusercontent.com/Auxx-Ai/auxx-ai/$branch/.env.example"

# ─── Platform-aware sed ──────────────────────────────────

do_sed() {
  if [[ $(uname) == "Darwin" ]]; then
    sed -i '' "$@"
  else
    sed -i'' "$@"
  fi
}

# ─── Set version tag ─────────────────────────────────────

do_sed "s|^VERSION=.*|VERSION=$version|" .env

# ─── Set deployment mode ─────────────────────────────────

do_sed "s|^DEPLOYMENT_MODE=.*|DEPLOYMENT_MODE=self-hosted|" .env

# ─── Generate secrets ────────────────────────────────────

echo -e "\t• Generating secrets"

generate_secret() {
  openssl rand -hex "$1"
}

DATABASE_PASSWORD=$(generate_secret 16)
REDIS_PASSWORD=$(generate_secret 16)
BETTER_AUTH_SECRET=$(generate_secret 32)
API_KEY_SALT=$(generate_secret 16)
LAMBDA_INVOKE_SECRET=$(generate_secret 32)
WORKFLOW_CREDENTIAL_ENCRYPTION_KEY=$(generate_secret 16)
PUBLIC_WORKFLOW_JWT_SECRET=$(generate_secret 32)
SDK_CLIENT_SECRET=$(generate_secret 32)

# Generate Ed25519 keypair for cross-app login token signing
LOGIN_TOKEN_KEYS=$(node -e "
  const { generateKeyPairSync } = require('crypto');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim().replace(/\n/g, '\\\\n');
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString().trim().replace(/\n/g, '\\\\n');
  console.log(priv + '|||' + pub);
" 2>/dev/null || true)
LOGIN_TOKEN_PRIVATE_KEY="${LOGIN_TOKEN_KEYS%%|||*}"
LOGIN_TOKEN_PUBLIC_KEY="${LOGIN_TOKEN_KEYS##*|||}"
BUILD_SESSION_SECRET=$(generate_secret 32)

do_sed "s|^DATABASE_PASSWORD=.*|DATABASE_PASSWORD=$DATABASE_PASSWORD|" .env
do_sed "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$REDIS_PASSWORD|" .env
do_sed "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET|" .env
do_sed "s|^API_KEY_SALT=.*|API_KEY_SALT=$API_KEY_SALT|" .env
do_sed "s|^LAMBDA_INVOKE_SECRET=.*|LAMBDA_INVOKE_SECRET=$LAMBDA_INVOKE_SECRET|" .env
do_sed "s|^WORKFLOW_CREDENTIAL_ENCRYPTION_KEY=.*|WORKFLOW_CREDENTIAL_ENCRYPTION_KEY=$WORKFLOW_CREDENTIAL_ENCRYPTION_KEY|" .env
do_sed "s|^PUBLIC_WORKFLOW_JWT_SECRET=.*|PUBLIC_WORKFLOW_JWT_SECRET=$PUBLIC_WORKFLOW_JWT_SECRET|" .env
do_sed "s|^SDK_CLIENT_SECRET=.*|SDK_CLIENT_SECRET=$SDK_CLIENT_SECRET|" .env
# Keys contain literal \n which sed would interpret as newlines — double-escape for sed
ESCAPED_PRIVATE_KEY=$(printf '%s' "$LOGIN_TOKEN_PRIVATE_KEY" | sed 's/\\/\\\\/g')
ESCAPED_PUBLIC_KEY=$(printf '%s' "$LOGIN_TOKEN_PUBLIC_KEY" | sed 's/\\/\\\\/g')
do_sed "s|^LOGIN_TOKEN_PRIVATE_KEY=.*|LOGIN_TOKEN_PRIVATE_KEY=$ESCAPED_PRIVATE_KEY|" .env
do_sed "s|^LOGIN_TOKEN_PUBLIC_KEY=.*|LOGIN_TOKEN_PUBLIC_KEY=$ESCAPED_PUBLIC_KEY|" .env
do_sed "s|^BUILD_SESSION_SECRET=.*|BUILD_SESSION_SECRET=$BUILD_SESSION_SECRET|" .env

# ─── Set DATABASE_URL for Docker networking ───────────────

do_sed "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:${DATABASE_PASSWORD}@postgres:5432/auxx-ai|" .env

# ─── Set Redis host for Docker networking ─────────────────

do_sed "s|^REDIS_HOST=.*|REDIS_HOST=redis|" .env

# ─── Set S3 to use MinIO ─────────────────────────────────

do_sed "s|^S3_ENDPOINT=.*|S3_ENDPOINT=http://minio:9000|" .env
do_sed "s|^S3_ACCESS_KEY_ID=.*|S3_ACCESS_KEY_ID=minioadmin|" .env
do_sed "s|^S3_SECRET_ACCESS_KEY=.*|S3_SECRET_ACCESS_KEY=minioadmin|" .env
do_sed "s|^CDN_URL=.*|CDN_URL=http://localhost:9000/auxx-public-local|" .env

echo -e "\t• .env configuration completed"

# ─── Port conflict detection ─────────────────────────────
# Only updates .env — docker-compose.yml uses ${VAR:-default} interpolation from .env,
# so no compose file modifications are needed.

# Track the web port globally for browser opening later
web_port=3000

# check_port <label> <default_port> <env_var>
# Checks if a port is in use, prompts for alternative, updates .env
check_port() {
  local label=$1
  local port=$2
  local env_var=$3

  if ! command -v nc &>/dev/null; then
    return
  fi

  while nc -zv localhost "$port" &>/dev/null 2>&1; do
    read -p "🚫 Port $port ($label) is already in use. Do you want to use another port? (Y/n) " answer
    if [ "$answer" = "n" ]; then
      break
    fi
    read -p "Enter a new port number for $label: " new_port

    # Update or add port env var in .env
    if grep -q "^${env_var}=" .env; then
      do_sed "s|^${env_var}=.*|${env_var}=${new_port}|" .env
    else
      echo "${env_var}=${new_port}" >> .env
    fi

    port=$new_port
    echo "✅ $label port changed to $new_port"
  done

  # Track web port for browser opening
  if [ "$env_var" = "APP_PORT" ]; then
    web_port=$port
  fi
}

check_port "PostgreSQL" 5432 "DATABASE_PORT"
check_port "Redis"      6379 "REDIS_PORT"
check_port "MinIO API"  9000 "MINIO_PORT"
check_port "MinIO UI"   9001 "MINIO_CONSOLE_PORT"
check_port "Web"        3000 "APP_PORT"
check_port "API"        3007 "API_PORT"
check_port "Worker"     3005 "WORKER_PORT"
check_port "Lambda"     3008 "LAMBDA_PORT"

# ─── Start services ──────────────────────────────────────

read -p "🚀 Do you want to start the project now? (Y/n) " answer
if [ "$answer" = "n" ]; then
  echo "✅ Project setup completed in './$dir_name'."
  echo "   Run 'docker compose up -d' to start."
  exit 0
else
  echo "🐳 Starting Docker containers..."
  docker compose up -d

  echo "Waiting for server to be healthy (this may take a few minutes while the database initializes)..."

  # Tail logs in background
  docker compose logs -f web &
  pid=$!

  # Poll web container health
  while true; do
    status=$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose ps -q web)" 2>/dev/null || echo "starting")
    if [ "$status" = "healthy" ]; then
      break
    elif [ "$status" = "unhealthy" ]; then
      kill $pid 2>/dev/null || true
      echo ""
      echo "❌ Web service is unhealthy. Check logs: docker compose logs web"
      exit 1
    fi
    sleep 3
  done

  kill $pid 2>/dev/null || true
  wait $pid 2>/dev/null || true
  echo ""
  echo "✅ Server is up and running"
fi

# ─── Open browser ────────────────────────────────────────

function ask_open_browser {
  read -p "🌐 Do you want to open the project in your browser? (Y/n) " answer
  if [ "$answer" = "n" ]; then
    echo "✅ Setup completed. Access your project at http://localhost:$web_port"
    exit 0
  fi
}

if [[ $(uname) == "Darwin" ]]; then
  ask_open_browser
  open "http://localhost:$web_port"
else
  if command -v xdg-open >/dev/null 2>&1; then
    ask_open_browser
    xdg-open "http://localhost:$web_port"
  else
    echo "✅ Setup completed. Your project is available at http://localhost:$web_port"
  fi
fi
