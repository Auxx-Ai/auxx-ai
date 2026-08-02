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
- **Linting**: Biome (2-space indent, 100-char line width, single quotes). Prefer `pnpm lint:fix` to auto-fix lint issues after making changes.
- **Build**: Turborepo, pnpm
- **Infra**: AWS (SST), Docker

## Monorepo Structure

### Apps

| App             | Port | Purpose                   |
| --------------- | ---- | ------------------------- |
| `apps/web`      | 3000 | Main Next.js application  |
| `apps/api`      | 3007 | Express REST API          |
| `apps/worker`   | 3005 | Job/queue worker (BullMQ) |
| `apps/lambda`   | 3008 | AWS Lambda handlers       |
| `apps/build`    | 3006 | Build-time utilities      |
| `apps/homepage` | 3001 | Marketing site            |
| `apps/kb`       | 3002 | Knowledge base            |
| `apps/docs`     | 3004 | Documentation             |

### Key Packages

| Package             | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `@auxx/database`    | Drizzle schema, models, migrations          |
| `@auxx/lib`         | Shared business logic (~70 feature modules) |
| `@auxx/ui`          | Shadcn component library                    |
| `@auxx/types`       | Shared TypeScript types                     |
| `@auxx/services`    | Business service layer                      |
| `@auxx/config`      | Configuration management                    |
| `@auxx/credentials` | Credential/secret management                |
| `@auxx/redis`       | Redis client wrapper                        |
| `@auxx/email`       | Email service (Mailgun, SES, SMTP)          |
| `@auxx/billing`     | Stripe integration                          |
| `@auxx/sdk`         | Public SDK                                  |
| `@auxx/seed`        | Database seeding (CLI + domain seeders)      |

### Package Dependency Rules

**CRITICAL**: Only import from packages listed as dependencies in the importing package's `package.json`. Node.js resolves packages relative to the **importing file**, not the app entry point. A dynamic `import('@auxx/foo')` inside `@auxx/lib` will fail if `@auxx/lib/package.json` doesn't list `@auxx/foo` — even if the calling app has it.

**Dependency tiers** (higher tiers can import lower, never the reverse):

```
Tier 0 (leaf):  config, logger, deployment, typescript-config
Tier 1 (infra): database, redis, credentials, utils, types
Tier 2 (core):  services, email, billing, workflow-nodes
Tier 3 (biz):   lib  (imports tier 0–2, NEVER seed)
Tier 4 (seed):  seed (imports lib + database, NEVER imported by lib)
Tier 5 (apps):  web, worker, api, lambda, build (can import anything)
```

**Key constraint**: `@auxx/seed` ↔ `@auxx/lib` is a **one-way dependency** (`seed → lib`). Code in `@auxx/lib` must NEVER import from `@auxx/seed`. If lib code needs seed functionality, either:
1. Move the logic into lib itself, or
2. Define an interface/stub in lib and implement it in the app layer (worker/web) where both are available

### Key Paths

| What                    | Where                              |
| ----------------------- | ---------------------------------- |
| Next.js app routes      | `apps/web/src/app/`                |
| tRPC routers            | `apps/web/src/server/api/routers/` |
| tRPC root router        | `apps/web/src/server/api/root.ts`  |
| tRPC setup & middleware | `apps/web/src/server/api/trpc.ts`  |
| Auth config             | `apps/web/src/auth/server.ts`      |
| DB schema files         | `packages/database/src/db/schema/` |
| DB models               | `packages/database/src/db/models/` |
| Shared lib modules      | `packages/lib/src/`                |
| UI components           | `packages/ui/src/components/`      |
| Infrastructure (SST)    | `infra/`                           |
| CI/CD workflows         | `.github/workflows/`               |
| Environment template    | `.env.example`                     |

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

## Import Subpaths

Before writing an import, check the target package's `package.json` `exports` field to confirm the subpath exists. Do not guess import paths — e.g. `@auxx/lib/permissions/types` won't work if only `@auxx/lib/permissions` is exported. When in doubt, check what existing code in the same file or router imports.

## Component Architecture

- File naming: kebab-case (e.g., `user-profile.tsx`)
- Component naming: PascalCase (e.g., `UserProfile`)
- Add `'use client'` directive for any components using client-side hooks or state
- Split components when: file exceeds 800 lines, UI is reused, or it has a clear single responsibility

## API & Data Handling

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

| Class                      | Status | Use for            |
| -------------------------- | ------ | ------------------ |
| `BadRequestError`          | 400    | Invalid input      |
| `UnauthorizedError`        | 401    | Not authenticated  |
| `ForbiddenError`           | 403    | Not authorized     |
| `NotFoundError`            | 404    | Resource not found |
| `ConflictError`            | 409    | Duplicate/conflict |
| `UnprocessableEntityError` | 422    | Validation failure |
| `RateLimitError`           | 429    | Too many requests  |

