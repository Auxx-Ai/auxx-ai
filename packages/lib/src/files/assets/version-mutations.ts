// packages/lib/src/files/assets/version-mutations.ts

/**
 * `MediaAssetVersion` writes.
 *
 * Separate from `assets/asset-mutations.ts` because the two have different
 * atomicity requirements, not because of a naming convention: creating a version
 * is *always* two statements (insert the row, move the asset's
 * `currentVersionId`), so it can only be correct inside a transaction the caller
 * owns. That is why {@link createAssetVersion} and {@link updateAssetContent}
 * take `tx: Transaction` positionally first — a `ctx`-only signature would
 * accept a pool and the pointer move would silently stop being atomic with the
 * insert.
 *
 * ## These functions never open a transaction
 *
 * No `getTx`, no `tx.transaction(...)`. The legacy `createVersion` branched at
 * runtime on whether it had been handed a client and opened a savepoint when it
 * had not — and in drizzle-orm 0.44 the "already inside one" branch is
 * unreachable, so an avatar upload really ran nested `SAVEPOINT`s for work
 * nothing needed to partially roll back. Phase 6 owns the transaction
 * boundaries; here the caller owns them.
 *
 * ## `Result` and rollback do not compose
 *
 * The bodies below throw `AuxxError` subclasses and {@link guard} converts at
 * the exported boundary. Returning `err()` from inside a transaction body does
 * **not** roll back — it is an ordinary resolved value, so the caller commits
 * the rows it was just told failed to write.
 */

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type {
  MediaAssetEntity,
  MediaAssetVersionEntity,
  StorageLocationEntity,
} from '@auxx/database/types'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { AuxxError, ConflictError, NotFoundError } from '../../errors'
import { purgeMediaAssets } from '../core/media-asset-purge'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'
import { getAssetVersionByNumber, requireAsset } from './asset-queries'
import type { AssetVersionDeleteDeps, AssetWriteDeps } from './ports'

/** A version returned by a write, with the location it points at resolved. */
export type CreatedAssetVersion = MediaAssetVersionEntity & {
  storageLocation: StorageLocationEntity
}

/** Everything needed to add one version to an existing asset. */
export interface CreateAssetVersionInput {
  assetId: string
  storageLocationId: string
  /**
   * Byte size. Defaults to the storage location's own `size` when omitted.
   *
   * **Behaviour change:** the legacy `createVersion` spread its `metadata`
   * argument over `{ size, mimeType }` taken from the location, so a caller
   * passing `{ size: undefined }` — which `createWithVersion` did whenever
   * `CreateAssetRequest.size` was absent — overwrote the location's size with
   * `undefined` and persisted `NULL`. Inheriting from the row is what the code
   * plainly meant.
   */
  size?: number
  /** MIME type. Defaults to the storage location's own `mimeType` when omitted. */
  mimeType?: string
  /** Provider-specific extras persisted on the version (e.g. `{ contentHash }`). */
  metadata?: Record<string, unknown>
}

/** Everything needed to replace an asset's content with a new version. */
export interface UpdateAssetContentInput {
  assetId: string
  storageLocationId: string
  size?: number
  mimeType?: string
  metadata?: Record<string, unknown>
}

/**
 * Add a version to an asset and make it current, inside the caller's transaction.
 *
 * Two statements plus the asset existence check, all on `tx`. The
 * `currentVersionId` move is organization-scoped, which the legacy
 * `UPDATE MediaAsset … WHERE id = ?` was not.
 *
 * ## The `StorageLocation` read is deliberately NOT organization-scoped
 *
 * `StorageLocation.organizationId` is nullable — the column was added for
 * backfill compatibility and old rows carry `NULL`. An `eq(organizationId, …)`
 * filter would make every one of those rows invisible, and a version could no
 * longer be created against a location that predates the column. That is a
 * reachability change this PR is not the place to make (`location-queries.ts`
 * accepted the same trade in the other direction for *reads*, and said so).
 * Stated here rather than left implicit: this lookup can resolve a location
 * owned by nobody.
 *
 * @param tx Positional and first: `FilesCtx.db` is `Database | Transaction`, so
 *   a `ctx`-only signature would accept a pool and the insert would stop being
 *   atomic with the pointer move. This function never calls `tx.transaction(…)`.
 * @param ctx Scope. `ctx.db` is ignored — every statement runs on `tx`.
 * @param input The version to write.
 */
