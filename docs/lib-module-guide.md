# `packages/lib` Module Guide

How a feature module in `packages/lib/src/<feature>/` should be written.

`packages/lib` is ~110 modules deep and **mixed**: the newer ones are functional
Drizzle + `neverthrow`, the older ones are service classes holding `db` in a
constructor. This document names the modules that represent where we're going, so
new work has something concrete to copy instead of averaging over the whole
folder. The legacy shape is not a style preference we're still debating — it's
debt. Don't add to it.

---

## 1. The reference modules

Read these before writing a new module. In priority order:

| Module | Read it for |
| --- | --- |
| **`snippets/`** | The canonical small module. Start here. `guard.ts` + `snippet-queries.ts` / `snippet-mutations.ts` / `snippet-folder-mutations.ts` / `index.ts`. ~950 LOC, nothing clever. |
| **`sequences/`** | The canonical *large* module. 25 files split by verb (`crud`, `enroll`, `publish`, `steps`, `runs`, `sweep`, `suppression`, `reanchor`), plus `types.ts`, `client.ts`, `access.ts`. Shows how to grow past one file without growing a class. |
| **`dashboards/`** | Queries/mutations split where writes have two axes (identity vs. version content: `dashboard-mutations.ts` vs. `version-mutations.ts`), zod config schemas (`config-schemas.ts`), and a substantial client-safe surface (`client.ts`). |
| **`signals/`** | A module that owns background work: `retention-job.ts`, `rollup-sweep-job.ts`, `rollup.ts`, plus a `email/` subfolder for one cohesive concern. |
| **`approvals/`, `groups/`, `favorites/`** | Smaller supporting examples of the same shape. |

**Do not copy** (legacy service classes, kept working, not extended):
`notifications/notification-service.ts`, `inboxes/inbox-service.ts`,
`timeline/timeline-service.ts`, `tags/tag-service.ts`, `datasets/services/*`,
`messages/*.service.ts`, `kb/kb-service.ts`, `email/inbound/*.service.ts`.

---

## 2. Functions, not classes

Every exported unit of work is a plain `async function` whose first parameter is
`db`.

```ts
// packages/lib/src/snippets/snippet-mutations.ts
export async function createSnippet(
  db: Database,
  organizationId: string,
  userId: string,
  input: CreateSnippetInput
) { … }
```

Why this and not a service class:

- **No hidden `db`.** `notifications/notification-service.ts` does
  `constructor(private database = db)` over a module-level
  `import { database as db }`. That default silently binds every caller to the
  app-level pool — a worker, a transaction, or a test that wants to pass its own
  `tx` can't, and the import alone drags the connection into any bundle that
  touches the module.
- **No god objects.** `InboxService` has 20+ methods and two id conventions
  (`updateInbox(recordId)` *and* `updateInboxById(id)`) because a class makes
  adding a method cheaper than deciding where it belongs. Files force that
  decision.
- **Tree-shaking and testability.** `import { createSnippet }` pulls one
  function; `new TagService(orgId, userId, db)` pulls the whole surface plus its
  private helpers' dependencies.

**Legitimate class exceptions** (these are fine, and exist for a reason):

- `Error` subclasses — `RecallApiError`, `PermanentProcessingError`, everything in `errors.ts`.
- Provider adapters implementing a shared interface — `geo/providers/*`,
  `email/labels/*-label-provider.ts`, `realtime/providers/pusher.ts`. See the
  Manager pattern in `ai/providers/provider-manager.ts`.
- Primitives with genuine internal state — `utils/rate-limiter/token-bucket.ts`,
  `circuit-breaker.ts`, `priority-queue.ts`.
- Value objects whose behavior *is* the point — `CapabilitySet` /
  `AgentPolicyCapabilities` in `permissions/`.

If you're reaching for a class to avoid threading `db` and `organizationId`
through four calls, use a context object instead (§4).

---

## 3. Errors and results: `neverthrow`, and one `guard`

Two Result flavors exist in the repo. Use the right one:

| | Use |
| --- | --- |
| `neverthrow` — `Result<T, Error>`, `ok()`, `err()`, `.isErr()`, `.value` | **All new lib code.** |
| `@auxx/lib/result` — `TypedResult`, `Result.ok()`, `.ok`, `.value` | Legacy. Only `BaseModel` subclasses in `@auxx/database` still return it. Don't introduce it. |

