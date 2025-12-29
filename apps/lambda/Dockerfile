# Base stage with Deno
FROM denoland/deno:debian-1.45.5 AS base

# AWS Lambda Runtime Interface Emulator for local testing
FROM base AS builder

WORKDIR /app

# Copy SDK files (needed by import map)
COPY packages/sdk/lib ./packages/sdk/lib

# Copy source files
COPY apps/lambda/src ./src
COPY apps/lambda/deno.json ./deno.json

# Cache dependencies
RUN deno cache src/index.ts

# Production stage - AWS Lambda base image
FROM public.ecr.aws/lambda/provided:al2023 AS runner

# Install unzip (required for Deno installation) and Deno
RUN dnf install -y unzip && \
    curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && \
    dnf clean all

# Set environment
ENV DENO_DIR=/tmp/deno_cache
ENV PATH="/usr/local/bin:${PATH}"
ENV NODE_ENV=production

# Copy application
COPY --from=builder /app /var/task

# Lambda handler wrapper script
COPY apps/lambda/bootstrap /var/runtime/bootstrap
RUN chmod +x /var/runtime/bootstrap

# Lambda will call this
CMD ["index.handler"]
