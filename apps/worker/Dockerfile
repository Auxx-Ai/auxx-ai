ARG PROJECT="worker"
ARG PROJECT_PATH="apps/worker"

# Base stage with pnpm
FROM node:22.22-bookworm-slim AS base

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    gcc \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@10.17.0 --activate

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install turbo
RUN pnpm add -g turbo@2.5.2

# Build stage - build the worker target
FROM base AS builder

WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=1536

# Copy entire monorepo
COPY . .

# Install ALL dependencies (dev + prod)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --no-frozen-lockfile --filter @auxx/worker...

# Build worker and its workspace dependencies (one at a time to limit memory)
RUN pnpm --filter @auxx/worker... --workspace-concurrency=1 build

# Deploy stage - create standalone package (clean base without build tools)
FROM node:22.22-bookworm-slim AS deploy

RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

# Copy the built workspace
COPY --from=builder /app .

# Tune pnpm network and retries to reduce transient failures during heavy installs
ENV PNPM_NETWORK_CONCURRENCY=4 \
    PNPM_FETCH_RETRIES=5 \
    PNPM_FETCH_RETRY_FACTOR=2 \
    PNPM_FETCH_RETRY_MINTIMEOUT=20000 \
    PNPM_FETCH_RETRY_MAXTIMEOUT=120000 \
    PNPM_PREFER_OFFLINE=true

# Use pnpm deploy to create a standalone worker package with all dependencies
# Drizzle doesn't require runtime client generation
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @auxx/worker --prod deploy --legacy /deployed && \
    rm -rf /deployed/node_modules/.cache /deployed/node_modules/.package-lock.json

# Runner stage - minimal production image
FROM node:22.22-bookworm-slim AS runner

ENV NODE_ENV=production

# Install curl for docker-compose healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs worker

# Copy the deployed package
COPY --from=deploy --chown=worker:nodejs /deployed /app

USER worker

WORKDIR /app

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3005/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

EXPOSE 3005

CMD ["node", "dist/server.js"]
