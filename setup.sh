#!/usr/bin/env bash
set -euo pipefail

# ─── Colors ────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ─── Check prerequisites ──────────────────────────────────
if ! command -v openssl &>/dev/null; then
  echo -e "${RED}Error: openssl is required but not installed.${NC}"
  exit 1
fi

# ─── Mode detection ───────────────────────────────────────
SELF_HOSTED=false
FILL_MODE=false

for arg in "$@"; do
  case "$arg" in
    --self-hosted) SELF_HOSTED=true ;;
    --fill) FILL_MODE=true ;;
  esac
done

# ─── Guard against overwriting ─────────────────────────────
if [ -f .env ]; then
  echo -e "${YELLOW}.env already exists.${NC}"
  echo "To regenerate, remove it first: rm .env"
  echo "To add missing vars only, run: ./setup.sh --fill"

  if [ "$FILL_MODE" = true ]; then
    echo ""
    echo "Filling missing secrets in existing .env..."
  else
    exit 1
  fi
fi

# ─── Generate secrets ─────────────────────────────────────
generate_secret() {
  openssl rand -hex "$1"
}

DATABASE_PASSWORD=$(generate_secret 16)
REDIS_PASSWORD=$(generate_secret 16)
BETTER_AUTH_SECRET=$(generate_secret 32)
API_KEY_SALT=$(generate_secret 16)
LAMBDA_INVOKE_SECRET=$(generate_secret 32)