export async function createAssetVersion(
  tx: Transaction,
  ctx: FilesCtx,
  input: CreateAssetVersionInput
): Promise<Result<CreatedAssetVersion, AuxxError>> {
  return guard(async () => insertVersion(tx, ctx, input), 'Failed to create asset version', {
    assetId: input.assetId,
    storageLocationId: input.storageLocationId,
  })
}

/**
 * Replace an asset's content: new version, asset metadata updated to match.
 *
 * The asset row's `size`/`mimeType` are only touched when the input names them,
 * matching the legacy `updateContent`.
 *
 * @param tx Positional and first — three statements that have to land together.
 * @param ctx Scope. `ctx.db` is ignored.
 * @param deps `now`, for the asset's `updatedAt` stamp.
 * @param input The new content.
 */
export async function updateAssetContent(
  tx: Transaction,
  ctx: FilesCtx,
  deps: AssetWriteDeps,
  input: UpdateAssetContentInput
): Promise<Result<{ asset: MediaAssetEntity; version: CreatedAssetVersion }, AuxxError>> {
  return guard(
    async () => {
      const txCtx: FilesCtx = { ...ctx, db: tx }
      await requireAsset(txCtx, input.assetId)

      const version = await insertVersion(tx, ctx, input)

      const [asset] = await tx
        .update(schema.MediaAsset)
        .set({
          ...(input.size !== undefined && { size: input.size }),
          ...(input.mimeType !== undefined && { mimeType: input.mimeType }),
          updatedAt: deps.now(),
        })
        .where(
          and(
            eq(schema.MediaAsset.id, input.assetId),
            eq(schema.MediaAsset.organizationId, ctx.organizationId)
          )
        )
        .returning()

      if (!asset) throw new AuxxError(`Asset ${input.assetId} update affected no rows`)
      return { asset, version }
    },
    'Failed to update asset content',
    { assetId: input.assetId, storageLocationId: input.storageLocationId }
  )
}

/**
 * Point an asset back at one of its earlier versions.
 *
 * A single `UPDATE`, so it takes `ctx` rather than a `Transaction` — but the
 * `WHERE` now carries the organization filter the legacy `restoreVersion`
 * omitted (it read the version org-scoped and then updated by bare id).
 *
 * @param ctx Scope and database.
 * @param deps `now`, for the `updatedAt` stamp.
 * @param assetId The asset to move.
 * @param versionNumber The 1-based version number to restore — not a version id.
 */
export async function restoreAssetVersion(
  ctx: FilesCtx,
  deps: AssetWriteDeps,
  assetId: string,
  versionNumber: number
): Promise<Result<MediaAssetEntity, AuxxError>> {
  return guard(
    async () => {
      const found = await getAssetVersionByNumber(ctx, assetId, versionNumber)
      if (found.isErr()) throw found.error
      const version = found.value
      if (!version) {
        throw new NotFoundError(`Version ${versionNumber} not found for asset ${assetId}`)
      }

      const [asset] = await ctx.db
        .update(schema.MediaAsset)
        .set({ currentVersionId: version.id, updatedAt: deps.now() })
        .where(
          and(
            eq(schema.MediaAsset.id, assetId),
            eq(schema.MediaAsset.organizationId, ctx.organizationId)
          )
        )
        .returning()

      if (!asset) throw new AuxxError(`Asset ${assetId} restore affected no rows`)
      return asset
    },
    'Failed to restore asset version',
    { assetId, versionNumber }
  )
}

