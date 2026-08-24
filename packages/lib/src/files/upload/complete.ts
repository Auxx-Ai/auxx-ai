// packages/lib/src/files/upload/complete.ts

/**
 * Finishing an upload: verify the bytes, write the rows, then do the rest.
 *
 * ## The three phases, and why the boundaries are where they are
 *
 * 1. **VERIFY — storage only, no database.** Finalise the multipart upload if
 *    there is one, `HEAD` the object, and judge what came back against the
 *    session's own policy. For a multipart upload this is not a second opinion,
 *    it is the *only* one: `CreateMultipartUpload` takes no policy document, so
 *    nothing bounds the total size or the real content type until this `HEAD`
 *    (see the header of `storage/presign.ts`).
 * 2. **PERSIST — one `BEGIN…COMMIT`, database statements only.** No S3 call, no
 *    credential fetch, no queue write, no cache bust. The public URL is computed
 *    in phase 1 precisely so nothing has to reach storage from inside the
 *    transaction; `StoragePort.buildExternalUrl` is synchronous for the same
 *    reason.
 * 3. **AFTER COMMIT — queue, caches, preview URL.** `upload/post-commit.ts`.
 *
 * ## `Result` and rollback do not compose
 *
 * `db.transaction` rolls back on **throw**. Returning `err()` does not: an `err`
 * is an ordinary resolved value, the body completes normally, and the caller
 * commits the rows it was just told failed to write. So the body of this
 * function throws `AuxxError` subclasses and {@link guard} converts at the
 * exported boundary, *outside* the transaction — Style A, per
 * `plans/attachments/06` §6.4. Every `Result`-returning collaborator called
 * inside the transaction goes through {@link unwrap}, which re-throws.
 *
 * Never push a `guard` inward into the transaction body. That is the single
 * easiest way to reintroduce a bug here.
 *
 * ## Exactly one transaction, and it is opened here
 *
 * `ctx.db` must be a **pool**. Drizzle 0.44's `NodePgTransaction.transaction()`
 * exists and issues `SAVEPOINT`, so handing this function a transaction would
 * silently nest one — the trap #1851 hit — and the "one `BEGIN…COMMIT` per
 * request" exit criterion would become unobservable rather than false.
 *
 * ## What is still the processor's job
 *
 * `processor.process(session, storageLocationId, { tx })` is the persistence
 * step, unchanged. PR 4d replaces it with `persistUpload` dispatching on
 * `handler.persist`, and `handler.onPersist` for the extra writes. That swap is
 * one line here; it is not this PR's, for the reasons in `upload/prepare.ts`.
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { type AuxxError, BadRequestError } from '../../errors'
import type { FilesCtx, FilesDeps } from '../ctx'
import { guard, unwrap } from '../guard'
import { createStorageLocation } from '../storage/locations'
import { headObject } from '../storage/objects'
import { completeMultipart } from '../storage/presign'
import { validateCompletedUpload } from './config'
import { runUploadPostCommit } from './post-commit'
import { ensureProcessorsInitialized, ProcessorRegistry } from './processors'
import type { ProcessorResult } from './processors/types'
import { patchUploadSession, type UploadSessionRedis } from './session'
import type { PresignedUploadSession } from './session-types'

const logger = createScopedLogger('upload-complete')

/** Session statuses a completion may act on. Anything else is a retry of a dead flow. */
const COMPLETABLE_STATUSES: ReadonlySet<PresignedUploadSession['status']> = new Set([
  'created',
  'uploading',
])

/** What the client reports about the bytes it just wrote. */
export interface CompleteUploadInput {
  /** Advisory. The server knows the key from the session and never reads this. */
  storageKey?: string
  size: number
  mimeType: string
  etag?: string
  /** Multipart only, and required for it. */
  uploadId?: string
  /** Multipart only, and required for it. */
  parts?: Array<{ partNumber: number; etag: string }>
}

/** The rows a completed upload produced, plus a URL to preview it with. */
export interface CompletedUpload {
  sessionId: string
  storageLocationId: string
  fileId?: string
  assetId?: string
  attachmentId?: string
  documentId?: string
  url?: string
}

