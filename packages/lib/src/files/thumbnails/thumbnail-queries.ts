// packages/lib/src/files/thumbnails/thumbnail-queries.ts

/**
 * Thumbnail reads.
 *
 * Writes live in `thumbnails/thumbnail-mutations.ts` and the sweeps in
 * `thumbnails/cleanup.ts` — `docs/lib-module-guide.md` §5, "a file that both
 * queries and mutates is the first step back toward a service class".
 *
 * ## A thumbnail is a `MediaAssetVersion`, not a table of its own
 *
 * There is no `Thumbnail` table. A thumbnail is a `MediaAssetVersion` whose
 * `derivedFromVersionId` points at the source version and whose `preset` names
 * the rendering, hanging off its own `MediaAsset` with `kind = 'THUMBNAIL'` /
 * `purpose = 'DERIVED'`. That is why a delete expands the closure: dropping a
 * source asset means dropping N *other* assets
 * (`docs/files-upload-architecture-guide.md`).
 *
 * ## Why the lookups are keyed by version rather than by organization
 *
 * `MediaAssetVersion` carries no `organizationId` column — the scope lives on
 * its `MediaAsset`. A version-keyed read is therefore either one index hit on
 * `idx_unique_thumbnail (derivedFromVersionId, preset)` or a join, and these
 * take the index hit: every caller reaches them with a `sourceVersionId` it
 * resolved through an org-scoped asset read in the first place.
 *
 * {@link loadThumbnailsForSource} is the exception and joins anyway, because it
 * feeds a **delete**. There the caller's id is the only thing standing between a
 * sweep and another tenant's rows, and "the caller checked" is not a property
 * this file can see.
 */

import { schema } from '@auxx/database'
import type { MediaAssetVersionEntity, StorageLocationEntity } from '@auxx/database/types'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { NotFoundError } from '../../errors'
import type { FilesCtx } from '../ctx'
import { guard } from './guard'
import type { PresetKey } from './presets'

/** A thumbnail version with everything a delete needs to reach its bytes. */
export interface ThumbnailWithLocation {
  versionId: string
  assetId: string
  preset: string | null
  size: number | null
  /** `null` when the version never reached `READY` — a stranded placeholder. */
  locationId: string | null
  locationProvider: StorageLocationEntity['provider'] | null
  locationExternalId: string | null
  locationMetadata: StorageLocationEntity['metadata'] | null
  locationCredentialId: string | null
  /** Decides which platform bucket a location with no recorded bucket lived in. */
  assetIsPrivate: boolean | null
}

/** What a resolved thumbnail source hands to the enqueuer. */
export interface ResolvedThumbnailSource {
  /** The `MediaAssetVersion` the thumbnail derives from. */
  versionId: string
  /** Inherited from the source asset unless the caller overrides it. */
  visibility: 'PUBLIC' | 'PRIVATE'
}

/**
 * The one live thumbnail for a source version and preset, or `null`.
 *
 * Matches `idx_unique_thumbnail`, the partial unique index on
 * `(derivedFromVersionId, preset) WHERE derivedFromVersionId IS NOT NULL AND
 * deletedAt IS NULL`, so this is a single index probe and can match at most one
 * row by construction.
 *
 * Throws rather than returning `Result`: it is the shared helper both
 * {@link findThumbnailByVersionAndPreset} and the write path use, and the write
 * path is already inside a guard.
 */
export async function loadThumbnail(
  ctx: FilesCtx,
  sourceVersionId: string,
  preset: PresetKey
): Promise<MediaAssetVersionEntity | null> {
  const thumbnail = await ctx.db.query.MediaAssetVersion.findFirst({
    where: and(
      eq(schema.MediaAssetVersion.derivedFromVersionId, sourceVersionId),
      eq(schema.MediaAssetVersion.preset, preset),
      isNull(schema.MediaAssetVersion.deletedAt)
    ),
  })

  return (thumbnail as MediaAssetVersionEntity | undefined) ?? null
}

