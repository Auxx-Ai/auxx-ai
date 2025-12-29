# API Testing Guide

## Prerequisites

1. **Login with SDK** (to get a valid token):
   ```bash
   auxx login
   ```

2. **API Server Running**:
   ```bash
   cd apps/api
   pnpm dev
   ```
   Server should be running on `http://localhost:3007`

## Option 1: Automated Test Script

Run the comprehensive test script:

```bash
cd apps/api
./test-api.sh
```

This will:
- ✅ Check health endpoint
- ✅ Get current developer info
- ✅ Create developer account if needed
- ✅ List all apps
- ✅ Get app by slug
- ✅ Test error cases (401, 404)

## Option 2: Manual Testing with curl

### Step 1: Get Your Access Token

**macOS/Linux:**
```bash
# Extract token from keychain
TOKEN=$(node -e "
import('@postman/node-keytar').then(async (module) => {
  const keytar = module.default || module;
  const token = await keytar.getPassword('auxx-cli', 'default');
  const parsed = JSON.parse(token);
  console.log(parsed.access_token);
});
")

echo $TOKEN
```

**Or use this Node.js script:**
```bash
node -e "
import('@postman/node-keytar').then(async (module) => {
  const keytar = module.default || module;
  const token = await keytar.getPassword('auxx-cli', 'default');
  if (!token) {
    console.error('No token found. Run: auxx login');
    process.exit(1);
  }
  const parsed = JSON.parse(token);
  console.log('Your access token:');
  console.log(parsed.access_token);
});
"
```

### Step 2: Test Endpoints

#### 1. Health Check (No Auth Required)
```bash
curl http://localhost:3007/health | jq
```

Expected:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-13T...",
    "database": "connected"
  }
}
```

#### 2. Get Current Developer
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3007/api/v1/developers/me | jq
```

Expected (if account exists):
```json
{
  "success": true,
  "data": {
    "developer": {
      "id": "...",
      "slug": "...",
      "title": "...",
      "memberAccessLevel": "admin",
      "memberCreatedAt": "...",
      ...
    }
  }
}
```

Expected (if no account):
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Developer account not found. Please create one first."
  }
}
```

#### 3. Create Developer Account
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3007/api/v1/developers | jq
```

Expected:
```json
{
  "success": true,
  "data": {
    "developer": {
      "id": "...",
      "slug": "dev-...",
      "title": "...",
      "memberAccessLevel": "admin",
      ...
    }
  }
}
```

#### 4. List Apps
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3007/api/v1/apps | jq
```

Expected:
```json
{
  "success": true,
  "data": {
    "apps": [
      {
        "id": "...",
        "slug": "my-app",
        "title": "My App",
        ...
      }
    ]
  }
}
```

#### 5. Get App by Slug
```bash
# Replace 'my-app' with actual app slug
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3007/api/v1/apps/by-slug/my-app | jq
```

Expected (if app exists and you have access):
```json
{
  "success": true,
  "data": {
    "app": {
      "id": "...",
      "slug": "my-app",
      "title": "My App",
      "developerAccount": { ... },
      ...
    }
  }
}
```

Expected (if app not found):
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "App with slug \"my-app\" not found"
  }
}
```

Expected (if you don't have access):
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this app"
  }
}
```

### Step 3: Test Error Cases

#### Missing Token
```bash
curl http://localhost:3007/api/v1/developers/me | jq
```

Expected: `401 Unauthorized`
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing authentication token"
  }
}
```

#### Invalid Token
```bash
curl -H "Authorization: Bearer invalid-token-12345" \
  http://localhost:3007/api/v1/developers/me | jq
```

Expected: `401 Unauthorized`
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid token"
  }
}
```

#### Non-existent App
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3007/api/v1/apps/by-slug/non-existent-app | jq
```

Expected: `404 Not Found`
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "App with slug \"non-existent-app\" not found"
  }
}
```

## Option 3: Testing with SDK

If the SDK has been updated to use these endpoints, you can test via SDK commands:

```bash
# Login (if not already)
auxx login

# Check authentication
auxx whoami

# List apps (if SDK command exists)
auxx apps list

# Get app info (if SDK command exists)
auxx apps info my-app
```

## Troubleshooting

### "No token found"
Run `auxx login` first to authenticate and store a token.

### "Developer account not found"
Create one with:
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3007/api/v1/developers
```

### "Connection refused"
Make sure the API server is running:
```bash
cd apps/api
pnpm dev
```

### Token validation fails
- Check that `apps/web` (better-auth) is running on port 3000
- Verify `WEBAPP_URL` in config points to `http://localhost:3000`
- Token might be expired - run `auxx login` again

## Database Queries

If you want to verify data directly in the database:

```sql
-- Check developer accounts
SELECT * FROM "DeveloperAccount";

-- Check developer account members
SELECT * FROM "DeveloperAccountMember";

-- Check which users have access to which accounts
SELECT
  dam.id,
  dam."userId",
  dam."emailAddress",
  dam."accessLevel",
  da.slug,
  da.title
FROM "DeveloperAccountMember" dam
JOIN "DeveloperAccount" da ON da.id = dam."developerAccountId";

-- Check apps
SELECT * FROM "App";
```

## API Response Format

All API responses follow this format:

**Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { ... }  // optional
  }
}
```

## Next Steps

After verifying the API works:

1. ✅ Test creating apps via API
2. ✅ Test updating apps via API
3. ✅ Integrate with SDK commands
4. ✅ Add rate limiting
5. ✅ Deploy to production
