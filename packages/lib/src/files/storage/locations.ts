// packages/lib/src/files/storage/locations.ts

/**
 * `StorageLocation` writes.
 *
 * This is the Phase-2 **write pilot**: the worked example of the third
 * signature shape in `files/ctx.ts` (`fn(tx, ctx, input)`), and the single
 * place a `StorageLocation` row may be created from.
 *
 * Reads live in `storage/location-queries.ts` — `docs/lib-module-guide.md` §5,
 * "a file that both queries and mutates is the first step back toward a service
 * class".
 *
 * ## Why `tx` is positional, first, and separate from `ctx`
 *
 * `FilesCtx.db` is `Database | Transaction`. That union is what lets a *read*
 * run unchanged on a pool or inside a transaction — and it is exactly why a
 * `ctx` alone **cannot** express "this must be inside a transaction": a
 * connection pool satisfies the union and typechecks into it, and the
 * multi-statement invariant the caller thought it had silently stops existing.
 *
 * A bare `tx: Transaction` slot rejects a pool at compile time. That is the
 * entire reason for the extra parameter, and it is the property this pilot
 * exists to demonstrate. Callers inside a transaction body pass
 * `{ ...ctx, db: tx }` for any nested `ctx`-taking read, so a stale pool can
 * never leak into the body either.
 *
 * ## This function never opens a transaction
 *
 * No `getTx`, no `tx.transaction(...)`, no savepoints. The caller owns the
 * `BEGIN…COMMIT` boundary (`plans/attachments/06-transactions-and-jobs.md`
 * §6.1). `BaseService.getTx()` tried to *detect* whether it was already inside
 * one; in drizzle-orm 0.44 `NodePgTransaction.transaction()` exists and issues
 * `SAVEPOINT`, so the detection branch is unreachable and an avatar upload
 * really runs `BEGIN → INSERT → SAVEPOINT → SAVEPOINT → RELEASE → RELEASE →
 * COMMIT` for work where nothing needs partial rollback.
 *
 * ## This function performs no non-database I/O
 *
 * No S3 call, no queue write, no cache bust, no credential fetch — which is why
 * it takes no `FilesDeps` at all. The signature is the guarantee: there is
 * nothing here to call. `StorageManager.prepareLocationMetadata`, the code this
 * replaces, could reach `getProviderAuth()` → `revealSecrets()` (a database
 * read plus a decrypt) to guess a bucket, *while holding an open write
 * transaction*. Requiring `bucket` on the input deletes that path rather than
 * moving it.
 *
 * ## `Result` and rollback do not compose — the guard sits at the boundary
 *
 * `db.transaction` rolls back on **throw**. Returning `err()` does **not** roll
 * back: an `err()` is an ordinary resolved value, the transaction body
 * completes normally, and the caller commits the very rows it was told failed
 * to write.
 *
 * So the body below throws `AuxxError` subclasses, and {@link guard} converts
 * at the exported boundary — *outside* any transaction the caller opened. Never
 * push the guard inward into a transaction body, and never return `err()` from
 * inside one. This is the single easiest way to reintroduce a bug in this file.
 */

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type { StorageLocationEntity } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { AuxxError, BadRequestError } from '../../errors'
import type { ProviderId } from '../adapters/base-adapter'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'
import { isProviderAvailable } from './providers'

/**
 * Everything needed to persist one `StorageLocation` row.
 *
 * Two fields are deliberately shaped against the legacy request type this
 * replaces (`CreateStorageLocationRequest`):
 *
 * - **`bucket` is required.** Bugs #1816/#1817/#1818 were all one bug: the
 *   bucket was optional, a write door omitted it, and the row was persisted
 *   without it. `deleteByKey` then falls back to `S3_PRIVATE_BUCKET`, S3 answers
 *   `204 No Content` for a delete of a key that is not in the bucket you named,
 *   and the object leaks with no error anywhere. A row you cannot delete by key
 *   is not a row worth writing, so the type refuses to describe one.
 * - **There is no `organizationId`.** Scope comes from `ctx.organizationId` and
 *   is never taken from the input, so a caller cannot write a row into an
 *   organization it is not acting for.
 *
 * There is no `visibility` either: it existed solely to *guess* a bucket when
 * none was supplied, and a required `bucket` makes it dead weight.
 */
export interface CreateStorageLocationInput {
  provider: ProviderId
  /** Provider-side identifier — for S3, the object key. */
  externalId: string
  /**
   * The bucket the object actually lives in. Required: see the type's docs.
   * Lands in the persisted `metadata`, which is where every adapter reads it.
   */
  bucket: string
  /** Public URL, when the object has one. Empty string when it does not. */
  externalUrl?: string
  /** Provider revision marker — for S3, the ETag. */
  externalRev?: string
  /** Credential the object was written with. Absent means platform storage. */
  credentialId?: string
  size?: number
  mimeType?: string
  /** Provider-specific extras. `bucket` and `key` are normalised over the top. */
  metadata?: Record<string, unknown>
}

/**
 * Normalise the metadata blob that gets persisted with the row.
 *
 * `bucket` is written last and unconditionally, so an inherited
 * `metadata.bucket` from an upstream payload can never win over the bucket the
 * caller actually uploaded to — that mismatch is what a wrong-bucket delete
 * looks like from the database side.
 *
 * `key` is defaulted from `externalId` because that is where the adapters look
 * for it, and every S3 location has had it since `prepareLocationMetadata`
 * started adding it.
 */
