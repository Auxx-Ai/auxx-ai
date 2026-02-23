# Claude Project Instructions

## Important Rules

- Do not lie to me, that is being dishonest.
- Do not tell me I'm right when I'm not right.
- If my idea is inferior to your idea, let me know.

## Project Overview

Auxx.ai is an open-source AI-powered email support ticket answer service for Shopify businesses. The platform integrates email services (Gmail and Outlook) with Shopify to provide automated customer support solutions.

## Tech Stack

- **Framework**: Next.js v16.1 with React Server Components and app router
- **API**: tRPC v11 with React Query
- **Database**: PostgreSQL with Drizzle ORM v0.44, pgvector
- **Auth**: Better-auth v1.3 (Google, GitHub, Email/Password, Passkey, 2FA)
- **Frontend**: TailwindCSS v4, shadcn component library
- **Forms**: react-hook-form v7.54
- **State**: Zustand
- **Caching**: Redis
- **Linting**: Biome (2-space indent, 100-char line width, single quotes)
- **Build**: Turborepo, pnpm
- **Infra**: AWS (SST), Docker

## Monorepo Structure

### Apps

| App | Port | Purpose |
|-----|------|---------|
| `apps/web` | 3000 | Main Next.js application |
| `apps/api` | 3007 | Express REST API |
| `apps/worker` | 3005 | Job/queue worker (BullMQ) |
| `apps/lambda` | 3008 | AWS Lambda handlers |
| `apps/build` | 3006 | Build-time utilities |
| `apps/homepage` | 3001 | Marketing site |
| `apps/kb` | 3002 | Knowledge base |
| `apps/docs` | 3004 | Documentation |

### Key Packages

| Package | Purpose |
|---------|---------|
| `@auxx/database` | Drizzle schema, models, migrations |
| `@auxx/lib` | Shared business logic (~70 feature modules) |
| `@auxx/ui` | Shadcn component library |
| `@auxx/types` | Shared TypeScript types |
| `@auxx/services` | Business service layer |
| `@auxx/config` | Configuration management |
| `@auxx/credentials` | Credential/secret management |
| `@auxx/redis` | Redis client wrapper |
| `@auxx/email` | Email service (Mailgun, SES, SMTP) |
| `@auxx/billing` | Stripe integration |
| `@auxx/sdk` | Public SDK |

### Key Paths

| What | Where |
|------|-------|
| Next.js app routes | `apps/web/src/app/` |
| tRPC routers | `apps/web/src/server/api/routers/` |
| tRPC root router | `apps/web/src/server/api/root.ts` |
| tRPC setup & middleware | `apps/web/src/server/api/trpc.ts` |
| Auth config | `apps/web/src/auth/server.ts` |
| DB schema files | `packages/database/src/db/schema/` |
| DB models | `packages/database/src/db/models/` |
| Shared lib modules | `packages/lib/src/` |
| UI components | `packages/ui/src/components/` |
| Infrastructure (SST) | `infra/` |
| CI/CD workflows | `.github/workflows/` |
| Environment template | `.env.example` |

---

# Coding Standards

## General

- Use TypeScript for all code.
- Implement responsive designs for all components.
- This is an early-stage startup. Prioritize simple, readable code with minimal abstraction. Strive for elegant, minimal solutions. No premature optimization. No backward compatibility unless specifically requested.
- Add JSDoc to exported public APIs. Prefer self-documenting code over inline comments.
- At the top of each file, comment the file-path/file-name.

## Client vs Server Imports

**CRITICAL**: Never import from `@auxx/lib/<module>` in client-side code. Barrel exports pull in server-only dependencies (bullmq, sharp, etc.) and will break the build.

```typescript
// WRONG — pulls in server-only deps:
import { something } from '@auxx/lib/custom-fields'

// CORRECT — client-safe export:
import { something } from '@auxx/lib/custom-fields/client'
```

If a constant/type doesn't exist in the `/client` export yet, add it there first, then import from `/client`. See `packages/lib/package.json` exports field for all available subpaths.

## Component Architecture

- File naming: kebab-case (e.g., `user-profile.tsx`)
- Component naming: PascalCase (e.g., `UserProfile`)
- Add `'use client'` directive for any components using client-side hooks or state
- Split components when: file exceeds 800 lines, UI is reused, or it has a clear single responsibility

## API & Data Handling

### tRPC Procedure Types

| Procedure | Use for |
|-----------|---------|
| `publicProcedure` | Unauthenticated routes |
| `protectedProcedure` | Authenticated routes (verifies session + organization) |
| `adminProcedure` | Admin/owner only (checks via `OrganizationMemberModel.isAdminOrOwner()`) |
| `superAdminProcedure` | Super admin only (checks `isSuperAdmin` flag) |

