ARG PROJECT="web"
ARG PROJECT_PATH="apps/web"

FROM node:22-alpine AS alpine

# Install build dependencies
RUN apk add --update --no-cache \
  libc6-compat 

FROM alpine AS base

# Will be used to cache pnpm store
RUN npm install -g corepack@0.31.0 && corepack enable

# Install pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install turbo with npm instead of pnpm to avoid key verification issues
RUN pnpm install -g turbo

FROM base AS pruner

ARG PROJECT

WORKDIR /app

COPY . .

# will generate in the ./out folder: 
# - A folder named json with the pruned workspace's package.json files.
# - A folder named full with the pruned workspace's package.json files.
# - A pnpm-lock.yaml file with the pruned workspace's lockfile.
RUN turbo prune web --docker

# BUILDER stage
# ------------------------------------------------------
FROM base AS builder

ARG PROJECT
ARG TURBO_TEAM
ARG TURBO_TOKEN
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_GIT_SHA
ARG NEXT_PUBLIC_APP_VERSION
ARG NEXT_PUBLIC_BUILD_TIME

# Build-time placeholders for NEXT_PUBLIC_* runtime env replacement (self-hosted)
ARG NEXT_PUBLIC_BASE_URL=__RUNTIME_NEXT_PUBLIC_BASE_URL__
ARG NEXT_PUBLIC_APP_URL=__RUNTIME_NEXT_PUBLIC_APP_URL__
ARG NEXT_PUBLIC_API_URL=__RUNTIME_NEXT_PUBLIC_API_URL__
ARG NEXT_PUBLIC_DEV_PORTAL_URL=__RUNTIME_NEXT_PUBLIC_DEV_PORTAL_URL__
ARG NEXT_PUBLIC_HOMEPAGE_URL=__RUNTIME_NEXT_PUBLIC_HOMEPAGE_URL__
ARG NEXT_PUBLIC_CDN_URL=__RUNTIME_NEXT_PUBLIC_CDN_URL__
ARG NEXT_PUBLIC_S3_PUBLIC_BUCKET=__RUNTIME_NEXT_PUBLIC_S3_PUBLIC_BUCKET__
ARG NEXT_PUBLIC_S3_PRIVATE_BUCKET=__RUNTIME_NEXT_PUBLIC_S3_PRIVATE_BUCKET__
ARG NEXT_PUBLIC_S3_REGION=__RUNTIME_NEXT_PUBLIC_S3_REGION__
ARG NEXT_PUBLIC_STORAGE_TYPE=__RUNTIME_NEXT_PUBLIC_STORAGE_TYPE__
ARG NEXT_PUBLIC_ENV=__RUNTIME_NEXT_PUBLIC_ENV__
ARG NEXT_PUBLIC_PUSHER_KEY=__RUNTIME_NEXT_PUBLIC_PUSHER_KEY__
ARG NEXT_PUBLIC_PUSHER_CLUSTER=__RUNTIME_NEXT_PUBLIC_PUSHER_CLUSTER__

ENV TURBO_TEAM=$TURBO_TEAM
ENV TURBO_TOKEN=$TURBO_TOKEN
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_GIT_SHA=$NEXT_PUBLIC_GIT_SHA
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
ENV NEXT_PUBLIC_BUILD_TIME=$NEXT_PUBLIC_BUILD_TIME
ENV DATABASE_URL="postgresql://postgres:password@localhost:5432/mock_db"
ENV BETTER_AUTH_URL="https://dev.auxx.ai"

# Add AI/API keys
ENV OPENAI_API_KEY="sk-mock-openai-api-key-for-build-time"
ENV ANTHROPIC_API_KEY="sk-ant-mock-anthropic-api-key-for-build-time"
ENV GOOGLE_API_KEY="mock-google-api-key-for-build-time"
ENV API_KEY_SALT="mock-api-key-salt-for-build"
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_mock_stripe_key_for_build"
ENV STRIPE_SECRET_KEY="sk_test_mock_stripe_secret_for_build"
ENV STRIPE_WEBHOOK_SECRET="whsec_mock_stripe_webhook_secret_for_build"

# Add Redis for caching (appears to be required)
ENV REDIS_HOST="localhost"
ENV REDIS_PORT="6379"
# ENV REDIS_PASSWORD="mock-redis-password"

