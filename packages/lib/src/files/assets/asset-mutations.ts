// packages/lib/src/files/assets/asset-mutations.ts

/**
 * `MediaAsset` writes.
 *
 * Reads live in `assets/asset-queries.ts`, version writes in
 * `assets/version-mutations.ts` — `docs/lib-module-guide.md` §5, "a file that
 * both queries and mutates is the first step back toward a service class".
 *
 * ## Scope comes from `ctx`, never from the payload
 *
 * The legacy `processCreateData` took `organizationId` off the request and only
 * fell back to the service's own scope, so a caller could write a row into an
 * organization it was not acting for. Following `storage/locations.ts`, the
 * input types below carry no `organizationId` at all.
 *
 * ## Actors travel in the input, not in `ctx`
 *
 * `FilesCtx` deliberately has no `userId` (`files/ctx.ts`), so
 * {@link CreateAssetInput.createdById} is where attribution appears — in the
 * signature of exactly the function that attributes, and nowhere else.
 */

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type { MediaAssetEntity } from '@auxx/database/types'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { AuxxError, BadRequestError, NotFoundError } from '../../errors'
import type { AssetKind } from '../core/types'
import { VALID_ASSET_KINDS } from '../core/types'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'
import { requireAsset } from './asset-queries'
import type { AssetDeleteDeps, AssetWriteDeps } from './ports'
import type { CreatedAssetVersion } from './version-mutations'
import { createAssetVersion } from './version-mutations'

/** Everything needed to persist one `MediaAsset` row. See the file header for what is absent. */
export interface CreateAssetInput {
  kind: AssetKind
  purpose: string
  name?: string
  mimeType?: string
  size?: number
  /** Defaults to `true`, matching the legacy "private unless told otherwise" default. */
  isPrivate?: boolean
  /** The actor to attribute the row to. Optional: several production writers have no actor. */
  createdById?: string
  /** Automatic-cleanup deadline for temporary assets. */
  expiresAt?: Date
}

/** {@link CreateAssetInput} plus the storage location the first version points at. */
export interface CreateAssetWithVersionInput extends CreateAssetInput {
  storageLocationId: string
}

/** The mutable fields of a `MediaAsset`. */
export interface UpdateAssetInput {
  kind?: AssetKind
  name?: string
  isPrivate?: boolean
  mimeType?: string
  size?: number
  expiresAt?: Date | null
}

/** Everything needed to mint a `MediaAsset` from an existing file-library row. */
export interface CreateAssetFromFolderFileInput {
  fileId: string
  /** Pin a specific `FileVersion`. Defaults to the file's current version. */
  fileVersionId?: string
  /** Defaults to `DOCUMENT`, matching the legacy default. */
  kind?: AssetKind
  /**
   * Return an existing asset that already points at the same storage location
   * instead of minting a second one.
   */
  skipIfExists?: boolean
}

/**
 * Create one `MediaAsset` row.
 *
 * A single `INSERT`, so it takes `ctx` rather than a `Transaction`. A caller
 * that is already inside one passes `{ ...ctx, db: tx }`.
 *
 * @param ctx Scope and database. `ctx.organizationId` is the row's owner.
 * @param deps `now`, for the `updatedAt` stamp — the column is `NOT NULL` with
 *   no database default.
 * @param input The row to write.
 */
export async function createAsset(
  ctx: FilesCtx,
  deps: AssetWriteDeps,
  input: CreateAssetInput
): Promise<Result<MediaAssetEntity, AuxxError>> {
  return guard(async () => insertAsset(ctx.db, ctx, deps, input), 'Failed to create asset', {
    kind: input.kind,
    organizationId: ctx.organizationId,
  })
}

/**
 * Create an asset and its first version together, inside the caller's transaction.
 *
 * `tx` is positional and first because this is three statements — insert the
 * asset, insert the version, move `currentVersionId` — and an asset that exists
 * without a version is an asset nothing can download. The legacy
 * `createWithVersion` opened its own `getTx` savepoint; here the caller owns the
 * boundary (`plans/attachments/06-transactions-and-jobs.md` §6.1).
 *
 * @param tx The caller's transaction. Never `tx.transaction(…)`ed here.
 * @param ctx Scope. `ctx.db` is ignored — every statement runs on `tx`.
 * @param deps `now`, for the asset's `updatedAt` stamp.
 * @param input Asset fields plus the storage location the first version points at.
 */
export async function createAssetWithVersion(
  tx: Transaction,
  ctx: FilesCtx,
  deps: AssetWriteDeps,
  input: CreateAssetWithVersionInput
): Promise<Result<{ asset: MediaAssetEntity; version: CreatedAssetVersion }, AuxxError>> {
  return guard(
    async () => {
      const { storageLocationId, ...assetInput } = input
      const asset = await insertAsset(tx, ctx, deps, assetInput)

      const version = await createAssetVersion(tx, ctx, {
        assetId: asset.id,
        storageLocationId,
        size: input.size,
        mimeType: input.mimeType,
      })
      // Rethrow rather than return: an `err()` here would resolve normally and
      // the caller would commit an asset with no version.
      if (version.isErr()) throw version.error

      return { asset, version: version.value }
    },
    'Failed to create asset with version',
    { kind: input.kind, storageLocationId: input.storageLocationId }
  )
}

