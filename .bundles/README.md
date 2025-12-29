# Local Development Bundles

This directory stores extension server bundles for local development.

## Directory Structure

```
.bundles/
├── org-123/
│   └── apps/
│       └── app-456/
│           └── bundles/
│               └── v1.0.0/
│                   └── server.js
└── test-org/
    └── apps/
        └── test-app/
            └── bundles/
                └── v1/
                    └── server.js
```

## Usage

1. Build your extension:
   ```bash
   cd my-extension
   pnpm build
   ```

2. Copy server bundle:
   ```bash
   mkdir -p .bundles/org-123/apps/app-456/bundles/v1.0.0
   cp dist/server.js .bundles/org-123/apps/app-456/bundles/v1.0.0/
   ```

3. Lambda dev server will load from this directory

## Test Bundle

A simple test bundle is provided at `.bundles/test-org/apps/test-app/bundles/v1/server.js` for testing the Lambda executor.
