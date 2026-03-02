# Lambda Server Function Executor - Testing Guide

## Quick Start

### 1. Start Local Dev Server

```bash
cd apps/lambda
pnpm dev
```

The server will start on port 3008 with hot reload enabled.

### 2. Health Check

```bash
curl http://localhost:3008/health
```

Expected response:
```json
{
  "status": "ok",
  "port": 3008
}
```

## Test Cases

### Test 1: Hello World

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

Expected response:
```json
{
  "execution_result": {
    "message": "Hello, World!"
  },
  "metadata": {
    "duration": 45,
    "cold_start": true
  }
}
```

### Test 2: Echo Arguments

```bash
curl -XPOST http://localhost:3008 \
  -H "Content-Type: application/json" \
  -d '{
    "bundleKey": "test-org/apps/test-app/bundles/v1/server.js",
    "functionIdentifier": "actions/echo.server",
    "functionArgs": "[\"foo\", \"bar\", 123]",
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

Expected response:
```json
{
  "execution_result": {
    "echo": ["foo", "bar", 123]
  },
  "metadata": {
    "duration": 32,
    "cold_start": false
  }
}
```

### Test 3: Web Platform API (fetch)

```bash
curl -XPOST http://localhost:3008 \
  -H "Content-Type: application/json" \
  -d '{
    "bundleKey": "test-org/apps/test-app/bundles/v1/server.js",
    "functionIdentifier": "actions/fetch.server",
    "functionArgs": "[]",
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

Expected response:
```json
{
  "execution_result": {
    "zen": "Design for failure."
  },
  "metadata": {
    "duration": 234,
    "cold_start": false
  }
}
```

## Error Test Cases

### Test 4: Invalid Bundle Key

```bash
curl -XPOST http://localhost:3008 \
  -H "Content-Type: application/json" \
  -d '{
    "bundleKey": "invalid-key",
    "functionIdentifier": "actions/hello.server",
    "functionArgs": "[]",
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

Expected response (400 error):
```json
{
  "error": {
    "message": "Validation error...",
    "code": "EXECUTION_ERROR"
  },
  "metadata": {
    "duration": 5
  }
}
```

### Test 5: Function Not Found

```bash
curl -XPOST http://localhost:3008 \
  -H "Content-Type: application/json" \
  -d '{
    "bundleKey": "test-org/apps/test-app/bundles/v1/server.js",
    "functionIdentifier": "actions/nonexistent.server",
    "functionArgs": "[]",
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

Expected response (500 error):
```json
{
  "error": {
    "message": "Function not found: actions/nonexistent.server",
    "code": "EXECUTION_ERROR",
    "stack": "..."
  },
  "metadata": {
    "duration": 23
  }
}
```

### Test 6: Bundle Not Found

```bash
curl -XPOST http://localhost:3008 \
  -H "Content-Type: application/json" \
  -d '{
    "bundleKey": "test-org/apps/missing/bundles/v1/server.js",
    "functionIdentifier": "actions/hello.server",
    "functionArgs": "[]",
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

Expected response (500 error):
```json
{
  "error": {
    "message": "Bundle not found at /bundles/test-org/apps/missing/bundles/v1/server.js",
    "code": "EXECUTION_ERROR"
  },
  "metadata": {
    "duration": 12
  }
}
```

## Custom Bundle Testing

### 1. Create Your Own Test Bundle

```bash
# Create directory
mkdir -p .bundles/my-org/apps/my-app/bundles/v1

# Create server bundle
cat > .bundles/my-org/apps/my-app/bundles/v1/server.js << 'EOF'
export async function stdin_default(functionIdentifier, args) {
  if (functionIdentifier === 'actions/myFunction.server') {
    return { result: 'Custom function works!', args }
  }
  throw new Error(`Function not found: ${functionIdentifier}`)
}
EOF
```

### 2. Test Your Bundle

```bash
curl -XPOST http://localhost:3008 \
  -H "Content-Type: application/json" \
  -d '{
    "bundleKey": "my-org/apps/my-app/bundles/v1/server.js",
    "functionIdentifier": "actions/myFunction.server",
    "functionArgs": "[\"test\"]",
    "context": {
      "organizationId": "org-123",
      "organizationHandle": "my-org",
      "userId": "user-123",
      "userEmail": "test@example.com",
      "appId": "app-123",
      "appInstallationId": "install-123"
    }
  }'
