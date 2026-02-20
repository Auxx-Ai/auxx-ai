# apps/api/Dockerfile
ARG PROJECT="api"

# Base stage with pnpm
FROM node:22-bookworm-slim AS base

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

# Build stage
FROM base AS builder

WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=1536

# Copy entire monorepo
COPY . .

# Install ALL dependencies (dev + prod)
# --ignore-scripts prevents @postman/node-keytar arm64 prebuild failure
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --no-frozen-lockfile --ignore-scripts --filter @auxx/api...

# Build api and its workspace dependencies
RUN pnpm --filter @auxx/api... --workspace-concurrency=1 build

# Deploy stage - create standalone package (clean base without build tools)
FROM node:22-bookworm-slim AS deploy

RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

COPY --from=builder /app .

ENV PNPM_NETWORK_CONCURRENCY=4 \
    PNPM_FETCH_RETRIES=5 \
    PNPM_FETCH_RETRY_FACTOR=2 \
    PNPM_FETCH_RETRY_MINTIMEOUT=20000 \
    PNPM_FETCH_RETRY_MAXTIMEOUT=120000 \
    PNPM_PREFER_OFFLINE=true

# Use pnpm deploy to create a standalone api package with all dependencies
# --ignore-scripts prevents @postman/node-keytar arm64 prebuild failure
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @auxx/api --prod deploy --legacy --ignore-scripts /deployed && \
    rm -rf /deployed/node_modules/.cache /deployed/node_modules/.package-lock.json

# Runner stage - minimal production image
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=3007

# Install curl for docker-compose healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs api

# Copy the deployed package
COPY --from=deploy --chown=api:nodejs /deployed /app

USER api

WORKDIR /app

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3007/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

EXPOSE 3007

CMD ["node", "dist/index.js"]