/**
 * Storage for the verification and the compensating delete, queue for the
 * durable cleanup fallback and the thumbnail fan-out, clock for the session
 * writes, Redis for the session itself.
 *
 * No `cache`: the two cache busts this path performs are lazy imports inside
 * `post-commit.ts` today, and PR 4d is what puts them behind {@link FilesDeps}'s
 * `CachePort`.
 */
export type CompleteUploadDeps = Pick<FilesDeps, 'storage' | 'queue' | 'now'> & {
  redis: UploadSessionRedis
}

/**
 * Complete a presigned upload.
 *
 * Performs no permission check — the caller has already been bound to this
 * session by `authorizeUploadSession` (#1818), which is authorization, and
 * authorization is not lib's question.
 *
 * @param ctx Scope. `ctx.db` must be the pool: this function opens the one
 *   transaction the completion path is allowed.
 * @param deps See {@link CompleteUploadDeps}.
 * @param session The authorized session, as Redis holds it.
 * @param input The client's completion report.
 * @returns `err(BadRequestError)` for a session in the wrong state or a
 *   multipart completion missing its parts, `err(UnprocessableEntityError)` when
 *   the delivered object breaks the session's policy, `err(NotFoundError)` when
 *   the object is not there at all.
 */
export async function completeUpload(
  ctx: FilesCtx,
  deps: CompleteUploadDeps,
  session: PresignedUploadSession,
  input: CompleteUploadInput
): Promise<Result<CompletedUpload, AuxxError>> {
  return guard(
    async () => {
      if (!COMPLETABLE_STATUSES.has(session.status)) {
        throw new BadRequestError(
          `Upload session ${session.id} cannot be completed from status '${session.status}'`
        )
      }

      ensureProcessorsInitialized()
      const processor = ProcessorRegistry.getForEntityType(session.entityType, ctx.organizationId)

      // ============= PHASE 1: STORAGE ONLY =============

      if (session.isMultipart) {
        if (!input.uploadId || !input.parts) {
          throw new BadRequestError('Missing uploadId or parts for multipart upload')
        }
        unwrap(
          await completeMultipart(deps.storage, {
            provider: session.provider,
            // The upload was started in this bucket; naming any other answers
            // `NoSuchUpload` (guide §11.5).
            bucket: session.bucket,
            key: session.storageKey,
            credentialId: session.credentialId,
            uploadId: input.uploadId,
            parts: input.parts,
          })
        )
      }

      const metadata = unwrap(
        await headObject(deps.storage, {
          provider: session.provider,
          bucket: session.bucket,
          key: session.storageKey,
          credentialId: session.credentialId,
        })
      )
      const head = {
        size: metadata.size || 0,
        mimeType: metadata.mimeType || 'application/octet-stream',
        etagOrRev: metadata.etagOrRev || metadata.updatedAt?.toISOString() || '',
      }

      validateCompletedUpload(session, head)

      // Canonical values, so a later reader of the session sees what S3 actually
      // holds rather than what the client declared.
      await patchUploadSession(
        deps.redis,
        session.id,
        { expectedSize: head.size, mimeType: head.mimeType || session.mimeType },
        deps.now
      )

      // Built HERE, not inside the transaction. It is pure string work over
      // config, but computing it inside the transaction is how an adapter lookup
      // or a credential fetch ends up holding a write connection open.
      const externalUrl = buildPublicUrl(deps, session)

      // ============= PHASE 2: ONE TRANSACTION =============

      // `ctx.db` is the pool — see the file header on why it must not be a
      // transaction. This is the only `db.transaction(` on the completion path.
      let persisted: { storageLocationId: string; result: ProcessorResult }
      try {
        persisted = await (ctx.db as Database).transaction(async (tx: Transaction) => {
          // Nested reads must see this transaction's uncommitted rows, so they
          // get `{ ...ctx, db: tx }` rather than the outer `ctx` on the pool.
          const txCtx: FilesCtx = { ...ctx, db: tx }

          const location = unwrap(
            await createStorageLocation(tx, txCtx, {
              provider: session.provider,
              externalId: session.storageKey,
              bucket: session.bucket,
              externalUrl,
              externalRev: head.etagOrRev,
              size: head.size,
              mimeType: head.mimeType || session.mimeType,
              credentialId: session.credentialId,
              metadata: {
                sessionId: session.id,
                uploader: session.userId,
                originalFileName: session.fileName,
                originalEtag: input.etag,
                originalSize: input.size,
              },
            })
          )

          const result = await processor.process(session, location.id, { tx })
          return { storageLocationId: location.id, result }
        })
      } catch (error) {
        await compensate(deps, session, error)
        throw error
      }

      // ============= PHASE 3: AFTER COMMIT =============

      // Best-effort from here down. The bytes are in storage and the rows are
      // committed; a Redis write or a cache bust that fails must not turn a
      // durable upload into a 500 that also marks the session `failed`.
      try {
        await patchUploadSession(
          deps.redis,
          session.id,
          { status: 'completed', storageLocationId: persisted.storageLocationId },
          deps.now
        )
      } catch (error) {
        logger.warn('Could not mark a completed upload session completed', {
          sessionId: session.id,
          error,
        })
      }

      const refs = persisted.result
      const post = await runUploadPostCommit(ctx, deps, session, {
        assetId: refs.assetId,
        fileId: refs.fileId,
        attachmentId: refs.attachmentId,
        documentId: refs.documentId,
      })

      return {
        sessionId: session.id,
        storageLocationId: persisted.storageLocationId,
        fileId: refs.fileId,
        assetId: refs.assetId,
        attachmentId: refs.attachmentId,
        documentId: refs.documentId,
        ...post,
      }
    },
    'Failed to complete upload',
    {
      sessionId: session.id,
      entityType: session.entityType,
      organizationId: ctx.organizationId,
      storageKey: session.storageKey,
    }
  )
}

