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

## Files, Uploads & Storage

**Before touching the upload routes, the upload handler records, `StorageManager`,
the adapters, `MediaAsset`/`FolderFile`/`Attachment`/`StorageLocation`, the
thumbnail or cleanup jobs, or the front-end uploader, read
`docs/files-upload-architecture-guide.md`.** It documents the three-round-trip
presigned browser flow, the `EntityType` → handler dispatch, the five tables a
file actually occupies, the two parallel upload doors that bypass the main path,
and the read paths. §11 records what was fixed and when; **§12 is what is still
open** — read that before assuming a sharp edge has been dealt with.

Short version: a file is **`StorageLocation` (the bytes) + `MediaAsset`+version
or `FolderFile`+version + optionally an `Attachment`** — which combination you
get is decided by the `EntityType` the client sends, and picking the wrong one
silently produces the wrong record; **`bucket` is never optional** anywhere in
the storage layer, because S3 answers **204** for deleting a key that is not in
the bucket you named, so a wrong bucket leaks objects with no error (this caused
three separate production bugs); `MediaAsset` and `FolderFile` are different
tables and the legacy **`File` table is empty and unused** — joining it is a
silent no-op that once made the storage quota read zero forever; and post-commit
work (thumbnails, cache busts) must be enqueued **after** `COMMIT`, never from
inside the persist step, because the enqueue resolves its source on a different
connection and cannot see uncommitted rows.

**New code in `packages/lib/src/files/**` uses the functional contract in
`packages/lib/src/files/ctx.ts`** — `ctx: FilesCtx` first for db-touching
functions, `tx: Transaction` positional-first for transaction-only ones, a
narrowed `Pick<FilesDeps, …>` for collaborators, and never a service class.
`assets/`, `folder-files/`, `folders/`, `filesystem/`, `thumbnails/` and
`upload/` are all written this way; the test doubles in `files/__tests__/support/`
mean a new test needs **zero `vi.mock`**. `folders/tree.ts` is the model for pure
logic — 113 tests, no doubles of any kind. Upload dispatch is a declarative
record per `EntityType` in `upload/handlers/`, not a class hierarchy: the
`BaseProcessor` chain, `ProcessorRegistry`, `FilesystemService` and
`ThumbnailService` were all deleted. The remaining service classes in
`files/core/` are `@deprecated` facades with a scheduled deletion; do not add
call sites to them. History and the open items are in `plans/attachments/`
(untracked).

## Inventory, Purchasing & Costing

**Before touching purchase orders, vendor bills, the three-way match, receiving,
`stock_movement`, builds, standard cost, QoH, or GL postings, read
`docs/inventory-costing-architecture-guide.md`.** It documents the thirteen
entities this subsystem adds (all `EntityInstance`-backed — **no new Drizzle
tables**), the buy→receive→bill→match path, the costing model and where each
number comes from, the movement writers and their doors, the L1/L3 posting
regimes, and §12's list of places the plans and the code currently disagree.

Short version: the movement ledger is **append-only** (`updatable: false`
everywhere) and a mistake is corrected by **reversing**, never editing; cost is
**frozen onto the movement at write time** and a standard-cost change revalues
on-hand inventory to 5090 rather than restating history — so `part_cost` (live
replacement cost, rewritten on every vendor-price change) must never value a
movement; `part_quantity_on_hand` is a **full re-SUM of the ledger** that only
`recalculatePartQoH` may write, which is also why FIFO and lot *costing* are
ruled out; the match's variance must use `quantityReceived × unitPriceExpected`
or an over-billed quantity nets out against an under-billed price to zero;
receiving part-first sets no `purchaseOrderLineId`, so it moves QoH and leaves
the match with no receipt leg; a bill's totals are **transcribed, never
computed**, because recomputing them silently corrects the vendor's arithmetic;
`skipEvents` is insufficient for a silent ledger write (use `quietSession`, and
remember a quiet lane also silences the QoH recalc); and **a balance assertion
and per-event postings may never both drive 1310/1320/1330** — L1 or L3, never
both. Status and open work live in `plans/money/` (untracked).

## Workflows

