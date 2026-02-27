# apps/build/Dockerfile
ARG PROJECT="build"
ARG PROJECT_PATH="apps/build"

FROM node:22.22-bookworm-slim AS slim

FROM slim AS base

RUN npm install -g corepack@0.31.0 && corepack enable

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN pnpm install -g turbo

FROM base AS pruner

WORKDIR /app

COPY . .

RUN turbo prune @auxx/build --docker

# BUILDER stage
FROM base AS builder

ARG DOMAIN=__RUNTIME_DOMAIN__

# Build-time mocks for modules that read env at import time
ENV DATABASE_URL="postgresql://postgres:password@localhost:5432/mock_db"
ENV DOMAIN=$DOMAIN
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
  --filter "@auxx/build..."

ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV TURBO_TELEMETRY_DISABLED=1

# Build dependencies first
RUN BUILDING_CONTAINER=true pnpm turbo build --filter="@auxx/build^..."

# Build the build app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  BUILDING_CONTAINER=true \
  NEXT_TELEMETRY_DISABLED=1 \
  SKIP_ENV_VALIDATION=1 \
  NODE_OPTIONS="--max-old-space-size=4096" \
  pnpm --filter=@auxx/build run build

# PRODUCTION
FROM slim AS runner

ARG PROJECT_PATH
ARG DOMAIN=dev.auxx.ai
ARG GIT_SHA
ARG APP_VERSION
ARG BUILD_TIME

ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3006
ENV DOMAIN=$DOMAIN
ENV GIT_SHA=$GIT_SHA
ENV APP_VERSION=$APP_VERSION
ENV BUILD_TIME=$BUILD_TIME

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/apps/build/public ./apps/build/public

RUN mkdir -p apps/build/.next
RUN mkdir -p apps/build/.next/cache
RUN chown nextjs:nodejs apps/build/.next
RUN chown nextjs:nodejs apps/build/.next/cache

# Copy the standalone server and static assets
COPY --from=builder --chown=nextjs:nodejs /app/apps/build/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/build/.next/static ./apps/build/.next/static

# Copy the docker entrypoint for runtime env replacement
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

WORKDIR /app/apps/build

EXPOSE 3006

ENTRYPOINT ["../../docker-entrypoint.sh"]
CMD ["node", "server.js"]