Never throw `TRPCError` from lib — it's meaningless when the same function runs
in a worker or a seed script. Throw the matching `AuxxError` subclass from
`../errors`; `apps/web`'s `auxxErrorMiddleware` maps it to the right status.

Two working styles, both correct:

**A. Imperative body + a module `guard()`** — best when a function has several
early-exit business rules. `snippets/guard.ts` is the whole pattern in 31 lines:

```ts
// packages/lib/src/snippets/guard.ts
export async function guard<T>(
  fn: () => Promise<T>,
  logMessage: string,
  meta: Record<string, unknown> = {}
): Promise<Result<T, AuxxError>> {
  try {
    return ok(await fn())
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error(logMessage, { error, ...meta })
    return err(new AuxxError('Internal error'))
  }
}
```

Inside the body you just `throw new NotFoundError(...)` and read like normal
code; the wrapper converts. Copy this file into a new module — it's small enough
that duplicating it beats a shared abstraction, and it lets each module bind its
own `createScopedLogger` scope.

**B. Explicit `err()` returns** — best when the failure set is small and the
signature should document it. `sequences/crud.ts`:

```ts
export async function deleteSequence(
  db: Database,
  params: { sequenceId: string; organizationId: string }
): Promise<Result<void, Error>> {
  const sequence = await db.query.Sequence.findFirst({ … })
  if (!sequence) return err(new NotFoundError('Sequence not found'))
  if (sequence.templateKey) return err(new ForbiddenError("Built-in sequences can't be deleted"))
  …
  return ok(undefined)
}
```

Always annotate the return type as `Promise<Result<T, E>>` explicitly. Inference
works, but the annotation is what makes the failure mode visible at the call site.

---

## 4. Signatures

- `db: Database` first, always. Accept `Transaction` instead when the function is
  transaction-only (see `insertInstanceAccessBaseline` in `dashboards/dashboard-mutations.ts`).
- Then scope: `organizationId`, `userId`.
- Then one `input` / `params` object for everything else. Never more than ~4
  positional params.
- Once three or more functions in a file need the same ambient trio, define a
  context interface: `SequenceAccessContext`, `ResourceAccessContext`,
  `ChannelCtx`, `KBContext` are the precedents.

```ts
export interface SequenceAccessContext {
  db: Database
  organizationId: string
}
export async function grantSequenceCreatorAccess(
  ctx: SequenceAccessContext & { userId: string },
  sequenceId: string
): Promise<void>
```

### `files/` diverges: `ctx: FilesCtx` first, not `db`

`packages/lib/src/files/**` deliberately does **not** use the `db`-first
positional style above. Db-touching exports take `ctx: FilesCtx`
(`{ db, organizationId, userId }`) first, because nearly every function there
needs all three *plus* a bundle of injected collaborators (`FilesDeps`:
`storage`, `queue`, `cache`, `now`) that `snippets/`/`sequences/`/`dashboards/`
have no equivalent of — as positionals that is five arguments before the real
input. Transaction-only functions still take `tx: Transaction` positionally
first, separate from `ctx`, so a pool cannot typecheck into the slot. A function
that needs only some collaborators takes a `Pick<FilesDeps, …>` rather than the
whole bundle, so its signature still states what it cannot do
(`getAssetDownloadRef` in `files/assets/download.ts` is the worked example).
This is a scoped exception, not a repo-wide convention change. See
`packages/lib/src/files/ctx.ts` and `plans/attachments/02-target-module-shape.md` §2.1.

---

## 5. File layout

```
packages/lib/src/<feature>/
  index.ts                  server entrypoint — explicit named exports only
  client.ts                 client-safe constants/types/pure fns (see §7)
  types.ts                  entity aliases + input/output shapes
  guard.ts                  the neverthrow wrapper, if using style A
  <noun>-queries.ts         reads
  <noun>-mutations.ts       writes
  access.ts                 the ONLY file that touches resource-access
  <verb>.ts                 one file per verb once the module grows (sequences/)
  <thing>-job.ts            BullMQ-facing entrypoints (signals/)
  __tests__/*.test.ts       or co-located <file>.test.ts
```

Rules that actually bite:

- **`index.ts` uses explicit named exports**, never `export *`. Re-export types
  with `export type { … }` / inline `type` specifiers so they're erasable.
- **Split reads from writes.** A file that both queries and mutates is the first
  step back toward a service class.