/**
 * {@link loadThumbnail} at the `Result` boundary, for callers outside this module.
 *
 * @param ctx Scope and database. Runs unchanged on a pool or inside a transaction.
 * @param sourceVersionId The `MediaAssetVersion` the thumbnail derives from.
 * @param preset Which rendering to look for.
 */
export async function findThumbnailByVersionAndPreset(
  ctx: FilesCtx,
  sourceVersionId: string,
  preset: PresetKey
): Promise<Result<MediaAssetVersionEntity | null, AuxxError>> {
  return guard(
    async () => loadThumbnail(ctx, sourceVersionId, preset),
    'Failed to find thumbnail by version and preset',
    { sourceVersionId, preset, organizationId: ctx.organizationId }
  )
}

/**
 * Every live thumbnail derived from one source version, in this organization.
 *
 * Two filters here are **new**, and both are deliberate:
 *
 * - **Organization scope.** The legacy `deleteThumbnailsForSource` selected on
 *   `derivedFromVersionId` alone and then soft-deleted whatever came back, so a
 *   foreign version id would have swept another tenant's rows. No caller could
 *   reach it that way, but the same was true of the three unscoped paths PR 5a
 *   closed.
 * - **`kind = 'THUMBNAIL' OR purpose = 'DERIVED'`.** `processThumbnailDeletions`
 *   in `cleanup.ts` has always refused to delete a row failing that test, and
 *   called it a "CRITICAL SAFETY CHECK"; the delete path in the same class did
 *   not apply it at all. One of the two was wrong, and it was not the one with
 *   the safety check.
 *
 * Flat projection rather than a relational `with`: the `makeDb` stub does not
 * interpret joins, and a flat alias list is also what keeps the column set
 * visible at the call site.
 *
 * Throws — the callers are inside a guard.
 */
export async function loadThumbnailsForSource(
  ctx: FilesCtx,
  sourceVersionId: string
): Promise<ThumbnailWithLocation[]> {
  return ctx.db
    .select({
      versionId: schema.MediaAssetVersion.id,
      assetId: schema.MediaAssetVersion.assetId,
      preset: schema.MediaAssetVersion.preset,
      size: schema.MediaAssetVersion.size,
      locationId: schema.StorageLocation.id,
      locationProvider: schema.StorageLocation.provider,
      locationExternalId: schema.StorageLocation.externalId,
      locationMetadata: schema.StorageLocation.metadata,
      locationCredentialId: schema.StorageLocation.credentialId,
      assetIsPrivate: schema.MediaAsset.isPrivate,
    })
    .from(schema.MediaAssetVersion)
    .innerJoin(schema.MediaAsset, eq(schema.MediaAsset.id, schema.MediaAssetVersion.assetId))
    .leftJoin(
      schema.StorageLocation,
      eq(schema.StorageLocation.id, schema.MediaAssetVersion.storageLocationId)
    )
    .where(
      and(
        eq(schema.MediaAssetVersion.derivedFromVersionId, sourceVersionId),
        isNull(schema.MediaAssetVersion.deletedAt),
        eq(schema.MediaAsset.organizationId, ctx.organizationId),
        or(eq(schema.MediaAsset.kind, 'THUMBNAIL'), eq(schema.MediaAsset.purpose, 'DERIVED'))
      )
    ) as Promise<ThumbnailWithLocation[]>
}

/**
 * Resolve a `{ type: 'asset' }` source to its version and inherited visibility.
 *
 * Org-scoped, and an explicit `assetVersionId` is taken at face value only after
 * the asset itself has been matched in this organization — the same shape
 * `assets/download.ts` uses.
 *
 * Throws — the caller is inside a guard.
 *
 * @throws {NotFoundError} when the asset is missing in this org, or has no version.
 */
export async function loadAssetSource(
  ctx: FilesCtx,
  assetId: string,
  assetVersionId?: string
): Promise<ResolvedThumbnailSource> {
  const asset = await ctx.db.query.MediaAsset.findFirst({
    where: and(
      eq(schema.MediaAsset.id, assetId),
      eq(schema.MediaAsset.organizationId, ctx.organizationId),
      isNull(schema.MediaAsset.deletedAt)
    ),
    columns: { id: true, currentVersionId: true, isPrivate: true },
  })

  if (!asset) throw new NotFoundError(`Asset ${assetId} not found`)

  const versionId = assetVersionId ?? asset.currentVersionId
  if (!versionId) throw new NotFoundError(`Asset ${assetId} has no current version`)

  return { versionId, visibility: asset.isPrivate ? 'PRIVATE' : 'PUBLIC' }
}

