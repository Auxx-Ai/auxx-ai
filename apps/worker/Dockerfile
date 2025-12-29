ARG PROJECT="worker"
ARG PROJECT_PATH="apps/worker"

# Base stage with pnpm
FROM node:22-alpine AS base

# Install build dependencies
RUN apk add --no-cache libc6-compat python3 make g++ gcc

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install turbo
RUN pnpm add -g turbo

# Build stage - build the entire workspace
FROM base AS builder

WORKDIR /app

# Copy entire monorepo
COPY . .

# Install ALL dependencies (dev + prod)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --no-frozen-lockfile

# Build the worker and its dependencies
RUN pnpm turbo build --filter="@auxx/worker..."

# Deploy stage - create standalone package
FROM base AS deploy

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
    pnpm --filter @auxx/worker --prod deploy --legacy /deployed

# Runner stage - minimal production image
FROM node:22-alpine AS runner

ENV NODE_ENV=production
ENV PORT=8080

# Install runtime dependencies only
RUN apk add --no-cache libc6-compat

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

# Copy the deployed package
COPY --from=deploy --chown=worker:nodejs /deployed /app

USER worker

WORKDIR /app

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

EXPOSE 8080

CMD ["node", "dist/server.js"]