- **`packages/lib/package.json`'s `exports` field is generated** —
  `pnpm --filter @auxx/lib generate:exports` scans consumer imports. Never
  hand-edit it. If a new subpath doesn't resolve, add the import in the consumer
  and regenerate.
- **Tests:** `__tests__/` for a group (majority of lib), co-located `*.test.ts`
  for a single-file unit. Either is accepted; don't mix both inside one module.

---

## 6. Access control does not live in lib

This is the rule most easily broken and hardest to unwind. Lib write/read
helpers carry **no permission checks**. The router asserts, then calls.

```ts
// apps/web/src/server/api/routers/snippet.ts
byId: capabilityProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
  assertSnippetAccess(ctx.capabilities, input.id, 'view')
  const result = await getSnippetWithShares(ctx.db, ctx.session.organizationId, ctx.session.userId, input.id)
  if (result.isErr()) throw result.error
  return { ...result.value, canEdit: ctx.capabilities.canEditInstance('snippet', input.id) }
}),
```

The only guards left inside lib are **identity/integrity** ones: org scope,
soft-delete, system-row immutability, FK ownership. `snippets/snippet-mutations.ts`
documents exactly this boundary at the top of the file — read that comment.

Two consequences:

- **List endpoints filter in SQL, not in memory.** The router computes an
  `InstanceListScope` from capabilities and hands it down; the module turns it
  into a `WHERE` fragment. See `scopeFilter()` in `snippets/snippet-queries.ts`.
  A post-read `.filter()` leaks counts and volume even when it hides content —
  which is what `listSnippetFoldersWithCounts` had to fix.
- **Sharing funnels through `resourceAccess.grantInstance`**, never a bespoke
  writer. A per-module share path re-implements the notification and audit
  behavior badly. A module's own `access.ts` is a *thin* wrapper over
  `grantInstanceAccess` / `hasPermission` (`sequences/access.ts`, 67 lines).

Current procedures in `apps/web/src/server/api/trpc.ts`: `publicProcedure`,
`protectedProcedure`, `capabilityProcedure`, `permissionProcedure(key)`,
`ownerProcedure`, `superAdminProcedure`. Most feature routers want
`capabilityProcedure`.

---

## 7. `client.ts`

Anything the UI needs — string unions, labels, zod-free constants, pure derive
functions — goes in `client.ts`, importing nothing server-only. Client code must
import `@auxx/lib/<feature>/client`, never the barrel; the barrel pulls bullmq,
sharp, and friends and breaks the build.

**No `'use client'` directive in `client.ts`.** Server code imports these files
too, and the directive turns every export into a client-reference proxy there.
`sequences/client.ts` carries that warning at the top for exactly this reason.

---

## 8. Transactions, cache, events

- Multi-row invariants go in one `db.transaction()`. A resource with
  `baselineAtCreate: true` **must** write its `ResourceAccess` baseline in the
  same transaction as the row — without it the creator can't see what they just
  created (`createSnippet`, `insertInstanceAccessBaseline` in dashboards).
- **Bust caches after the transaction commits**, never inside. Mid-transaction
  invalidation repopulates from a snapshot the commit hasn't reached yet — see
  the `emitResourceAccessInstanceChanged` placement in `createSnippet`.
- Read through `@auxx/lib/cache` (`getCachedResources`, `getCachedMembers`, …)
  before adding a query for anything in `OrgCacheDataMap`. A fresh query defeats
  invalidation.
- Realtime publishes always carry a composed `value`; a value-less entry is
  silently dropped.

---

## 9. Checklist for a new module

- [ ] Exported functions, `db` first, no class
- [ ] `Promise<Result<T, Error>>` from `neverthrow`, annotated explicitly
- [ ] `AuxxError` subclasses only — no `TRPCError`, no `@auxx/lib/result`
- [ ] Reads and writes in separate files
- [ ] `index.ts` explicit named exports; `client.ts` for anything the UI imports
- [ ] Zero permission checks; router asserts, list scope applied in SQL
- [ ] File-path comment on line 1 of every file
- [ ] JSDoc on every export explaining *why*, not *what*
- [ ] `pnpm --filter @auxx/lib generate:exports` after adding a consumed subpath
- [ ] `pnpm lint:fix`, then `cd packages/lib && NODE_OPTIONS="--max-old-space-size=8192" pnpm exec tsc --noEmit` (grep for your own files — there's a large pre-existing baseline)