# Add S3/storage related env vars
ENV S3_REGION="us-east-1"
ENV S3_BUCKET="mock-s3-bucket"
ENV FILE_STORAGE_TYPE="local"
ENV NEXT_PUBLIC_S3_BUCKET="mock-s3-bucket"
ENV NEXT_PUBLIC_S3_REGION="us-east-1"
ENV NEXT_PUBLIC_STORAGE_TYPE="local"

# Email configuration
ENV MAILGUN_API_KEY="mock-mailgun-api-key"
ENV MAILGUN_DOMAIN="mail.example.com"
ENV MAILGUN_REGION="us"
ENV SYSTEM_FROM_EMAIL="no-reply@example.com"
ENV SUPPORT_EMAIL="support@example.com"
ENV SUPPORT_NAME="Support Team"

# Add any other variables that might be required
ENV NEXT_PUBLIC_PUSHER_CLUSTER="us3"
ENV PUSHER_APP_ID="mock-pusher-app-id"
ENV PUSHER_KEY="mock-pusher-key"
ENV PUSHER_SECRET="mock-pusher-secret"
ENV PUSHER_CLUSTER="us3"
ENV NEXT_TELEMETRY_DISABLED="1"
ENV SKIP_CHAT_SESSION_VERIFICATION="true"

WORKDIR /app

COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/full/ .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  BUILDING_CONTAINER=true \
  pnpm install \
  --no-frozen-lockfile \
  --filter "${PROJECT}..."

# Increase Node memory limit and disable telemetry
ENV NODE_OPTIONS="--max-old-space-size=8192"
ENV TURBO_TELEMETRY_DISABLED=1


# Generate workflow nodes frontend files
RUN BUILDING_CONTAINER=true pnpm --filter="@auxx/workflow-nodes" run generate

# Build dependencies first 
RUN BUILDING_CONTAINER=true pnpm turbo build --filter="@auxx/config" --filter="@auxx/workflow-nodes"

# Then build the web app using webpack (not turbopack) for lower memory usage
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  BUILDING_CONTAINER=true \
  NEXT_TELEMETRY_DISABLED=1 \
  SKIP_ENV_VALIDATION=1 \
  NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
  NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
  NODE_OPTIONS="--max-old-space-size=8192" \
  pnpm --filter=web run build:prod

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  BUILDING_CONTAINER=true \
  pnpm prune --prod --no-optional

# PRODUCTION
# no 
FROM alpine AS runner

ARG PROJECT_PATH

ENV HOSTNAME=0.0.0.0
ENV KEEP_ALIVE_TIMEOUT=601000
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app


# Install AWS CLI using Alpine package manager and pnpm
RUN apk add --no-cache \
  aws-cli \
  groff \
  less \ 
  curl \
  libc6-compat \
  nodejs \
  npm

# Install pnpm globally
RUN npm install -g pnpm


RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# COPY --from=builder /app/packages/core/src/assets /app/packages/core/src/assets
COPY --from=builder /app/apps/web/public ./apps/web/public

# Set the correct permission for prerender cache
RUN mkdir -p apps/web/.next
RUN mkdir -p apps/web/.next/cache
RUN chown nextjs:nodejs apps/web/.next
RUN chown nextjs:nodejs apps/web/.next/cache

# Copy the standalone server and node_modules
COPY --from=builder --chown=nodejs:nextjs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nodejs:nextjs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nodejs:nextjs /app/apps/web/node_modules ./apps/web/node_modules

# Copy packages/database for drizzle-kit migrations (used by migrate service)
COPY --from=builder --chown=nodejs:nextjs /app/packages/database ./packages/database
COPY --from=builder --chown=nodejs:nextjs /app/node_modules ./node_modules

# Copy the docker entrypoint for runtime env replacement
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Set permissions for local storage
# User ID and Group ID 1001 is used to match the user 'nextjs' and group 'nodejs' in the runner image.
RUN set -e; \
  mkdir -p /app/storage/files; \
  mkdir -p /app/apps/web/public/files; \
  chown -R 1001:1001 /app/storage/files /app/apps/web/public/files

USER nextjs

WORKDIR /app/apps/web

EXPOSE 3000

ENTRYPOINT ["../../docker-entrypoint.sh"]
CMD ["node", "server.js"]
