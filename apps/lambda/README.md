# Lambda Server Function Executor

AWS Lambda function for executing Auxx extension server functions in a secure Deno sandbox.

## Overview

This Lambda function provides a secure execution environment for extension server functions with:
- **Deno Runtime**: Web Platform APIs only (no Node.js built-ins)
- **Security**: Sandboxed execution with timeout and memory limits
- **Local Dev**: Docker-based development environment on port 3008
- **Storage**: S3 for production bundles, filesystem for local dev

## Architecture

```
Extension → Platform → API → Lambda (port 3008 dev / Lambda URL prod) → Deno Sandbox
```

## Local Development

### Start Dev Server

```bash
# Start Docker container with hot reload
pnpm dev

# View logs
pnpm dev:logs

# Stop server
pnpm dev:down
```

### Test Connectivity

Test connectivity from Lambda to API server:

```bash
# Test Lambda-to-API connection
pnpm test:api
```

This will verify:
- Network connectivity between Lambda and API
- DNS resolution
- API endpoint accessibility
- Docker network configuration

### Test Lambda Execution

```bash
curl -XPOST http://localhost:3008 \
  -H "Content-Type: application/json" \
  -d '{
    "bundleKey": "test-org/apps/test-app/bundles/v1/server.js",
    "functionIdentifier": "actions/hello.server",
    "functionArgs": "[\"World\"]",
    "context": {
      "organizationId": "org-123",
      "organizationHandle": "test-org",
      "userId": "user-123",
      "userEmail": "test@example.com",
      "appId": "app-123",
      "appInstallationId": "install-123"
    }
  }'
```

### Local Bundle Storage

Place test bundles in `.bundles/` directory:

```
.bundles/
└── test-org/
    └── apps/
        └── test-app/
            └── bundles/
                └── v1/
                    └── server.js
```

## Production Deployment

```bash
# Deploy to dev
pnpm sst deploy --stage dev

# Deploy to production
pnpm sst deploy --stage production
```

## Security Model

- ✅ Web Platform APIs (fetch, Response, Request, Headers)
- ✅ JavaScript natives (Object, Array, Promise, etc.)
- ❌ NO Node.js built-ins (fs, http, path, etc.)
- ❌ NO filesystem access (except bundles)
- ⏱️ 30 second timeout
- 💾 512MB memory limit

## File Structure

```
apps/lambda/
├── src/
│   ├── index.ts              # Lambda handler
│   ├── executor.ts           # Server function executor
│   ├── bundle-loader.ts      # S3/filesystem bundle loading
│   ├── context-provider.ts   # Runtime context
│   ├── dev-server.ts         # Local HTTP server
│   └── types.ts              # Type definitions
├── Dockerfile                # Production container
├── Dockerfile.dev            # Development container
├── docker-compose.yml        # Local dev setup
├── deno.json                 # Deno configuration
├── package.json              # Package config
└── README.md                 # This file
```

## Environment Variables

### Development
- `NODE_ENV=development`
- `LOCAL_BUNDLES_PATH=/bundles`
- `PORT=3008`

### Production
- `NODE_ENV=production`
- `S3_REGION=us-west-1`
- `S3_PRIVATE_BUCKET=auxx-private-[stage]`
- `S3_ACCESS_KEY_ID` (self-hosted only, omit for AWS IAM)
- `S3_SECRET_ACCESS_KEY` (self-hosted only, omit for AWS IAM)
- `S3_ENDPOINT` (self-hosted only, for non-AWS S3)

## Monitoring

CloudWatch metrics:
- Invocations
- Errors
- Duration
- Throttles

## Cost

Within AWS free tier:
- 1M requests/month free
- ~$13/month at 1M requests after free tier
