// packages/lib/src/files/assets/release-record-assets.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNotNull, isNull, ne, notInArray } from 'drizzle-orm'
import { getAllCachedCustomFields } from '../../cache'

/** Input for {@link releaseRecordFileAssets}. */
export interface ReleaseRecordFileAssetsParams {
  organizationId: string
  /** `EntityInstance` ids about to be hard-deleted; their FieldValue rows must still exist. */
  instanceIds: readonly string[]
  /** The definitions those instances belong to. */
  definitionIds: readonly string[]
  now: Date
}

/**
 * Soft-delete the `MediaAsset`s that only the given records' FILE fields hold, with their
 * thumbnails, and mark every storage location behind them for `reapMarkedStorageLocations`.
 *
 * An asset stays when a surviving record's FILE value names it, or when an `Attachment`
 * other than its own upload session (`CUSTOM_FIELD`, addressed to `field-…`) holds it.
 *
 * @returns how many assets, source and derived, were released.
 */
export async function releaseRecordFileAssets(
  db: Database | Transaction,
  params: ReleaseRecordFileAssetsParams
): Promise<number> {
  const { organizationId, instanceIds, definitionIds, now } = params
  if (instanceIds.length === 0) return 0

  // Most deletes (orders, lines, movements) are of definitions with no FILE field at all.
  const fileFieldIds = (await getAllCachedCustomFields(organizationId))
    .filter(
      (f) =>
        f.type === 'FILE' &&
        f.entityDefinitionId !== null &&
        definitionIds.includes(f.entityDefinitionId)
    )
    .map((f) => f.id)
  if (fileFieldIds.length === 0) return 0

  const held = await db
    .selectDistinct({ assetId: schema.FieldValue.assetId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...instanceIds]),
        inArray(schema.FieldValue.fieldId, fileFieldIds),
        isNotNull(schema.FieldValue.assetId)
      )
    )
  const assetIds = held.map((r) => r.assetId).filter((id): id is string => id !== null)
  if (assetIds.length === 0) return 0

  const sharedByRecords = await db
    .selectDistinct({ assetId: schema.FieldValue.assetId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.assetId, assetIds),
        notInArray(schema.FieldValue.entityId, [...instanceIds])
      )
    )
  const kept = new Set(sharedByRecords.map((r) => r.assetId))
  const candidates = assetIds.filter((id) => !kept.has(id))
  if (candidates.length === 0) return 0

  const attached = await db
    .selectDistinct({ assetId: schema.Attachment.assetId })
    .from(schema.Attachment)
    .where(
      and(
        eq(schema.Attachment.organizationId, organizationId),
        inArray(schema.Attachment.assetId, candidates),
        ne(schema.Attachment.entityType, 'CUSTOM_FIELD')
      )
    )
  const attachedIds = new Set(attached.map((r) => r.assetId))
  return releaseAssets(db, {
    organizationId,
    assetIds: candidates.filter((id) => !attachedIds.has(id)),
    now,
  })
}

/**
 * Soft-delete assets with their thumbnails and mark their storage locations for
 * `reapMarkedStorageLocations`. The caller has already established that nothing holds them.
 *
 * @returns how many assets, source and derived, were released.
 */
export async function releaseAssets(
  db: Database | Transaction,
  params: { organizationId: string; assetIds: readonly string[]; now: Date }
): Promise<number> {
  const { organizationId, now } = params
  const assetIds = [...params.assetIds]
  if (assetIds.length === 0) return 0

  const sources = await db
    .select({
      id: schema.MediaAssetVersion.id,
      location: schema.MediaAssetVersion.storageLocationId,
    })
    .from(schema.MediaAssetVersion)
    .innerJoin(schema.MediaAsset, eq(schema.MediaAsset.id, schema.MediaAssetVersion.assetId))
    .where(
      and(
        eq(schema.MediaAsset.organizationId, organizationId),
        inArray(schema.MediaAssetVersion.assetId, assetIds)
      )
    )
  const thumbnails =
    sources.length === 0
      ? []
      : await db
          .select({
            id: schema.MediaAssetVersion.id,
            assetId: schema.MediaAssetVersion.assetId,
            location: schema.MediaAssetVersion.storageLocationId,
          })
          .from(schema.MediaAssetVersion)
          .where(
            inArray(
              schema.MediaAssetVersion.derivedFromVersionId,
              sources.map((v) => v.id)
            )
          )

  const released = [...new Set([...assetIds, ...thumbnails.map((t) => t.assetId)])]
  const versionIds = [...sources, ...thumbnails].map((v) => v.id)
  const touched = [...sources, ...thumbnails]
    .map((v) => v.location)
    .filter((id): id is string => id !== null)
  // A location another, surviving version still reads is not ours to reap.
  const sharedLocations =
    touched.length === 0
      ? []
      : await db
          .selectDistinct({ id: schema.MediaAssetVersion.storageLocationId })
          .from(schema.MediaAssetVersion)
          .where(
            and(
              inArray(schema.MediaAssetVersion.storageLocationId, touched),
              notInArray(schema.MediaAssetVersion.id, versionIds)
            )
          )
  const shared = new Set(sharedLocations.map((r) => r.id))
  const locationIds = [...new Set(touched)].filter((id) => !shared.has(id))

  await db
    .update(schema.MediaAsset)
    .set({ deletedAt: now })
    .where(
      and(
        eq(schema.MediaAsset.organizationId, organizationId),
        inArray(schema.MediaAsset.id, released),
        isNull(schema.MediaAsset.deletedAt)
      )
    )
  if (versionIds.length > 0) {
    await db
      .update(schema.MediaAssetVersion)
      .set({ deletedAt: now })
      .where(
        and(
          inArray(schema.MediaAssetVersion.id, versionIds),
          isNull(schema.MediaAssetVersion.deletedAt)
        )
      )
  }
  if (locationIds.length > 0) {
    await db
      .update(schema.StorageLocation)
      .set({ deletedAt: now })
      .where(
        and(
          eq(schema.StorageLocation.organizationId, organizationId),
          inArray(schema.StorageLocation.id, locationIds),
          isNull(schema.StorageLocation.deletedAt)
        )
      )
  }

  return released.length
}
