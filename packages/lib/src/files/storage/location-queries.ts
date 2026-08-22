// packages/lib/src/files/storage/location-queries.ts

/**
 * `StorageLocation` reads.
 *
 * Split from `storage/locations.ts` (writes) per `docs/lib-module-guide.md` §5
 * — "a file that both queries and mutates is the first step back toward a
 * service class". These are the two reads that replace
 * `StorageLocationService.get` and `.findByExternalId`, the only two read
 * methods on that class anything ever called.
 *
 * ## Both reads are organization-scoped, and that is a deliberate change
 *
 * `storageLocationService` was a module-level singleton with **no organization
 * scope at all** (`plans/attachments/03-storage-layer.md` §3.1): `get(id)` would
 * happily return another tenant's row, and the caller then presigned a download
 * URL for it. `FilesCtx` exists to make that impossible — the scope is not
 * optional and not derivable from the input, so every read here filters on
 * `ctx.organizationId`.
 *
 * The consequence, stated plainly: a row whose `organizationId` is `NULL` (the
 * column is nullable for backfill compatibility) is now invisible to these
 * reads. That is the correct answer — a row nobody owns is a row nobody may
 * download — but it is a behaviour change from the unscoped singleton, not a
 * pure extraction.
 *
 * ## "Not found" and "not yours" are the same answer
 *
 * Both return `ok(null)` rather than distinguishing the two cases, for the same
 * reason `assets/download.ts` returns one `NotFoundError`: a caller must not be
 * able to probe for ids outside its tenant by reading the error text.
 */

import { schema } from '@auxx/database'
import type { StorageLocationEntity } from '@auxx/database/types'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type { ProviderId } from '../adapters/base-adapter'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'

/**
 * Load one live `StorageLocation` by id, scoped to the caller's organization.
 *
 * Replaces `StorageLocationService.get`. Returns `ok(null)` when the row does
 * not exist, is soft-deleted, or belongs to another organization — see the file
 * header for why those three collapse into one answer.
 *
 * @param ctx Scope and database. Runs unchanged on a pool or inside a caller's
 *   transaction, because `FilesCtx.db` is `Database | Transaction`.
 * @param id The `StorageLocation.id` to load.
 */
export async function getStorageLocation(
  ctx: FilesCtx,
  id: string
): Promise<Result<StorageLocationEntity | null, AuxxError>> {
  return guard(
    async () => {
      const [location] = await ctx.db
        .select()
        .from(schema.StorageLocation)
        .where(
          and(
            eq(schema.StorageLocation.id, id),
            eq(schema.StorageLocation.organizationId, ctx.organizationId),
            isNull(schema.StorageLocation.deletedAt)
          )
        )
        .limit(1)

      return location ?? null
    },
    'Failed to get storage location',
    { storageLocationId: id }
  )
}

/**
 * Find the most recent live `StorageLocation` for a provider-side identifier.
 *
 * Replaces `StorageLocationService.findByExternalId`, which returned the whole
 * `createdAt DESC` list. Its one caller
 * (`email/inbound/body-ingest.service.ts`) read `[0]` and dropped the rest, so
 * this returns the single newest row instead of making every caller re-derive
 * that. Nothing needs the list; if something ever does, add a second function
 * rather than widening this one.
 *
 * @param ctx Scope and database.
 * @param provider The storage provider the identifier belongs to. An
 *   `externalId` is only unique *within* a provider, so this is not optional.
 * @param externalId Provider-side identifier — for S3, the object key.
 */
export async function findStorageLocationByExternalId(
  ctx: FilesCtx,
  provider: ProviderId,
  externalId: string
): Promise<Result<StorageLocationEntity | null, AuxxError>> {
  return guard(
    async () => {
      const [location] = await ctx.db
        .select()
        .from(schema.StorageLocation)
        .where(
          and(
            eq(schema.StorageLocation.provider, provider),
            eq(schema.StorageLocation.externalId, externalId),
            eq(schema.StorageLocation.organizationId, ctx.organizationId),
            isNull(schema.StorageLocation.deletedAt)
          )
        )
        .orderBy(desc(schema.StorageLocation.createdAt))
        .limit(1)

      return location ?? null
    },
    'Failed to find storage location by external id',
    { provider, externalId }
  )
}