/**
 * Update one asset's mutable fields.
 *
 * @param ctx Scope and database.
 * @param deps `now`, for the `updatedAt` stamp.
 * @param assetId The asset to update, interpreted within `ctx.organizationId`.
 * @param input The fields to change. Absent fields are left alone.
 */
export async function updateAsset(
  ctx: FilesCtx,
  deps: AssetWriteDeps,
  assetId: string,
  input: UpdateAssetInput
): Promise<Result<MediaAssetEntity, AuxxError>> {
  return guard(
    async () => {
      const [asset] = await ctx.db
        .update(schema.MediaAsset)
        .set({ ...input, updatedAt: deps.now() })
        .where(
          and(
            eq(schema.MediaAsset.id, assetId),
            eq(schema.MediaAsset.organizationId, ctx.organizationId)
          )
        )
        .returning()

      if (!asset) throw new NotFoundError(`Asset ${assetId} not found`)
      return asset
    },
    'Failed to update asset',
    { assetId, organizationId: ctx.organizationId }
  )
}

/**
 * Soft-delete an asset and everything that pointed at its versions.
 *
 * Three steps, all on `tx`, all of which have to land together:
 *
 * 1. sweep the thumbnails derived from every version of the asset;
 * 2. null out any `currentVersionId` that referenced one of those versions —
 *    **now organization-scoped**, which the legacy `UPDATE … WHERE
 *    currentVersionId IN (…)` was not;
 * 3. stamp `deletedAt` on the asset itself, also organization-scoped.
 *
 * The thumbnail sweep performs storage I/O while the transaction is open. That
 * is inherited from the legacy `delete`, which ran the same sequence inside its
 * own `getTx`; moving it outside the boundary is Phase 6's job, not this PR's.
 *
 * @param tx The caller's transaction.
 * @param ctx Scope. `ctx.db` is ignored.
 * @param deps The thumbnail sweep, plus `now` for the `deletedAt` stamp.
 * @param assetId The asset to remove.
 */
export async function deleteAsset(
  tx: Transaction,
  ctx: FilesCtx,
  deps: AssetDeleteDeps,
  assetId: string
): Promise<Result<void, AuxxError>> {
  return guard(
    async () => {
      const txCtx: FilesCtx = { ...ctx, db: tx }
      await requireAsset(txCtx, assetId)

      const versions = await tx.query.MediaAssetVersion.findMany({
        where: eq(schema.MediaAssetVersion.assetId, assetId),
        columns: { id: true },
      })

      for (const version of versions) {
        await deps.thumbnails.deleteThumbnailsForSource(version.id)
      }

      if (versions.length > 0) {
        await tx
          .update(schema.MediaAsset)
          .set({ currentVersionId: null })
          .where(
            and(
              inArray(
                schema.MediaAsset.currentVersionId,
                versions.map((version) => version.id)
              ),
              eq(schema.MediaAsset.organizationId, ctx.organizationId)
            )
          )
      }

      await tx
        .update(schema.MediaAsset)
        .set({ deletedAt: deps.now() })
        .where(
          and(
            eq(schema.MediaAsset.id, assetId),
            eq(schema.MediaAsset.organizationId, ctx.organizationId)
          )
        )
    },
    'Failed to delete asset',
    { assetId, organizationId: ctx.organizationId }
  )
}

/**
 * Promote a temporary upload to a permanent kind and clear its expiry.
 *
 * A no-op — `ok(undefined)`, not an error — when the asset is missing or already
 * permanent, matching the legacy `convertTempToPermanent`. Every caller runs
 * this speculatively over ids that may already have been converted by an earlier
 * request, so "nothing to do" is not a failure.
 *
 * Kept `ctx`-shaped rather than `tx`-first even though it reads then writes:
 * the legacy ran both statements on whatever client it was handed, including a
 * bare pool, and its callers that *do* have a transaction pass
 * `{ ...ctx, db: tx }`. Making the transaction mandatory here would change three
 * call sites' atomicity, which is Phase 6's decision.
 *
 * @param ctx Scope and database.
 * @param assetId The temporary asset to promote.
 * @param newKind The kind to promote it to.
 */
export async function convertTempAssetToPermanent(
  ctx: FilesCtx,
  assetId: string,
  newKind: AssetKind
): Promise<Result<void, AuxxError>> {
  return guard(
    async () => {
      assertAssetKind(newKind)

      const asset = await ctx.db.query.MediaAsset.findFirst({
        where: and(
          eq(schema.MediaAsset.id, assetId),
          eq(schema.MediaAsset.organizationId, ctx.organizationId)
        ),
      })

      if (!asset || asset.kind !== 'TEMP_UPLOAD') return

      await ctx.db
        .update(schema.MediaAsset)
        .set({ kind: newKind, expiresAt: null })
        .where(
          and(
            eq(schema.MediaAsset.id, assetId),
            eq(schema.MediaAsset.organizationId, ctx.organizationId)
          )
        )
    },
    'Failed to convert temporary asset',
    { assetId, newKind, organizationId: ctx.organizationId }
  )
}

