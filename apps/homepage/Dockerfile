# apps/homepage/Dockerfile
ARG PROJECT="@auxx/homepage"
ARG PROJECT_PATH="apps/homepage"

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

# Prune the monorepo for the homepage project
RUN turbo prune "${PROJECT}" --docker

FROM base AS builder

ARG PROJECT
ARG PROJECT_PATH
ARG GIT_SHA
ARG APP_VERSION
ARG BUILD_TIME

WORKDIR /app

# Copy pruned lockfiles and package files
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/full/ .

# Install dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install \
  --no-frozen-lockfile \
  --filter "${PROJECT}..." \
  --ignore-scripts

# Build the application
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  NEXT_TELEMETRY_DISABLED=1 \
  pnpm turbo build --filter="${PROJECT}..."

# Prune dev dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store CI=true pnpm prune --prod --no-optional --ignore-scripts

FROM slim AS runner

ARG PROJECT_PATH

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
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

# Copy public directory (homepage has many images)
COPY --from=builder --chown=nextjs:nodejs /app/${PROJECT_PATH}/public ./${PROJECT_PATH}/public

USER nextjs

WORKDIR /app/${PROJECT_PATH}

EXPOSE 3001

CMD ["node", "server.js"]