```

## Monitoring

### View Logs

```bash
# Follow logs in real-time
cd apps/lambda
pnpm dev:logs

# Or with docker compose
docker compose -f apps/lambda/docker-compose.yml logs -f
```

### Check Container Status

```bash
docker ps | grep auxx-lambda-dev
```

### Restart Container

```bash
cd apps/lambda
pnpm dev:restart
```

### Stop Container

```bash
cd apps/lambda
pnpm dev:down
```

## Performance Metrics

Expected performance:
- **Cold start**: ~100-200ms (first request)
- **Warm execution**: ~20-50ms (subsequent requests)
- **With fetch**: ~200-500ms (depends on external API)

## Troubleshooting

### Port 3008 Already in Use

```bash
# Kill process on port 3008
lsof -ti:3008 | xargs kill -9

# Or change port in docker-compose.yml
```

### Container Won't Start

```bash
# Check logs
docker compose -f apps/lambda/docker-compose.yml logs

# Rebuild
cd apps/lambda
pnpm dev:down
pnpm dev
```

### Bundle Not Found

```bash
# Check bundle exists
ls -la .bundles/test-org/apps/test-app/bundles/v1/server.js

# Check permissions
chmod 644 .bundles/test-org/apps/test-app/bundles/v1/server.js
```

### Validation Errors

Make sure your request matches the schema:
- `bundleKey`: Must match pattern `{org}/apps/{app}/bundles/{version}/server.js`
- `functionIdentifier`: Must end with `.server`
- `functionArgs`: Must be valid JSON string
- `context.userEmail`: Must be valid email

## Integration Testing

### Test with Full Stack

1. **Start all services:**
   ```bash
   # Terminal 1: Lambda
   cd apps/lambda && pnpm dev

   # Terminal 2: API (if running separately)
   cd apps/api && pnpm dev

   # Terminal 3: Web
   cd apps/web && pnpm dev
   ```

2. **Test through API:**
   ```bash
   curl -XPOST http://localhost:3002/api/v1/organizations/test-org/apps/app-123/installations/install-123/execute-server-function \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -d '{
       "function_identifier": "actions/hello.server",
       "function_args": "[\"API\"]"
     }'
   ```

3. **Test from extension runtime:**
   - Load extension in browser
   - Call `runServerFunction('actions/hello.server', ['Browser'])`
   - Check Network tab for API request
   - Verify Lambda logs show execution

## Running Unit Tests

### Run All Tests

```bash
cd apps/lambda
deno test --allow-all
```

### Run Specific Test Suites

```bash
# Runtime helpers unit tests
deno test --allow-all test/runtime-helpers.test.ts

# Integration tests
deno test --allow-all test/integration.test.ts
```

### Test Coverage

The test suite includes:
- **Runtime Helpers Tests** (`test/runtime-helpers.test.ts`):
  - `registerSettingsSchema()` functionality
  - Server SDK injection and cleanup
  - `getCurrentUser()` implementation
  - Multiple execution cycles

- **Integration Tests** (`test/integration.test.ts`):
  - Bundle execution with `registerSettingsSchema`
  - Server SDK usage in bundles
  - Context access
  - Error handling and cleanup
  - Sequential executions

### Expected Test Output

All tests should pass:
```
test registerSettingsSchema - stores schema ... ok (5ms)
test getRegisteredSettingsSchema - returns null when no schema registered ... ok (2ms)
test resetSettingsSchema - clears registered schema ... ok (3ms)
...
test Multiple sequential executions work correctly ... ok (45ms)

ok | 25 passed | 0 failed (234ms)
```

## Next Steps

After testing locally:
1. Deploy to AWS with `pnpm sst deploy --stage dev`
2. Update `LAMBDA_URL` in API config
3. Test with production Lambda URL
4. Monitor CloudWatch logs and metrics