/** The joined `Attachment` shape {@link loadAttachmentSource} reads. */
export interface AttachmentThumbnailSource {
  assetId: string | null
  assetVersionId: string | null
  fileId: string | null
  fileVersionId: string | null
  asset: { isPrivate: boolean; currentVersionId: string | null } | null
  /** A pinned `FileVersion`, when `fileVersionId` is set. */
  fileVersion: FileVersionForConversion | null
  /** The file's current version, used when nothing is pinned. */
  file: { currentVersion: FileVersionForConversion | null } | null
}

/** The `FileVersion` columns a file-to-asset conversion needs. */
export interface FileVersionForConversion {
  mimeType: string | null
  size: number | null
  storageLocationId: string | null
}

/**
 * Load an attachment with everything the four-step version resolution needs.
 *
 * Org-scoped. The four steps themselves live in `thumbnail-mutations.ts`,
 * because two of them can *write* (a `FolderFile` has to be converted into a
 * `MediaAsset` before it can carry a derived version), and a file that both
 * queries and mutates is what this split exists to prevent.
 *
 * Throws — the caller is inside a guard.
 *
 * @throws {NotFoundError} when the attachment is missing in this organization.
 */
export async function loadAttachmentSource(
  ctx: FilesCtx,
  attachmentId: string
): Promise<AttachmentThumbnailSource> {
  const attachment = await ctx.db.query.Attachment.findFirst({
    where: and(
      eq(schema.Attachment.id, attachmentId),
      eq(schema.Attachment.organizationId, ctx.organizationId)
    ),
    columns: { assetId: true, assetVersionId: true, fileId: true, fileVersionId: true },
    with: {
      asset: { columns: { isPrivate: true, currentVersionId: true } },
      file: {
        columns: { id: true },
        with: {
          currentVersion: {
            columns: { mimeType: true, size: true, storageLocationId: true },
          },
        },
      },
      fileVersion: { columns: { mimeType: true, size: true, storageLocationId: true } },
    },
  })

  if (!attachment) throw new NotFoundError(`Attachment ${attachmentId} not found`)
  return attachment as unknown as AttachmentThumbnailSource
}

/**
 * Find a live `MediaAsset` in this organization whose current version already
 * points at `storageLocationId`.
 *
 * This is how a `FolderFile` → `MediaAsset` conversion is deduplicated:
 * `MediaAsset` has no metadata column to key the conversion on, so the shared
 * storage location *is* the identity.
 *
 * Two statements on purpose — a `where` inside a relational `with` filters only
 * the included rows, never which asset comes back, so the location match has to
 * be part of the asset's own predicate.
 *
 * Throws — the caller is inside a guard.
 */
export async function findConvertedAssetForLocation(
  ctx: FilesCtx,
  storageLocationId: string
): Promise<{ id: string; currentVersionId: string } | null> {
  const [existing] = await ctx.db
    .select({
      id: schema.MediaAsset.id,
      currentVersionId: schema.MediaAsset.currentVersionId,
    })
    .from(schema.MediaAsset)
    .innerJoin(
      schema.MediaAssetVersion,
      eq(schema.MediaAssetVersion.id, schema.MediaAsset.currentVersionId)
    )
    .where(
      and(
        eq(schema.MediaAsset.organizationId, ctx.organizationId),
        eq(schema.MediaAsset.kind, 'FILE_CONVERSION'),
        isNull(schema.MediaAsset.deletedAt),
        eq(schema.MediaAssetVersion.storageLocationId, storageLocationId),
        isNull(schema.MediaAssetVersion.deletedAt)
      )
    )
    .limit(1)

  if (!existing?.currentVersionId) return null
  return { id: existing.id, currentVersionId: existing.currentVersionId }
}
