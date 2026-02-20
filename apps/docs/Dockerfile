# apps/docs/Dockerfile
ARG PROJECT="docs"
ARG PROJECT_PATH="apps/docs"

FROM node:22.22-bookworm-slim AS slim

FROM slim AS base

# Install pnpm and turbo
RUN npm install -g corepack@0.31.0 && corepack enable
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN pnpm install -g turbo

FROM base AS pruner

ARG PROJECT

WORKDIR /app

COPY . .

# Prune the monorepo for the docs project
RUN turbo prune "${PROJECT}" --docker

FROM base AS builder

ARG PROJECT
ARG PROJECT_PATH

WORKDIR /app

# Copy pruned lockfiles and package files
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/full/ .

# Install dependencies (without frozen lockfile due to dependency issues)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install \
  --no-frozen-lockfile \
  --filter "${PROJECT}..." \
  --ignore-scripts

# Build the application
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  NEXT_TELEMETRY_DISABLED=1 \
  pnpm turbo build --filter="${PROJECT}..."

# Prune dev dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm prune --prod --no-optional

FROM slim AS runner

ARG PROJECT_PATH

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3004
ENV HOSTNAME=0.0.0.0

WORKDIR /app

# Create user and group
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Set up directories
RUN mkdir -p ${PROJECT_PATH}/.next
RUN chown nextjs:nodejs ${PROJECT_PATH}/.next

# Copy standalone build
COPY --from=builder --chown=nextjs:nodejs /app/${PROJECT_PATH}/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/${PROJECT_PATH}/.next/static ./${PROJECT_PATH}/.next/static

# Copy public directory if it exists
COPY --from=builder --chown=nextjs:nodejs /app/${PROJECT_PATH}/public ./${PROJECT_PATH}/public

# Standalone output includes required node_modules; no extra copies needed

USER nextjs

WORKDIR /app/${PROJECT_PATH}

EXPOSE 3004

CMD ["node", "server.js"]