/**
 * Hard-delete one non-current version of an asset.
 *
 * The order matters and is inherited unchanged:
 *
 * 1. the thumbnails derived from the version are swept through
 *    {@link AssetVersionDeleteDeps.thumbnails}, which drops their objects but
 *    only *soft*-deletes their rows;
 * 2. those derived assets are then purged outright, because a thumbnail is its
 *    own `MediaAsset` linked back through `MediaAssetVersion.derivedFromVersionId`
 *    (a self-FK with NO ACTION), so a surviving row would block step 3 with FK
 *    23503;
 * 3. the version row itself goes.
 *
 * Refuses to delete the asset's current version — losing it would leave the
 * asset pointing at nothing.
 *
 * @param ctx Scope and database. Kept `ctx`-shaped rather than `tx`-first
 *   because the legacy method ran these statements on a bare pool; introducing
 *   a transaction here would be a Phase-6 change made under cover of Phase 5.
 * @param deps The thumbnail sweep.
 */
export async function deleteAssetVersion(
  ctx: FilesCtx,
  deps: AssetVersionDeleteDeps,
  assetId: string,
  versionNumber: number
): Promise<Result<void, AuxxError>> {
  return guard(
    async () => {
      const asset = await requireAsset(ctx, assetId)

      const found = await getAssetVersionByNumber(ctx, assetId, versionNumber)
      if (found.isErr()) throw found.error
      const version = found.value
      if (!version) {
        throw new NotFoundError(`Version ${versionNumber} not found for asset ${assetId}`)
      }
      if (asset.currentVersionId === version.id) {
        throw new ConflictError('Cannot delete the current version')
      }

      await deps.thumbnails.deleteThumbnailsForSource(version.id)

      const derived = await ctx.db
        .selectDistinct({ assetId: schema.MediaAssetVersion.assetId })
        .from(schema.MediaAssetVersion)
        .where(eq(schema.MediaAssetVersion.derivedFromVersionId, version.id))

      if (derived.length > 0) {
        await purgeMediaAssets(
          ctx.db,
          derived.map((row) => row.assetId)
        )
      }

      await ctx.db
        .delete(schema.MediaAssetVersion)
        .where(eq(schema.MediaAssetVersion.id, version.id))
    },
    'Failed to delete asset version',
    { assetId, versionNumber }
  )
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/**
 * The shared body of {@link createAssetVersion} and {@link updateAssetContent}.
 *
 * Throws rather than returning `Result`, so a failure inside the caller's
 * transaction rolls it back.
 */
async function insertVersion(
  tx: Transaction,
  ctx: FilesCtx,
  input: CreateAssetVersionInput
): Promise<CreatedAssetVersion> {
  const txCtx: FilesCtx = { ...ctx, db: tx }
  await requireAsset(txCtx, input.assetId)

  const last = await tx.query.MediaAssetVersion.findFirst({
    where: eq(schema.MediaAssetVersion.assetId, input.assetId),
    orderBy: desc(schema.MediaAssetVersion.versionNumber),
    columns: { versionNumber: true },
  })
  const versionNumber = (last?.versionNumber ?? 0) + 1

  // See the function docs: intentionally not organization-scoped, because
  // `StorageLocation.organizationId` is nullable.
  const storageLocation = await tx.query.StorageLocation.findFirst({
    where: and(
      eq(schema.StorageLocation.id, input.storageLocationId),
      isNull(schema.StorageLocation.deletedAt)
    ),
  })
  if (!storageLocation) {
    throw new NotFoundError(`Storage location ${input.storageLocationId} not found`)
  }

  const [version] = await tx
    .insert(schema.MediaAssetVersion)
    .values({
      assetId: input.assetId,
      versionNumber,
      storageLocationId: input.storageLocationId,
      size: input.size ?? storageLocation.size,
      mimeType: input.mimeType ?? storageLocation.mimeType,
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    })
    .returning()

  if (!version) throw new AuxxError('Asset version insert returned no row')

  await tx
    .update(schema.MediaAsset)
    .set({ currentVersionId: version.id })
    .where(
      and(
        eq(schema.MediaAsset.id, input.assetId),
        eq(schema.MediaAsset.organizationId, ctx.organizationId)
      )
    )

  return { ...version, storageLocation }
}
