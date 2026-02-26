# apps/web/Dockerfile
ARG NODE_VERSION=22.22

# ──────────────────────────────────────────────
# Stage 1: PRUNER — extract only web-relevant packages
# ──────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS pruner

RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN pnpm add -g turbo@2.5.2

WORKDIR /app
COPY . .
RUN turbo prune @auxx/web --docker

# ──────────────────────────────────────────────
# Stage 2: INSTALLER — install dependencies (cached layer)
# ──────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS installer

# Build tools for native addons (pg, sharp, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ gcc ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN pnpm add -g turbo@2.5.2

WORKDIR /app

# Copy lockfile, workspace config, and package.json files (from turbo prune --docker output).
# This layer is cached as long as no dependency versions change.
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/json/ .

# --ignore-scripts: source files aren't available yet (only json/ is copied),
# so lifecycle scripts like postinstall would fail.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ──────────────────────────────────────────────
# Stage 3: BUILDER — build packages + Next.js app
# ──────────────────────────────────────────────
FROM installer AS builder

ARG TURBO_TEAM
ARG TURBO_TOKEN
ARG GIT_SHA
ARG APP_VERSION
ARG BUILD_TIME
ARG DOMAIN=__RUNTIME_DOMAIN__

ENV TURBO_TEAM=$TURBO_TEAM
ENV TURBO_TOKEN=$TURBO_TOKEN
ENV GIT_SHA=$GIT_SHA
ENV APP_VERSION=$APP_VERSION
ENV BUILD_TIME=$BUILD_TIME
ENV DOMAIN=$DOMAIN
ENV NODE_OPTIONS="--max-old-space-size=8192"
ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
# Build-time mocks for modules that read env at import time
ENV DATABASE_URL="postgresql://postgres:password@localhost:5432/mock_db"
ENV REDIS_HOST="localhost"
ENV REDIS_PORT="6379"

# Copy full source of relevant packages
COPY --from=pruner /app/out/full/ .

# Generate workflow nodes frontend files
RUN BUILDING_CONTAINER=true pnpm --filter="@auxx/workflow-nodes" run generate

# Build all upstream dependencies (tsdown packages produce dist/*.mjs)
RUN BUILDING_CONTAINER=true pnpm turbo build --filter="@auxx/web^..."

# Build the web app (Next.js standalone output)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  BUILDING_CONTAINER=true \
  SKIP_ENV_VALIDATION=1 \
  pnpm --filter=web run build:prod

# ──────────────────────────────────────────────
# Stage 4: RUNNER — minimal production image
# ──────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runner

ARG DOMAIN=dev.auxx.ai

ENV HOSTNAME=0.0.0.0
ENV KEEP_ALIVE_TIMEOUT=601000
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000
ENV DOMAIN=$DOMAIN

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public

# Set the correct permission for prerender cache
RUN mkdir -p apps/web/.next apps/web/.next/cache && \
    chown nextjs:nodejs apps/web/.next apps/web/.next/cache

# Copy the standalone server and static assets
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Copy packages/database for drizzle-kit migrations (used by migrate service)
COPY --from=builder --chown=nextjs:nodejs /app/packages/database ./packages/database

# Copy the docker entrypoint for runtime env replacement
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Set permissions for local storage
RUN set -e; \
  mkdir -p /app/storage/files; \
  mkdir -p /app/apps/web/public/files; \
  chown -R 1001:1001 /app/storage/files /app/apps/web/public/files

USER nextjs
WORKDIR /app/apps/web

EXPOSE 3000

ENTRYPOINT ["../../docker-entrypoint.sh"]
CMD ["node", "server.js"]