**Before touching node schemas, output variables, the engine's
preprocess/execute contract, draft mutations, or anything Kopilot does to a
workflow graph, read `docs/core-workflow-architecture-guide.md`.** It documents
the four layers (catalog / engine / `graph-edit` / Kopilot builder capability),
the `NodeManifest` contract and the per-node migration pattern, output
resolution's one-contract-two-orchestrations design, the eight draft mutations
behind `runGraphMutation`, and the parity harness that keeps builder and engine
honest.

Short version: a node's **data** contract lives in `catalog/nodes/<type>.ts` and
its **React** stays in web (zero-diff panels is enforced by review);
`defaultData` must parse its own `configSchema`; `NOT_YET_MIGRATED` and the
`NodeType` enum are coupled by an exact-set-equality test, so migrating or
retiring a type is always one atomic change; catalog modules that touch the org
cache get a **leaf subpath** export and must never go through `client.ts` or the
`workflow-engine` index barrel; `persistDraft` is the single write seam and
every write carries `expectedGraphHash` for CAS; and output handles are what
`node.tsx` renders, never what a manifest declares.

*(`docs/workflow-architecture-guide.md` is a different subsystem — third-party
workflow blocks contributed by installed apps.)*

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

**Typechecking is cheap — run it freely, but ONLY via the package script.**

```bash
pnpm --filter @auxx/lib typecheck      # ~4s   (3,846 files)
pnpm --filter @auxx/web typecheck      # ~10s  (~3.5k files)
pnpm --filter @auxx/database typecheck

# Cached + parallel across packages, keyed on upstream results.
# Repeat runs are ~0.5s; editing an upstream package correctly re-runs dependents.
pnpm exec turbo run typecheck --filter=@auxx/lib
```

**Never run a bare `pnpm exec tsc` / `npx tsc`.** This repo has **two**
TypeScript packages installed — `typescript` and `typescript7`
(`npm:typescript@7.0.2`, the native Go compiler) — and `pnpm exec tsc` resolves
to a *different one per package*:

| from | `pnpm exec tsc` gives |
| --- | --- |
| `packages/lib` | 7.0.2 (native, fast) |
| `apps/web` | **5.9.2** (legacy JS) |

So `cd apps/web && pnpm exec tsc --noEmit` runs the old compiler, spends ~50s
climbing to V8's 4GB heap ceiling and dies with an allocation failure — while
`pnpm --filter @auxx/web typecheck` (which calls `typescript7` explicitly)
finishes in ~10s. That OOM is the *only* reason `NODE_OPTIONS=--max-old-space-size`
ever appeared in this file; with the package script it is unnecessary.

Two more traps:

- **`tsc` exits non-zero for reasons other than type errors** (a bad invocation
  prints `--help` and exits 1). Never judge a run by a `grep`ped line count, and
  never pipe it — in a pipeline `$?` is grep's status, so a crash reads as a
  pass. Check the exit code, then read the `error TS` lines.
- **16 packages/apps have no `typecheck` script at all**, including
  `@auxx/worker`, `@auxx/services`, `@auxx/seed`, `@auxx/types` and `@auxx/sdk`,
  so a green `turbo run typecheck` is not whole-repo coverage.

`packages/lib` and `apps/web` carry pre-existing errors, so "clean" is not the
bar — `scripts/ci/typecheck-ratchet.js` enforces "adds none" against
`scripts/ci/typecheck-baseline.json`. Use `node scripts/ci/typecheck-ratchet.js
--package lib` when you want the same answer CI will give.

### Testing

The suite's cost is almost entirely **per-file boot**, not the tests. In
`packages/lib` the 960 test files sum to ~66s of actual execution, but a full
run takes **~150s**: each isolated file re-imports the whole module graph
(`vitest.alias.ts` points every `@auxx/*` at source), so summed import time is
~1900s against ~66s of tests — a 29:1 ratio.

**So: scope test runs to the module you touched while iterating, and run the
full package suite once before opening the PR.**

```bash
cd packages/lib
pnpm exec vitest run src/field-values     # ~13s, 339 tests
pnpm exec vitest run                      # ~150s — pre-PR only
```

- `vitest related <files>` does **not** help here. Widely-imported modules
  (e.g. `field-values/client.ts`) reach half the package, so it selects 530 of
  960 files and saves nothing. Pass a directory instead.
- `--pool=threads` buys ~11%. Not worth changing.
- `--no-isolate` would cut the full run to ~77s, but ~232 files currently fail
  under it from state leaking between files in a shared worker. See
  `plans/test-speed/` (untracked).

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
