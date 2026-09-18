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
  Manager pattern in `ai/providers/provider-registry.ts`.
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
early-exit business rules. Create a scoped guard from the factory in `utils/guard.ts`:

```ts
// packages/lib/src/snippets/snippet-mutations.ts
import { createGuard } from '../utils/guard'

const guard = createGuard('snippets')

// Inside a function:
return guard(
  async () => { … throw new NotFoundError(…) … },
  'Failed to create snippet',
  { snippetId }
)
```

Inside the body you just `throw new NotFoundError(...)` and read like normal
code; the wrapper converts. Each module binds its own `createScopedLogger` scope
so a refused operation is greppable per module.

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
  __tests__/*.test.ts       tests, always here
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
- **Tests live in `__tests__/`, always.** Co-located `*.test.ts` used to be
  allowed for a single-file unit; it isn't any more. A moved test's relative
  imports go from `./x` to `../x`, which is the whole diff.
- **`client.ts` is the client's only door.** Anything the browser imports comes
  from `@auxx/lib/<module>/client`; the barrel pulls bullmq, sharp and friends.
  A constant the UI needs that only exists server-side goes into `client.ts`
  first, and the server imports it from there too (§7).

### 5.1 A module with parents: `accounting/` and `inventory/`

Two directories are containers rather than modules, and neither has an
`index.ts` — you import a child:

```
packages/lib/src/
  accounting/
    ledger/      the books: chart/, roles/, builders/, post/, periods/, reads/, setup/
    reports/     trial balance, P&L, balance sheet, GL, aging, 1099, pdf/
    journals/    entries/ and recurring/
    opening/     opening trial balance, baseline, fill plan
    export/      export batches, payloads/, send, retry, rollback, sweep
    mirror/      the inbound copy of the provider's ledger
    providers/   the AccountingProvider seam, book connections, quickbooks/
    rails/       payment rails, rail accounts, rail fee status
    money/       MoneyTransaction/MoneyApplication, invoice payments, deposits, payouts, checkout
    banking/     feed/, import/, review/, rules/
  inventory/
    movements/   the stock_movement writer, reversal, movement cost fields
    costing/     part cost, vendor cost, standard cost, QoH
    receiving/   receive PO, receive stock, adjust, opening stock
    builds/      the make side
    relief/      sale movements on fulfillment
    bom/         subpart graph
    tariffs/     HTS, 301, tariff starters and schedules
  sales/         quotes, orders, fulfillments, invoice issuance, credit memos, billing, totals
  purchasing/    POs, the three-way match, bills, both intake lanes
  returns/       returns, salvage, evidence pack, intake
  documents/     PDF rendering
```

Three rules come with that shape:

- **A subfolder keeps the barrel it already has; a new subfolder gets none
  unless a consumer needs the subpath.** Around thirty subfolder `index.ts`
  files exist under `accounting/` and they stay. But
  `accounting/money/invoice-payments` and `sales/quotes|invoices|billing|totals`
  have none, because nothing imports them as a unit — a subfolder is a filing
  decision first, and an export surface only when something asks for one. A
  consumer that wants one slice imports the deeper subpath
  (`@auxx/lib/purchasing/bill-intake/client`), which `generate:exports` picks up
  for free.
- **Cut by what the record is, not by which table a function writes.** An
  invoice's issuance and lifecycle are `sales/invoices`; recording a payment
  against it writes a `MoneyTransaction`, so it is `accounting/money`.
- **Direction.** `sales`, `purchasing`, `returns` → `accounting/*` and
  `inventory/*`; `accounting/{money,banking,rails}` → `accounting/ledger`;
  `inventory/*` → `accounting/ledger` to post, and never the reverse except the
  back-edges listed in `docs/accounting-architecture-guide.md` §2.2. Adding a
  new one is a design decision, not a refactor.

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
- **A module that owns a table exports a `db`-first read and write for it, and the
  first caller that cannot use the export widens the export rather than writing the
  query.** `audit-log/record-audit.ts`'s `recordAudit(input, db?)` — the second
  argument defaulting to the global `database` — is the write case: a caller inside a
  transaction can now commit the audit row atomically instead of a hand-typed
  `insert(schema.AuditLog)`. `connections/credential-reads.ts`'s `readAppCredential` /
  `listAppCredentials` is the read case: `listAppCredentials`'s filter grew an
  `appInstallationId` option for the one caller that had an installation, not an app
  slug, rather than that caller joining `Credential` itself. `scripts/ci/raw-query-ratchet.js`
  enforces both tables; see plans/accounting/LIB-LAYOUT.md §3c.
- **Read a system record through `resources/system-records/`, not by hand.**
  `systemFields` / `requireSystemFields` resolve the def and its fields once
  (with the transaction-snapshot fallback); `readSystemRecords` returns instances
  plus typed cells in two chunked queries, filtered by `ids` or by a parent
  through a relationship field (`by: { attribute, in }`). `systemValueJoin` is
  the alias join for filtering on a value in SQL. The attribute list comes from
  the registry — `pickSystemAttributes(PAYMENT_GATEWAY_FIELDS, ['payment_gateway_handle'] as const)`
  — never a second hand-typed `as const` array.

  ```ts
  const ctx = await requireSystemFields(db, orgId, 'payment_gateway', GATEWAY_PICK)
  const rows = await readSystemRecords(db, orgId, ctx, { ids })
  rows[0].text('payment_gateway_handle')
  ```

  🛑 **Pick, do not pass the whole map.** `systemAttributes(FIELDS)` includes a
  has-many INVERSE relationship field where one exists (`payment_gateway_payouts`),
  and handing that to `readSystemRecords` fetches one `FieldValue` row per child
  per parent. `pickSystemAttributes` also refuses a `dbColumn`-backed attribute at
  compile time, because those are columns on `EntityInstance` and no `FieldValue`
  query can return them. Raw `FieldValue` selects stay legitimate for aggregates,
  value-keyed lookups and the cost writers.
- **Settings: the cached path is the default.** `readOrganizationSettings(orgId, keys, db?)`
  (`settings/read.ts`) reads many keys at once, typed per key from the catalog;
  `getOrganizationSetting(key)` is sugar over it. Pass `db` only for a
  write-after-read consistency guarantee — either the same transaction wrote the
  setting earlier, or the value must be read as committed by *another*
  transaction and the caller must fail closed on it (the period lock read in
  `accounting/ledger/post/post-entry.ts`, the audit `previousState` in
  `accounting/ledger/periods/set-locked-through.ts`). Passing `db` because the
  surrounding function has one in scope turns one memoized cache hit into one
  `SELECT` per key. `getAllOrganizationSettings` is for the cache provider, the
  settings screen, and the few readers that need a whole scope or prefix, which
  a keyed reader cannot express.

---

## 9. Checklist for a new module

- [ ] Exported functions, `db` first, no class
- [ ] `Promise<Result<T, Error>>` from `neverthrow`, annotated explicitly
- [ ] `AuxxError` subclasses only — no `TRPCError`, no `@auxx/lib/result`
- [ ] Reads and writes in separate files; tests in `__tests__/`
- [ ] `index.ts` explicit named exports; `client.ts` for anything the UI imports
- [ ] Zero permission checks; router asserts, list scope applied in SQL
- [ ] File-path comment on line 1 of every file
- [ ] JSDoc on every export explaining *why*, not *what*
- [ ] `pnpm --filter @auxx/lib generate:exports` after adding a consumed subpath
- [ ] `pnpm lint:fix`, then `node scripts/ci/typecheck-ratchet.js --package lib` (never a bare `pnpm exec tsc` — there are two TypeScript packages installed and it resolves to a different one per package; see CLAUDE.md)
