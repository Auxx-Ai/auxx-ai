# @auxx/services

Shared service layer for Auxx.ai that consolidates business logic, error types, and data schemas.

## Overview

This package provides a single source of truth for all business logic across both `apps/api` (Hono REST) and `apps/web` (Next.js + tRPC).

## Architecture

- **Domain-specific organization**: Each domain has its own directory with services, errors, and schemas
- **Result-based error handling**: All services return `Result<T, E>` types using neverthrow
- **Type-safe schemas**: Zod schemas for validation and type inference
- **Granular exports**: Import only what you need

## Domains

- `apps/` - App marketplace CRUD operations
- `app-versions/` - Version management
- `app-bundles/` - Bundle upload/download
- `app-installations/` - Installation management
- `organizations/` - Organization CRUD and access control
- `organization-members/` - Membership management
- `developer-accounts/` - Developer verification
- `users/` - User management
- `shared/` - Base errors, utils, and error maps

## Usage

### In apps/api (Hono REST)

```typescript
import { getAvailableApps } from '@auxx/services/apps'
import { ERROR_STATUS_MAP } from '@auxx/services/shared/error-maps'

const result = await getAvailableApps({ organizationId })

if (result.isErr()) {
  const error = result.error
  const status = ERROR_STATUS_MAP[error.code] ?? 500
  return c.json(errorResponse(error), status)
}

return c.json(successResponse(result.value))
```

### In apps/web (Next.js + tRPC)

```typescript
import { getAvailableApps } from '@auxx/services/apps'
import { ERROR_TRPC_MAP } from '@auxx/services/shared/error-maps'

const result = await getAvailableApps({ organizationId })

if (result.isErr()) {
  const trpcCode = ERROR_TRPC_MAP[result.error.code] ?? 'INTERNAL_SERVER_ERROR'
  throw new TRPCError({ code: trpcCode, message: result.error.message })
}

return result.value
```

## Service Pattern

All services follow a consistent functional pattern:

```typescript
export interface SomeServiceInput {
  // Input parameters
}

export interface SomeServiceOutput {
  // Success output
}

export async function someService(
  input: SomeServiceInput
): Promise<Result<SomeServiceOutput, SomeError>> {
  // Implementation
}
```

## Error Handling

Each domain has its own error types. Use the centralized error maps for HTTP/tRPC conversion:

- `ERROR_STATUS_MAP` - Maps error codes to HTTP status codes (for apps/api)
- `ERROR_TRPC_MAP` - Maps error codes to tRPC error codes (for apps/web)
