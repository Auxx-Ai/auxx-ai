// apps/web/src/server/lib/files-ctx.ts

/**
 * The one place a `FilesCtx` is built in `apps/web`.
 *
 * Phase 5's exit criteria (`plans/attachments/05-core-services.md`) name this
 * explicitly: *"a single `toFilesCtx(trpcCtx)` helper builds `FilesCtx` —
 * routers never assemble it by hand"*. It is two fields, so the temptation to
 * inline `{ db: ctx.db, organizationId: ctx.session.organizationId }` at each of
 * the ~40 call sites across `file`, `folder`, `attachment` and `mediaAsset` is
 * real — and that is exactly how the scope came to be optional in
 * `BaseService`. One function means one place to change when the contract grows
 * a field, and one place to read when asking "what scope does lib see?".
 *
 * Two things it deliberately does not do:
 *
 * - **It performs no permission check.** `docs/lib-module-guide.md` §6 puts
 *   authorization at the procedure (`permissionProcedure`, `ctx.capabilities`),
 *   never below it. A helper that quietly asserted here would put a second,
 *   invisible gate under every router.
 * - **It carries no `userId`.** `FilesCtx` has none on purpose (`files/ctx.ts`):
 *   lib does no access checks, so an actor on the ambient scope has no reader,
 *   and a function that records one takes it in its own `input` where it is
 *   required. Routers pass `ctx.session.userId` to those functions directly.
 */

import type { Database } from '@auxx/database'
import type { FilesCtx } from '@auxx/lib/files/server'
import { createS3StoragePort } from '@auxx/lib/files/server'

/** The slice of a tRPC context these helpers read. Structural, so any procedure's context fits. */
export interface FilesTrpcContext {
  db: Database
  session: { organizationId: string }
}

/**
 * Build the `FilesCtx` every `files/` function takes from a protected tRPC context.
 *
 * `ctx.db` is the request pool. A procedure that needs several statements to
 * land together opens its own transaction and passes `{ ...toFilesCtx(ctx), db: tx }`
 * — that is the rule `files/ctx.ts` documents, and reusing the outer `ctx`
 * inside a transaction body is the stale-read bug this refactor exists to kill.
 */
export function toFilesCtx(ctx: FilesTrpcContext): FilesCtx {
  return { db: ctx.db, organizationId: ctx.session.organizationId }
}

/**
 * The `deps` slice the download accessors take: storage, plus the clock for the
 * `expiresAt` fallback.
 *
 * A narrowed `Pick<FilesDeps, …>` rather than the whole bundle, per
 * `files/ctx.ts` — a full `FilesDeps` would cost every presigned URL a live
 * `QueuePort`, i.e. a Redis connection.
 */
export function toFilesDownloadDeps(ctx: FilesTrpcContext) {
  return {
    storage: createS3StoragePort(ctx.session.organizationId),
    now: () => new Date(),
  }
}

/** The `now`-only slice every `files/` write takes, so `updatedAt` is never read off the wall clock inside lib. */
export function toFilesWriteDeps() {
  return { now: () => new Date() }
}