**Service/lib code throws `AuxxError`, never `TRPCError`.** `@auxx/lib` (and any non-router service code)
must not import `@trpc/server` just to throw — a `TRPCError` is meaningless when the same function is
called from a worker, seed script, or another lib module. Throw the matching `AuxxError` subclass instead;
`apps/web`'s `auxxErrorMiddleware` + `errorFormatter` map it to the correct HTTP status automatically. If a
router wraps a service call in its own `try/catch`, guard rethrows with `isAuxxError(e)` (exported from
`~/server/api/trpc`), **not** `e instanceof TRPCError`, or the AuxxError gets flattened into a generic 500.

### Result Pattern (`@auxx/lib/result`) — LEGACY

New lib code returns `neverthrow` `Result<T, Error>`. See `docs/lib-module-guide.md`.
`TypedResult` below is only what existing `BaseModel` subclasses still return — don't
introduce it in new code.

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

## Org Cache (read-path first)

Before adding a new DB query for org-scoped data, check `@auxx/lib/cache`. Most hot read paths are already cached per-org and hydrated by providers — re-querying defeats invalidation and wastes a roundtrip.

```typescript
import {
  getCachedResource, getCachedResources, getCachedResourceFields,
  getCachedCustomFields, getCachedFieldMap, getCachedEntityDefId,
  getCachedMembers, isOrgMember, getCachedGroups,
  getCachedAgents, getCachedAgentById, getCachedDefaultModel,
  getOrgCache, // for keys without a helper
} from '@auxx/lib/cache'
```

Cached keys (`OrgCacheDataMap`): `entityDefs`, `entityDefSlugs`, `systemUser`, `channelProviders`, `members`, `memberRoleMap`, `features`, `subscription`, `orgProfile`, `resources`, `customFields`, `groups`, `agents`, `inboxes`, `channels`, `overages`, `orgSettings`, `installedApps`, `workflowApps`, `aiProviderConfigs`, `aiCredentials`, `aiDefaultModels`. For anything in this list, prefer `getOrgCache().get(orgId, '<key>')` over a fresh query. Only hit the DB when the data isn't cached or you need a write-after-read consistency guarantee.

## `packages/lib` Feature Modules

**Before adding or extending a module in `packages/lib/src/<feature>/`, read
`docs/lib-module-guide.md`.** `packages/lib` is mixed — newer modules are
functional Drizzle + `neverthrow`, older ones are service classes with `db` in a
constructor. The guide names the reference modules to copy (`snippets/` for small,
`sequences/` for large, `dashboards/`, `signals/`) and the legacy ones not to,
plus the rules on signatures, file layout, `client.ts`, and why permission checks
never live in lib.

Short version: exported `async function`s with `db` first (no service classes),
`Promise<Result<T, Error>>` from `neverthrow`, `AuxxError` subclasses only,
reads and writes in separate files, explicit named exports, and zero access
checks in lib — the router asserts and list scopes are applied in SQL.

## Agents, Procedures & Evals

**Before touching an agent's persona, toolsets, knowledge scope, triggers,
permissions, procedures, or evals, read `docs/agents-architecture-guide.md`.**
It documents the draft-row-vs-`AgentVersion` model (the `Agent` row IS the
draft — there is no `draftVersionId`), the versioned six behavior fields, the
prompt-section registry and its stability tiers, the compiled procedure step
tree + selection/stepper contract, the tool filter chain through
`buildEffectiveAgentRuntime`, the published permission policy and its
`policy ∩ run-as ∩ invoker` run-time intersection, and the eval
case/run/suite model.

Short version: behavior and authorization are versioned together and always
resolved from the same view (`active` vs `draft` — never mixed); production
never reads the mutable draft row or the live permission profile; procedure
frames pin a `procedureVersionId` for the whole run; `buildEffectiveAgentRuntime`
is the single construction site for production, builder, chat, and eval
runtimes. `docs/kopilot-architecture-guide.md` covers the engine underneath.

## Channels & Mail

**Before touching channels, inboxes, threads/messages, mail sync, or anything
that reads mail, read `docs/channels-mail-architecture-guide.md`.** It documents
that a "channel" IS the `Integration` row (there is no `Channel` table), the
three inbound doors (webhook push, two-phase polling, SES forwarding) and how
they converge on one ingest path, the thread-resolution ladder, the outbound
composer→sender→reconciler path, and the four-rung **mail lens**.

Short version: an inbox is an `EntityInstance` on either the `inbox` (shared) or
`personal_inbox` def, and one channel links to exactly one inbox; visibility is
`none < metadata < identity < read` derived per viewer — **never gate mail on
admin rank**; every list path must apply `buildMailVisibilityPredicate`, and its
answer must match `getThreadLens`'s for the same thread; channel manage-authority
is per-channel (`requireChannelManageAccess`), not the coarse `channelsManage`
key; ingest must never throw and disconnect is a soft delete, so every channel
query needs `isNull(Integration.deletedAt)`.

## Mail Suggestions & Unsubscribe

**Before touching mined mail suggestions, the bulk-sender columns derived at
ingest, proposed filter conditions, or unsubscribe, read
`docs/mail-suggestions-architecture-guide.md`.** It documents the two producers
(seeded `templateKey` starters vs mined, evidence-carrying `MailSuggestion`
rows), the `list:`/`domain:` **`subjectKey` keyspace defined once** in
`mail-suggestions/client.ts`, the weekly miner's thresholds and four suppression
rules, and the three unsubscribe tiers with their safety gate.

