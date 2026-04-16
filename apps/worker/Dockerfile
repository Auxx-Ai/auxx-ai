ARG NODE_VERSION=22.22

# ──────────────────────────────────────────────
# Stage 1: PRUNER — extract only worker-relevant packages
# ──────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS pruner

RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN pnpm add -g turbo@2.5.2

WORKDIR /app
COPY . .
RUN turbo prune @auxx/worker --docker

# ──────────────────────────────────────────────
# Stage 2: INSTALLER — install dependencies (cached layer)
# ──────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS installer

# Build tools for native addons (pg, bcrypt, sharp, etc.)
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

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ──────────────────────────────────────────────
# Stage 3: BUILDER — compile TypeScript (invalidated on source changes)
# ──────────────────────────────────────────────
FROM installer AS builder

ENV NODE_OPTIONS=--max-old-space-size=4096

# Copy full source of relevant packages
COPY --from=pruner /app/out/full/ .

# Build worker and all workspace deps
RUN pnpm --filter @auxx/worker... --workspace-concurrency=1 build

# ──────────────────────────────────────────────
# Stage 4: DEPLOY — extract production-only dependencies
# ──────────────────────────────────────────────
FROM installer AS deploy

COPY --from=builder /app .

# Tune pnpm for reliability
ENV PNPM_NETWORK_CONCURRENCY=4 \
    PNPM_FETCH_RETRIES=5 \
    PNPM_FETCH_RETRY_FACTOR=2 \
    PNPM_FETCH_RETRY_MINTIMEOUT=20000 \
    PNPM_FETCH_RETRY_MAXTIMEOUT=120000 \
    PNPM_PREFER_OFFLINE=true

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @auxx/worker --prod deploy --legacy /deployed 2>&1 \
    | grep -v 'WARN  Skip adding .* to the default catalog' && \
    rm -rf /deployed/node_modules/.cache /deployed/node_modules/.package-lock.json

# ──────────────────────────────────────────────
# Stage 5: RUNNER — minimal production image
# ──────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runner

ARG GIT_SHA
ARG APP_VERSION
ARG BUILD_TIME

ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
ENV APP_VERSION=$APP_VERSION
ENV BUILD_TIME=$BUILD_TIME

RUN apt-get update && apt-get install -y --no-install-recommends curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs worker

COPY --from=deploy --chown=worker:nodejs /deployed /app

USER worker
WORKDIR /app

ENV WORKER_PORT=3005

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${WORKER_PORT}/health || exit 1

EXPOSE 3005
CMD ["node", "dist/server.mjs"]