### tRPC Context

```typescript
ctx.db        // Drizzle database instance
ctx.session   // Better-auth session (user, defaultOrganizationId, isSuperAdmin)
ctx.headers   // Request headers
```

### Conventions

- Access DB in protected procedures with `ctx.db.<tableName>` (singular form)
- Import tRPC client: `import { api } from '~/trpc/react'`
- Mutation naming — use the action name, not suffixed with "Mutation":
  ```typescript
  // Do:
  const sendReply = api.ticketAttachment.sendTicketReply.useMutation()
  // Don't:
  const sendReplyMutation = api.ticketAttachment.sendTicketReply.useMutation()
  ```

## Error Handling

### AuxxError Classes (`@auxx/lib/errors`)

Use the appropriate error class. All extend `AuxxError`:

| Class | Status | Use for |
|-------|--------|---------|
| `BadRequestError` | 400 | Invalid input |
| `UnauthorizedError` | 401 | Not authenticated |
| `ForbiddenError` | 403 | Not authorized |
| `NotFoundError` | 404 | Resource not found |
| `ConflictError` | 409 | Duplicate/conflict |
| `UnprocessableEntityError` | 422 | Validation failure |
| `RateLimitError` | 429 | Too many requests |

### Result Pattern (`@auxx/lib/result`)

Database models return `TypedResult<V, E>` instead of throwing:

```typescript
const result = await model.findById(id)
if (result.ok) {
  const value = result.value
} else {
  const error = result.error // Error instance
}

// Creating results:
Result.ok(value)
Result.error(new NotFoundError('Not found'))
Result.nil() // Ok with undefined value
```

## Database Models

Models extend `BaseModel` with typed CRUD operations and org-scoped queries:

```typescript
export class ApiKeyModel extends BaseModel<typeof ApiKey, CreateInput, Entity, UpdateInput> {
  get table() { return ApiKey }

  async listActiveByUser(userId: string): Promise<TypedResult<ApiKeyEntity[], Error>> {
    // Uses this.db, this.scopeFilter, Result.ok/error
  }
}
```

## Database Schema Changes

- **Never write raw SQL migration files.** Always modify the Drizzle schema files in `packages/database/src/db/schema/`.
- When planning tasks that involve schema changes, show the TypeScript schema file changes, not SQL.
- After modifying schema files, generate the migration: `pnpm db:generate --name <descriptive_name>`
- Apply the migration: `pnpm db:migrate`

## Module Exports

In `index.ts` files, use explicit named exports:

```typescript
// Do:
export { X, Y } from './xy'
// Don't:
export * from './xy'
```

## Zustand Stores

Always use selectors to avoid unnecessary re-renders:

```typescript
// CORRECT:
const markDirty = useWorkflowStore((state) => state.markDirty)

// WRONG — causes re-renders on every state change:
const { markDirty } = useWorkflowStore()
```

## UI Components

- Import shadcn components from `'@auxx/ui/components/<component>'`
- Every `<SelectItem>` must have a `value` prop

### Toast (errors only)

```typescript
import { toastError } from '@auxx/ui/components/toast'

// No success toasts. Only error:
toastError({ title: 'Error sending reply', description: error.message })
```

### Delete Confirmations

```typescript
import { useConfirm } from '~/hooks/use-confirm'

const [confirm, ConfirmDialog] = useConfirm()
const confirmed = await confirm({
  title: 'Delete item?',
  description: 'This action cannot be undone.',
  confirmText: 'Remove',
  cancelText: 'Cancel',
  destructive: true,
})
if (confirmed) { /* delete */ }
```

### Buttons

```typescript
// Loading state:
<Button variant="outline" loading={isPending} loadingText="Connecting...">
  Connect
</Button>

// Icons — do NOT add className to the icon, Button handles sizing:
<Button variant="outline">
  <Icon />
</Button>
```

## Design Patterns

For provider/manager patterns (AI providers, storage, etc.), follow the existing implementations:

- **AI providers**: `packages/lib/src/ai/providers/provider-manager.ts`
- **File storage**: `packages/lib/src/files/storage/storage-manager.ts`

Pattern: Feature modules use a Manager class that lazily loads and caches provider instances, with a `Provider` interface defining `id`, optional `init()`, and `execute()`.

---

# Development Commands

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Lint (Biome) — errors only
pnpm lint

# Lint + fix all (including import sorting and warnings)
pnpm biome check --write .

# Generate DB migration (after schema changes)
pnpm db:generate --name <descriptive_name>

# Apply DB migrations
pnpm db:migrate
```

### Rules

- **Do NOT run `tsc` type checking.** Too many errors — it will run out of memory.
- **Do NOT build the program to check for errors.**
- **Do NOT stop the dev server.**