# ─── Fill mode: only set vars that are empty/missing ───────
if [ "$FILL_MODE" = true ]; then
  fill_if_empty() {
    local key="$1"
    local value="$2"
    # Check if key exists and has a value
    if grep -q "^${key}=" .env; then
      current=$(grep "^${key}=" .env | cut -d'=' -f2-)
      if [ -z "$current" ]; then
        # Key exists but empty — fill it
        if [[ "$OSTYPE" == "darwin"* ]]; then
          sed -i '' "s|^${key}=.*|${key}=${value}|" .env
        else
          sed -i "s|^${key}=.*|${key}=${value}|" .env
        fi
        echo -e "  ${GREEN}✓${NC} Generated ${key}"
      fi
    else
      # Key doesn't exist — append it
      echo "${key}=${value}" >> .env
      echo -e "  ${GREEN}✓${NC} Added ${key}"
    fi
  }

  fill_if_empty "DATABASE_PASSWORD" "$DATABASE_PASSWORD"
  fill_if_empty "REDIS_PASSWORD" "$REDIS_PASSWORD"
  fill_if_empty "BETTER_AUTH_SECRET" "$BETTER_AUTH_SECRET"
  fill_if_empty "API_KEY_SALT" "$API_KEY_SALT"
  fill_if_empty "LAMBDA_INVOKE_SECRET" "$LAMBDA_INVOKE_SECRET"

  # Rebuild DATABASE_URL if it contains a stale password
  DB_PASS=$(grep "^DATABASE_PASSWORD=" .env | cut -d'=' -f2- | tr -d '"')
  if [ -n "$DB_PASS" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:${DB_PASS}@localhost:5432/auxx-ai|" .env
    else
      sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:${DB_PASS}@localhost:5432/auxx-ai|" .env
    fi
    echo -e "  ${GREEN}✓${NC} Rebuilt DATABASE_URL with current DATABASE_PASSWORD"

    # Sync DATABASE_URL to all app .env files
    for dir in "apps/web" "apps/build" "apps/api" "apps/worker" "apps/kb" "packages/database"; do
      if [ -f "${dir}/.env" ]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
          sed -i '' "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:${DB_PASS}@localhost:5432/auxx-ai|" "${dir}/.env"
        else
          sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:${DB_PASS}@localhost:5432/auxx-ai|" "${dir}/.env"
        fi
        echo -e "  ${GREEN}✓${NC} Synced DATABASE_URL in ${dir}/.env"
      fi
    done
  fi

  # ─── Sync LAMBDA_INVOKE_SECRET to apps/lambda/.env ────────
  LAMBDA_SECRET=$(grep "^LAMBDA_INVOKE_SECRET=" .env | cut -d'=' -f2-)
  if [ -n "$LAMBDA_SECRET" ]; then
    if [ -f apps/lambda/.env ]; then
      if grep -q "^LAMBDA_INVOKE_SECRET=" apps/lambda/.env; then
        current=$(grep "^LAMBDA_INVOKE_SECRET=" apps/lambda/.env | cut -d'=' -f2-)
        if [ -z "$current" ]; then
          do_sed_file() {
            if [[ "$OSTYPE" == "darwin"* ]]; then
              sed -i '' "$@"
            else
              sed -i "$@"
            fi
          }
          do_sed_file "s|^LAMBDA_INVOKE_SECRET=.*|LAMBDA_INVOKE_SECRET=${LAMBDA_SECRET}|" apps/lambda/.env
          echo -e "  ${GREEN}✓${NC} Filled LAMBDA_INVOKE_SECRET in apps/lambda/.env"
        fi
      else
        echo "LAMBDA_INVOKE_SECRET=${LAMBDA_SECRET}" >> apps/lambda/.env
        echo -e "  ${GREEN}✓${NC} Added LAMBDA_INVOKE_SECRET to apps/lambda/.env"
      fi
    elif [ -f apps/lambda/.env.example ]; then
      cp apps/lambda/.env.example apps/lambda/.env
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^LAMBDA_INVOKE_SECRET=.*|LAMBDA_INVOKE_SECRET=${LAMBDA_SECRET}|" apps/lambda/.env
      else
        sed -i "s|^LAMBDA_INVOKE_SECRET=.*|LAMBDA_INVOKE_SECRET=${LAMBDA_SECRET}|" apps/lambda/.env
      fi
      echo -e "  ${GREEN}✓${NC} Created apps/lambda/.env with LAMBDA_INVOKE_SECRET"
    fi
  fi

  echo ""
  echo -e "${GREEN}Done.${NC} Missing secrets have been filled."
  exit 0
fi

# ─── Fresh setup: copy template and fill everything ────────
if [ "$SELF_HOSTED" = true ]; then
  cp .env.self-hosted.example .env
  echo -e "${GREEN}Using self-hosted template${NC}"
else
  cp .env.example .env
fi

# Platform-compatible sed (macOS vs Linux)
do_sed() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

# ─── Replace secret placeholders ──────────────────────────
do_sed "s|^DATABASE_PASSWORD=.*|DATABASE_PASSWORD=${DATABASE_PASSWORD}|" .env
do_sed "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASSWORD}|" .env
do_sed "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}|" .env
do_sed "s|^API_KEY_SALT=.*|API_KEY_SALT=${API_KEY_SALT}|" .env
do_sed "s|^LAMBDA_INVOKE_SECRET=.*|LAMBDA_INVOKE_SECRET=${LAMBDA_INVOKE_SECRET}|" .env

# ─── Build DATABASE_URL from generated password ───────────
do_sed "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:${DATABASE_PASSWORD}@localhost:5432/auxx-ai|" .env

# ─── Set sensible defaults ────────────────────────────────
do_sed "s|^NEXT_PUBLIC_BASE_URL=.*|NEXT_PUBLIC_BASE_URL=http://localhost:3000|" .env
do_sed "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=http://localhost:3000|" .env

# ─── Setup apps/lambda/.env ───────────────────────────────
if [ -f apps/lambda/.env.example ]; then
  cp apps/lambda/.env.example apps/lambda/.env
  do_sed "s|^LAMBDA_INVOKE_SECRET=.*|LAMBDA_INVOKE_SECRET=${LAMBDA_INVOKE_SECRET}|" apps/lambda/.env
  echo -e "${GREEN}✓ apps/lambda/.env created${NC}"
fi

# ─── Sync DATABASE_URL to all app .env files ─────────────
DB_URL="postgresql://postgres:${DATABASE_PASSWORD}@localhost:5432/auxx-ai"
APP_DIRS=("apps/web" "apps/build" "apps/api" "apps/worker" "apps/kb" "packages/database")

for dir in "${APP_DIRS[@]}"; do
  if [ -f "${dir}/.env" ]; then
    do_sed "s|^DATABASE_URL=.*|DATABASE_URL=\"${DB_URL}\"|" "${dir}/.env"
    echo -e "  ${GREEN}✓${NC} Updated DATABASE_URL in ${dir}/.env"
  elif [ -f "${dir}/.env.example" ]; then
    cp "${dir}/.env.example" "${dir}/.env"
    do_sed "s|^DATABASE_URL=.*|DATABASE_URL=\"${DB_URL}\"|" "${dir}/.env"
    echo -e "  ${GREEN}✓${NC} Created ${dir}/.env with DATABASE_URL"
  else
    echo "DATABASE_URL=\"${DB_URL}\"" > "${dir}/.env"
    echo -e "  ${GREEN}✓${NC} Created ${dir}/.env with DATABASE_URL"
  fi
done

# ─── Output ───────────────────────────────────────────────
echo ""
echo -e "${GREEN}✓ .env created with generated secrets${NC}"
echo ""
echo "  Generated:"
echo "    DATABASE_PASSWORD   (used by Postgres & DATABASE_URL)"
echo "    REDIS_PASSWORD      (used by Redis)"
echo "    BETTER_AUTH_SECRET  (used by BetterAuth)"
echo "    API_KEY_SALT        (used for API key generation)"
echo "    LAMBDA_INVOKE_SECRET (used for Lambda executor auth)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
if [ "$SELF_HOSTED" = true ]; then
  echo "  1. Edit .env and set:"
  echo "     - DOMAIN               (your domain, e.g. example.com)"
  echo "     - ACME_EMAIL           (for Let's Encrypt SSL)"
  echo "     - S3 credentials       (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, etc.)"
  echo "     - ANTHROPIC_API_KEY    (or OPENAI_API_KEY)"
  echo "  2. Create S3 buckets (see docs for setup guide)"
  echo "  3. Point DNS: app.DOMAIN, api.DOMAIN, build.DOMAIN → server IP"
  echo "  4. Launch:"
  echo "     docker compose -f docker-compose.self-hosted.yml up -d"
else
  echo "  1. Review .env and configure any API keys you need:"
  echo "     - OPENAI_API_KEY        (required for AI features)"
  echo "     - ANTHROPIC_API_KEY     (optional, alternative AI model)"
  echo "     - SHOPIFY_API_KEY/SECRET (required for Shopify integration)"
  echo "     - GOOGLE_CLIENT_ID/SECRET (required for Gmail integration)"
  echo "  2. Start services:"
  echo "     docker compose up -d"
  echo "     pnpm install && pnpm dev"
fi
echo ""
