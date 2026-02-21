ARG PROJECT="web"
ARG PROJECT_PATH="apps/web"

FROM node:22.22-bookworm-slim AS slim

FROM slim AS base

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
RUN turbo prune @auxx/web --docker

# BUILDER stage
# ------------------------------------------------------
FROM base AS builder

ARG PROJECT
ARG TURBO_TEAM
ARG TURBO_TOKEN
ARG GIT_SHA
ARG APP_VERSION
ARG BUILD_TIME

# Build-time placeholders for NEXT_PUBLIC_* runtime env replacement (self-hosted)
# Group A: URL vars — replaced at container start by docker-entrypoint.sh
ARG NEXT_PUBLIC_BASE_URL=https://__RUNTIME_NEXT_PUBLIC_BASE_URL__
ARG NEXT_PUBLIC_APP_URL=https://__RUNTIME_NEXT_PUBLIC_APP_URL__
ARG NEXT_PUBLIC_API_URL=https://__RUNTIME_NEXT_PUBLIC_API_URL__
ARG NEXT_PUBLIC_DEV_PORTAL_URL=https://__RUNTIME_NEXT_PUBLIC_DEV_PORTAL_URL__
ARG NEXT_PUBLIC_HOMEPAGE_URL=https://__RUNTIME_NEXT_PUBLIC_HOMEPAGE_URL__
ARG NEXT_PUBLIC_DOCS_URL=https://__RUNTIME_NEXT_PUBLIC_DOCS_URL__

ENV TURBO_TEAM=$TURBO_TEAM
ENV TURBO_TOKEN=$TURBO_TOKEN
ENV GIT_SHA=$GIT_SHA
ENV APP_VERSION=$APP_VERSION
ENV BUILD_TIME=$BUILD_TIME
# Build-time mocks for modules that read env at import time
ENV DATABASE_URL="postgresql://postgres:password@localhost:5432/mock_db"
ENV BETTER_AUTH_URL="https://dev.auxx.ai"
ENV REDIS_HOST="localhost"
ENV REDIS_PORT="6379"
ENV NEXT_TELEMETRY_DISABLED="1"

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

# Build the web app (uses Turbopack, Next.js 16.1 default)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  BUILDING_CONTAINER=true \
  NEXT_TELEMETRY_DISABLED=1 \
  SKIP_ENV_VALIDATION=1 \
  NODE_OPTIONS="--max-old-space-size=8192" \
  pnpm --filter=web run build:prod

# PRODUCTION
# Standalone output bundles its own node_modules — no need to prune.
# Keeping devDeps ensures drizzle-kit stays available for the migrate service.
FROM slim AS runner

ARG PROJECT_PATH

ENV HOSTNAME=0.0.0.0
ENV KEEP_ALIVE_TIMEOUT=601000
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app


# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# COPY --from=builder /app/packages/core/src/assets /app/packages/core/src/assets
COPY --from=builder /app/apps/web/public ./apps/web/public

# Set the correct permission for prerender cache
RUN mkdir -p apps/web/.next
RUN mkdir -p apps/web/.next/cache
RUN chown nextjs:nodejs apps/web/.next
RUN chown nextjs:nodejs apps/web/.next/cache

# Copy the standalone server and static assets
COPY --from=builder --chown=nodejs:nextjs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nodejs:nextjs /app/apps/web/.next/static ./apps/web/.next/static

# Copy packages/database for drizzle-kit migrations (used by migrate service)
# The database package includes its own node_modules — no need for the full monorepo node_modules (~1.4GB)
COPY --from=builder --chown=nodejs:nextjs /app/packages/database ./packages/database

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