/**
 * Mint a `MediaAsset` that points at the same bytes as an existing file-library row.
 *
 * **Behaviour change:** the legacy `createFromFolderFile` looked the
 * `FolderFile` up by bare id with no organization filter, so any caller holding
 * a file id could mint an asset over another tenant's bytes. The read is
 * org-scoped here, and the resulting asset is owned by `ctx.organizationId`
 * rather than by whatever the file row happened to say.
 *
 * The `skipIfExists` lookup is two statements on purpose: a `where` inside a
 * relational `with` only filters the included rows, never which asset comes
 * back, so the storage-location match has to be part of the asset's own `WHERE`.
 *
 * @param tx The caller's transaction — {@link createAssetWithVersion} needs one.
 * @param ctx Scope. `ctx.db` is ignored.
 * @param deps `now`, for the new asset's `updatedAt` stamp.
 * @param input Which file, which version, and whether to reuse.
 */
export async function createAssetFromFolderFile(
  tx: Transaction,
  ctx: FilesCtx,
  deps: AssetWriteDeps,
  input: CreateAssetFromFolderFileInput
): Promise<Result<MediaAssetEntity, AuxxError>> {
  return guard(
    async () => {
      const file = await tx.query.FolderFile.findFirst({
        where: and(
          eq(schema.FolderFile.id, input.fileId),
          eq(schema.FolderFile.organizationId, ctx.organizationId)
        ),
        with: {
          currentVersion: { with: { storageLocation: true } },
          versions: input.fileVersionId
            ? {
                where: eq(schema.FileVersion.id, input.fileVersionId),
                limit: 1,
                with: { storageLocation: true },
              }
            : undefined,
        },
      })

      if (!file) throw new NotFoundError(`File ${input.fileId} not found`)

      const version =
        input.fileVersionId && file.versions?.[0] ? file.versions[0] : file.currentVersion
      if (!version) throw new NotFoundError(`File ${input.fileId} has no version`)

      if (input.skipIfExists) {
        const existing = await findAssetForStorageLocation(tx, ctx, version.storageLocationId)
        if (existing) return existing
      }

      const created = await createAssetWithVersion(tx, ctx, deps, {
        kind: input.kind ?? 'DOCUMENT',
        purpose: 'ORIGINAL',
        name: file.name,
        mimeType: file.mimeType ?? 'application/octet-stream',
        size: file.size ?? 0,
        isPrivate: true,
        createdById: file.createdById ?? undefined,
        storageLocationId: version.storageLocationId,
      })
      if (created.isErr()) throw created.error

      return created.value.asset
    },
    'Failed to create asset from folder file',
    { fileId: input.fileId, organizationId: ctx.organizationId }
  )
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/** Reject a kind the enum does not know, before it reaches a `text` column. */
function assertAssetKind(kind: AssetKind): void {
  if (!VALID_ASSET_KINDS.includes(kind)) {
    throw new BadRequestError(`Invalid asset kind: ${kind}`)
  }
}

/**
 * The shared `INSERT` body. Takes the client explicitly so
 * {@link createAssetWithVersion} can run it on `tx` without a second `ctx`.
 */
async function insertAsset(
  client: Database | Transaction,
  ctx: FilesCtx,
  deps: AssetWriteDeps,
  input: CreateAssetInput
): Promise<MediaAssetEntity> {
  assertAssetKind(input.kind)

  const [asset] = await client
    .insert(schema.MediaAsset)
    .values({
      kind: input.kind,
      purpose: input.purpose,
      name: input.name,
      mimeType: input.mimeType,
      size: input.size,
      isPrivate: input.isPrivate ?? true,
      createdById: input.createdById,
      expiresAt: input.expiresAt,
      // Scope is the caller's, never the payload's.
      organizationId: ctx.organizationId,
      updatedAt: deps.now(),
    })
    .returning()

  if (!asset) throw new AuxxError('Asset insert returned no row')
  return asset
}

/**
 * Find a live asset in this organization whose current version already points at
 * `storageLocationId`.
 */
async function findAssetForStorageLocation(
  client: Database | Transaction,
  ctx: FilesCtx,
  storageLocationId: string
): Promise<MediaAssetEntity | null> {
  const matchingVersions = await client.query.MediaAssetVersion.findMany({
    where: and(
      eq(schema.MediaAssetVersion.storageLocationId, storageLocationId),
      isNull(schema.MediaAssetVersion.deletedAt)
    ),
    columns: { id: true },
  })
  if (matchingVersions.length === 0) return null

  const existing = await client.query.MediaAsset.findFirst({
    where: and(
      eq(schema.MediaAsset.organizationId, ctx.organizationId),
      isNull(schema.MediaAsset.deletedAt),
      inArray(
        schema.MediaAsset.currentVersionId,
        matchingVersions.map((version) => version.id)
      )
    ),
  })
  return (existing as MediaAssetEntity | undefined) ?? null
}