Short version: `proposedConditions` are validated with
`assertFilterConditionsCompile` **when the job writes the row**, because an
all-dropped condition set reduces to the bare org scope and matches every thread
in the inbox; unsubscribe is a one-shot command, never a `MailFilterAction`, is
gated on inbox write alone (not `automationRules.manage`), treats
`senderAuthenticated IS NULL` as *not* authenticated, and must never be recorded
as `contact:unsubscribed`; dismissal is a status write, never a delete.

## Database Models — LEGACY

Existing models extend `BaseModel`. Do NOT add new model classes; put query code
in `packages/lib` as functions (see above).

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
- After modifying schema files, generate the migration from the `packages/database` folder: `pnpm db:generate --name <descriptive_name>`. From root, use `pnpm db:generate -- --name <descriptive_name>`.
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

**Before building a settings page, detail page, dialog, or tree list, read
`docs/ui-design-guide.md`.** It documents the shared layout/form/dialog/tree
primitives (`MainPage`, `NavStack`, `SettingsPage`/`SettingsSection`, `ListCard`
placeholders, `FieldPanel`/`FieldPanelRow`/`FieldInputAdapter`, `DialogNav`/
`DialogNavPages`, `TreeRow`/`TreeRowButton`) with real usage examples — this is
what keeps AI-generated UI consistent instead of each screen reinventing its
own card/dialog/form shape.

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

# Development Workflow

## Context7

IMPORTANT: Use Context7 for code generation, setup or configuration steps, or library/API documentation. Automatically use the Context7 MCP tools to resolve library IDs and get library docs without waiting for explicit requests.

---

# Development Commands

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Lint (Biome) — full repo, errors only (CI uses this on pushes to main)
pnpm lint

# Lint changed files only vs main branch — errors only (CI uses this on PRs)
pnpm lint:changed

# Lint + auto-fix (writes changes, includes import sorting)
pnpm lint:fix

# Format only (writes changes)
pnpm format

# Generate DB migration (after schema changes)
pnpm db:generate --name <descriptive_name>

# Apply DB migrations
pnpm db:migrate

# Run standalone scripts (uses dotenv-cli to load .env with multiline values)
npx dotenv -- npx tsx path/to/script.ts
```

### Type Checking (`tsc`)

Every package/app has a scoped `typecheck` script (`tsc --noEmit` run from that
package's own directory against its own `tsconfig.json`, via `composite: true`
project references). Run it **per package**, never as a bare `tsc`/`tsc -b`
from the repo root — there is no root `tsconfig.json`, and a whole-monorepo
invocation walks every package's sources in one process.

```bash
# Scope to one package (fast, low memory — most packages finish in seconds)
pnpm --filter @auxx/utils typecheck
pnpm --filter @auxx/database typecheck

# apps/web and packages/lib are large enough to hit V8's default ~4GB
# old-space heap limit even when scoped to just that package. Bump it:
cd apps/web && NODE_OPTIONS="--max-old-space-size=8192" pnpm exec tsc --noEmit
cd packages/lib && NODE_OPTIONS="--max-old-space-size=8192" pnpm exec tsc --noEmit
```

The OOM was never about total errors or physical memory — it's Node/V8's
default heap ceiling, hit while checking apps/web's ~3.5k files (or lib's
~2.6k) in a single process. Scoping to a package keeps most invocations well
under the limit; for web/lib, raising `--max-old-space-size` is enough (~6GB
peak observed for web).

### Rules

- **Do NOT run a whole-repo `tsc`.** Scope it per-package as shown above.
- **Never `kill` a single `turbo dev` task.** Turbo treats a dying persistent
  task as fatal and tears down the whole run (`ELIFECYCLE` cascading across
  every package). To run one app, restart with
  `pnpm exec turbo dev --filter=@auxx/web`.

---

# Viewing Logs (dev)

`@auxx/logger` prints to the console AND ships structured logs to a local **OpenObserve** instance that `pnpm dev` starts automatically (dev-only). Use it to search/review log history instead of scrolling the terminal.

- **UI**: http://localhost:5080 → _Logs_ → stream `auxx`
- **Login**: `root@auxx.dev` / `Complexpass#123` (local dev only — not a secret)
- Every entry has `level`, `scope`, `app` (`@auxx/web` / `@auxx/worker` / …), `message`, plus any `.with({...})` fields. Filter with SQL, e.g. `level='error'`, `scope='billing'`, `app='@auxx/worker'`, or full-text `match_all('stripe')`.
- Querying the API directly (Basic auth): `POST http://localhost:5080/api/default/_search?type=logs` with a SQL body.

Full details (how it works, turning it off): `docs/log-history.md`.

---

# Ops Reference (Railway, AWS)

For Railway (production) and AWS (dev) commands — log tailing, service status, RDS, ECS — read `docs/ops-reference.md`. Pull it in when the user asks about deploys, prod logs, or infrastructure debugging.
