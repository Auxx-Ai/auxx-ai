// packages/lib/src/files/ctx.ts

/**
 * The ambient contract every `files/` function is written against.
 *
 * This file exists because `files/core/base-service.ts` bound its database at
 * construction (`constructor(orgId?, userId?, db = defaultDatabase())`), which
 * made it impossible to hand a function a transaction, a different pool, or a
 * stub. Everything below is the seam that replaced it — and as of PR Y that
 * class, and the four facades over it, are deleted.
 *
 * ## The three signature shapes
 *
 * Pick by what the function actually needs — the signature is the documentation.
 *
 * **1. Pure — no `ctx`, no `db`, no `deps`.**
 * ```ts
 * export function buildUploadConfig(
 *   handler: UploadHandler,
 *   init: UploadInitConfig,
 *   now: () => Date
 * ): UploadPreparedConfig
 * ```
 * Data in, data out. Roughly a third of the new surface. `now` is threaded in
 * rather than read from `Date.now()` so the function stays pure.
 *
 * **2. Database-touching — `fn(ctx: FilesCtx, ...)`.**
 * ```ts
 * export async function getAsset(
 *   ctx: FilesCtx,
 *   assetId: string
 * ): Promise<Result<MediaAssetEntity | null, AuxxError>>
 * ```
 * `ctx` carries `db` plus the org/user scope. A function that also needs to
 * enqueue a job or touch storage takes `deps: FilesDeps` as its second
 * parameter — the split is the point (see {@link FilesDeps}).
 *
 * **3. Transaction-only — `fn(tx: Transaction, ctx: FilesCtx, ...)`.**
 * ```ts
 * export async function createAssetVersion(
 *   tx: Transaction,
 *   ctx: FilesCtx,
 *   input: CreateVersionInput
 * ): Promise<MediaAssetVersionEntity>
 * ```
 * `tx` is positional and **first**, kept separate from `ctx`. This is not
 * stylistic: `FilesCtx.db` is `Database | Transaction`, so it cannot express
 * "must be inside a transaction" — a pool typechecks into it and the multi-row
 * invariant silently stops being atomic. A bare `Transaction` slot rejects a
 * pool at compile time.
 *
 * ## The rule that goes with shape 3
 *
 * A caller already inside a transaction passes `{ ...ctx, db: tx }` to every
 * nested `ctx`-taking read:
 *
 * ```ts
 * await db.transaction(async (tx) => {
 *   const txCtx = { ...ctx, db: tx }
 *   const asset = await getAsset(txCtx, assetId)   // sees uncommitted rows
 *   await createAssetVersion(tx, txCtx, input)
 * })
 * ```
 *
 * Reusing the outer `ctx` inside the body reintroduces exactly the stale-read
 * bug this refactor exists to kill: a collaborator bound to the app pool cannot
 * see rows the open transaction has written but not committed.
 *
 * ## Where the `Result` boundary sits
 *
 * Exported functions return `Promise<Result<T, AuxxError>>` via the module-local
 * {@link ../files/guard.guard | guard}. Internal helpers throw. Only
 * `AuxxError` subclasses, never bare `Error` and never `TRPCError`.
 */

import type { Database, Transaction } from '@auxx/database'
import type { CachePort, QueuePort, StoragePort } from './storage/ports'

/**
 * Ambient scope every db-touching `files/` function needs.
 *
 * `db` is typed `Database | Transaction` so the same function body works on a
 * pool and inside a transaction without a runtime `getTx()` guess. It is never
 * optional and never defaulted — a defaulted `db` is what bound all ~124
 * `BaseService` construction sites to the app pool.
 *
 * Routers build this in one line from what tRPC already hands them:
 * `{ db: ctx.db, organizationId: ctx.session.organizationId }`.
 *
 * ## There is deliberately no `userId` here
 *
 * An earlier draft carried `userId: string`. Both Phase-2 pilots — one read
 * (`assets/download.ts`) and one write (`storage/locations.ts`) — independently
 * reported the same failure: neither needed an actor, so both facades had to
 * fabricate `''` to satisfy the type. Lib performs **zero access checks**
 * (`docs/lib-module-guide.md` §6), so `ctx.userId` has no reader on a read path,
 * and many legitimate construction sites have no actor at all
 * (`new MediaAssetService(orgId)` in `file-context-service.ts`,
 * `document-service.ts`, `document-processor.ts`; `(orgId, undefined)` in
 * `message-sender.service.ts`, `resolve-cover-urls.ts`, and
 * `apps/api/src/routes/chat/attachments.ts`).
 *
 * Making it `userId?: string` would only move the sentinel: an optional field
 * invites `ctx.userId!` or `ctx.userId ?? ''`, and one of those eventually
 * reaches a NOT NULL `createdById`.
 *
 * So: **a function that records an actor takes it in its own `input`, where it
 * is required and unmissable.** `createAssetWithVersion(tx, ctx, { createdById,
 * … })`, not `ctx.userId`. Attribution then appears in the signature of exactly
 * the functions that attribute, and nowhere else.
 */
export interface FilesCtx {
  db: Database | Transaction
  organizationId: string
}

/**
 * Side-effecting collaborators, injected rather than constructed.
 *
 * Kept as a **separate object from {@link FilesCtx}** on purpose: a read that
 * only touches the database takes `ctx` alone, and its signature then says it
 * *cannot* write to S3, enqueue a job, or bust a cache. Merging the two would
 * throw that guarantee away for one fewer parameter.
 *
 * An injectable `db` alone does not make this module testable — a function that
 * still does `new ThumbnailService(...)` or `getQueue(Queues.thumbnailQueue)`
 * internally is just as welded to its collaborators as before. These four
 * fields are that escape hatch, and their test doubles are plain objects, so no
 * `vi.mock` is involved on either side.
 *
 * `now` is here because `deriveStorageKey` and every `expiresAt` computation
 * call `Date.now()` directly today, which makes them untestable without fake
 * timers leaking into unrelated assertions.
 */
export interface FilesDeps {
  storage: StoragePort
  queue: QueuePort
  cache: CachePort
  now: () => Date
}

/**
 * **Take a narrowed slice of {@link FilesDeps}, not the whole bundle.**
 *
 * Established by the Phase-2 read pilot. `getAssetDownloadRef` needs only
 * `storage`, so it declares `deps: Pick<FilesDeps, 'storage'>`. A full
 * `FilesDeps` parameter would *lie* — it says the function may enqueue a job or
 * bust a cache — and it has a production cost: every caller of a pure read would
 * have to construct a `QueuePort`, binding a live Redis connection, just to
 * presign a URL.
 *
 * A real `FilesDeps` still passes structurally, so callers are unaffected, while
 * the signature enumerates exactly what the function is allowed to do. Widen the
 * `Pick` per function; never reach for the bundle as a shortcut.
 *
 * The rejected alternative was `opts.storage?: StoragePort` defaulting to
 * `createS3StoragePort(...)`. That is the same defaulting this phase exists to
 * delete: `BaseService`'s `db = defaultDatabase()` was *also* "trivially
 * overridable", and all ~124 call sites still bound to the app pool. A test that
 * forgets to pass a port must fail loudly, not silently reach real config.
 */
export type FilesDepsSlice<K extends keyof FilesDeps> = Pick<FilesDeps, K>

export type { CachePort, QueuePort, StoragePort } from './storage/ports'