function normalizeLocationMetadata(input: CreateStorageLocationInput): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) }
  metadata.bucket = input.bucket
  if (metadata.key === undefined) metadata.key = input.externalId
  return metadata
}

/**
 * Validate the input. Throws — never returns `Result` — so that a failure
 * inside a caller's transaction body rolls the transaction back.
 */
function assertValidInput(input: CreateStorageLocationInput): void {
  if (!isProviderAvailable(input.provider)) {
    throw new BadRequestError(`Storage provider ${input.provider} is not available`)
  }
  if (!input.externalId) {
    throw new BadRequestError('Storage location externalId is required')
  }
  if (!input.bucket) {
    throw new BadRequestError(
      `Storage location for ${input.externalId} was created without a bucket; ` +
        'a bucket-less row cannot be deleted by key (S3 answers 204 for a key that is not there)'
    )
  }
  if (input.size !== undefined && input.size < 0) {
    throw new BadRequestError('Storage location size must be non-negative')
  }
}

/**
 * Create one `StorageLocation` row inside a transaction the caller owns.
 *
 * Replaces `StorageManager.createStorageLocation` + `StorageLocationService.create`,
 * which together validated the provider, normalised metadata, and inserted —
 * except that the bucket was optional the whole way down, so two write doors
 * (`users/user-avatar-service.ts` and `StorageLocationService.create`/`bulkCreate`)
 * routinely produced rows nothing could delete by key. Requiring `bucket` on
 * {@link CreateStorageLocationInput} is what closes that, and the reason this
 * function is the only sanctioned way to write the row.
 *
 * @param tx Positional and first **on purpose**, and deliberately not folded
 *   into `ctx`: `FilesCtx.db` is `Database | Transaction`, so a pool would
 *   typecheck into a `ctx`-only signature and the write would silently stop
 *   being part of the caller's unit of work. A bare `Transaction` slot rejects
 *   a pool at compile time. This function never calls `tx.transaction(...)`.
 * @param ctx Scope only. `ctx.db` is ignored here — the statement runs on `tx`,
 *   which is the whole point — and `ctx.organizationId` is the row's owner.
 * @param input The row to write. See {@link CreateStorageLocationInput}.
 */
export async function createStorageLocation(
  tx: Transaction,
  ctx: FilesCtx,
  input: CreateStorageLocationInput
): Promise<Result<StorageLocationEntity, AuxxError>> {
  return guard(
    async () => {
      assertValidInput(input)

      const [location] = await tx
        .insert(schema.StorageLocation)
        .values({
          provider: input.provider,
          externalId: input.externalId,
          externalUrl: input.externalUrl ?? '',
          externalRev: input.externalRev ?? '',
          // Scope is the caller's, never the payload's.
          organizationId: ctx.organizationId,
          credentialId: input.credentialId ?? null,
          size: input.size ?? null,
          mimeType: input.mimeType ?? null,
          metadata: normalizeLocationMetadata(input),
        })
        .returning()

      if (!location) {
        throw new AuxxError('Storage location insert returned no row')
      }

      return location
    },
    'Failed to create storage location',
    { provider: input.provider, externalId: input.externalId, bucket: input.bucket }
  )
}

/**
 * Delete one `StorageLocation` row inside a transaction the caller owns.
 *
 * Replaces `StorageLocationService.delete`. Two things differ from that method,
 * both deliberate:
 *
 * - **It is organization-scoped.** The singleton deleted by bare id, so a wrong
 *   id could remove another tenant's row. A row outside `ctx.organizationId` is
 *   simply not matched; the function still resolves `ok()`, because "already
 *   gone" and "never yours" are the same non-event to a delete and neither is
 *   worth failing a caller's transaction over.
 * - **It rides the caller's transaction.** The row and whatever referenced it
 *   (an asset version, an attachment) have to disappear together or not at all;
 *   a `tx` slot is where that gets enforced rather than hoped for.
 *
 * The delete stays **hard**, matching the method it replaces:
 * `StorageLocation.deletedAt` is the *sweep* marker written by
 * `lifecycle/orphaned-cleanup.ts` for rows whose S3 object still needs removing,
 * so soft-deleting here would hand the sweeper a row whose object is already
 * gone.
 *
 * The S3 object is **not** this function's problem — it takes no `FilesDeps`,
 * so the signature says so. The caller deletes the object first and the row
 * second; doing it the other way round loses the only pointer to the bytes.
 *
 * @param tx Positional and first for the reason spelled out on
 *   {@link createStorageLocation}: a `ctx`-only signature would silently accept
 *   a pool. This function never calls `tx.transaction(...)`.
 * @param ctx Scope only. `ctx.db` is ignored — the statement runs on `tx`.
 * @param id The `StorageLocation.id` to remove.
 */
export async function deleteStorageLocation(
  tx: Transaction,
  ctx: FilesCtx,
  id: string
): Promise<Result<void, AuxxError>> {
  return guard(
    async () => {
      await tx
        .delete(schema.StorageLocation)
        .where(
          and(
            eq(schema.StorageLocation.id, id),
            eq(schema.StorageLocation.organizationId, ctx.organizationId)
          )
        )
    },
    'Failed to delete storage location',
    { storageLocationId: id }
  )
}