/**
 * The object's durable public URL, for a PUBLIC upload only.
 *
 * A failure here is not fatal: the row is still correct without an
 * `externalUrl`, and every private read presigns anyway. Matches what the route
 * did — warn and carry on with `''`.
 */
function buildPublicUrl(
  deps: Pick<CompleteUploadDeps, 'storage'>,
  session: PresignedUploadSession
): string {
  if (session.visibility !== 'PUBLIC') return ''

  try {
    return deps.storage.buildExternalUrl({
      provider: session.provider,
      bucket: session.bucket,
      key: session.storageKey,
    })
  } catch (error) {
    logger.warn('Failed to build the external URL for a public upload', {
      sessionId: session.id,
      storageKey: session.storageKey,
      error,
    })
    return ''
  }
}

/**
 * Undo the object when the transaction that was supposed to reference it failed.
 *
 * Best-effort delete first; if that fails, a durable cleanup job. Both are
 * swallowed, because compensation must never replace the error the caller is in
 * the middle of reporting — losing the original failure is strictly worse than
 * leaking one object that the orphan sweeper will find.
 *
 * `bucket` is non-negotiable on the delete: S3 answers **204** for a delete of a
 * key that is not in the bucket you named, so a wrong-bucket compensation
 * reports success and leaks the object with no error anywhere (#1816/#1817/#1818).
 */
async function compensate(
  deps: Pick<CompleteUploadDeps, 'storage' | 'queue'>,
  session: PresignedUploadSession,
  cause: unknown
): Promise<void> {
  try {
    await deps.storage.deleteObject({
      provider: session.provider,
      bucket: session.bucket,
      key: session.storageKey,
      credentialId: session.credentialId,
    })
    return
  } catch (deleteError) {
    logger.warn('Immediate storage cleanup failed; scheduling for background cleanup', {
      sessionId: session.id,
      key: session.storageKey,
      error: deleteError,
    })
  }

  try {
    await deps.queue.enqueueStorageCleanup({
      provider: session.provider,
      key: session.storageKey,
      bucket: session.bucket,
      credentialId: session.credentialId,
      reason: `Upload transaction failed: ${String(cause)}`,
      organizationId: session.organizationId,
    })
  } catch (enqueueError) {
    logger.error('Could not schedule cleanup for an orphaned storage object', {
      sessionId: session.id,
      key: session.storageKey,
      bucket: session.bucket,
      error: enqueueError,
    })
  }
}
