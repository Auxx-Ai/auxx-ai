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

# Build-time placeholders for NEXT_PUBLIC_* runtime env replacement
ARG NEXT_PUBLIC_BASE_URL=https://__RUNTIME_NEXT_PUBLIC_BASE_URL__
ARG NEXT_PUBLIC_APP_URL=https://__RUNTIME_NEXT_PUBLIC_APP_URL__
ARG NEXT_PUBLIC_API_URL=https://__RUNTIME_NEXT_PUBLIC_API_URL__
ARG NEXT_PUBLIC_DEV_PORTAL_URL=https://__RUNTIME_NEXT_PUBLIC_DEV_PORTAL_URL__
ARG NEXT_PUBLIC_HOMEPAGE_URL=https://__RUNTIME_NEXT_PUBLIC_HOMEPAGE_URL__
ARG NEXT_PUBLIC_CDN_URL=https://__RUNTIME_NEXT_PUBLIC_CDN_URL__
ARG NEXT_PUBLIC_S3_PUBLIC_BUCKET=__RUNTIME_NEXT_PUBLIC_S3_PUBLIC_BUCKET__
ARG NEXT_PUBLIC_S3_PRIVATE_BUCKET=__RUNTIME_NEXT_PUBLIC_S3_PRIVATE_BUCKET__
ARG NEXT_PUBLIC_S3_REGION=__RUNTIME_NEXT_PUBLIC_S3_REGION__
ARG NEXT_PUBLIC_STORAGE_TYPE=__RUNTIME_NEXT_PUBLIC_STORAGE_TYPE__
ARG NEXT_PUBLIC_ENV=__RUNTIME_NEXT_PUBLIC_ENV__
ARG NEXT_PUBLIC_PUSHER_KEY=__RUNTIME_NEXT_PUBLIC_PUSHER_KEY__
ARG NEXT_PUBLIC_PUSHER_CLUSTER=__RUNTIME_NEXT_PUBLIC_PUSHER_CLUSTER__

# Mock build-time env vars
ENV DATABASE_URL="postgresql://postgres:password@localhost:5432/mock_db"
ENV OPENAI_API_KEY="sk-mock-openai-api-key-for-build-time"
ENV ANTHROPIC_API_KEY="sk-ant-mock-anthropic-api-key-for-build-time"
ENV API_KEY_SALT="mock-api-key-salt-for-build"
ENV BETTER_AUTH_SECRET="mock-better-auth-secret-for-build"
ENV REDIS_HOST="localhost"
ENV REDIS_PORT="6379"
ENV S3_REGION="us-east-1"
ENV FILE_STORAGE_TYPE="local"
ENV MAILGUN_API_KEY="mock-mailgun-api-key"
ENV MAILGUN_DOMAIN="mail.example.com"
ENV SYSTEM_FROM_EMAIL="no-reply@example.com"
ENV SUPPORT_EMAIL="support@example.com"
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
RUN BUILDING_CONTAINER=true pnpm turbo build --filter="@auxx/config"

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

ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3006

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
COPY --from=builder --chown=nodejs:nextjs /app/apps/build/.next/standalone ./
COPY --from=builder --chown=nodejs:nextjs /app/apps/build/.next/static ./apps/build/.next/static

# Copy the docker entrypoint for runtime env replacement
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

WORKDIR /app/apps/build

EXPOSE 3006

ENTRYPOINT ["../../docker-entrypoint.sh"]
CMD ["node", "server.js"]
