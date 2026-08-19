// packages/lib/src/files/core/media-asset-purge.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { sql } from 'drizzle-orm'

type DbHandle = Database | Transaction

/**
 * Expand a set of MediaAssets to include every asset derived from them, transitively.
 *
 * A thumbnail or preview is its own `MediaAsset` (`kind: THUMBNAIL`, `purpose: DERIVED`),
 * tied to its source only by `MediaAssetVersion.derivedFromVersionId` — a self-FK with
 * `onUpdate: cascade` and no `onDelete`, i.e. NO ACTION. It carries no `Attachment` row,
 * so nothing that walks attachments ever sees it, and deleting a source without it raises
 * FK 23503.
 */
export async function expandDerivedAssetIds(db: DbHandle, assetIds: string[]): Promise<string[]> {
  if (assetIds.length === 0) return []

  const result = await db.execute(sql`
    WITH RECURSIVE closure AS (
      SELECT v."id", v."assetId"
      FROM ${schema.MediaAssetVersion} v
      WHERE v."assetId" IN (${sql.join(
        assetIds.map((id) => sql`${id}`),
        sql`, `
      )})
      UNION
      SELECT c."id", c."assetId"
      FROM ${schema.MediaAssetVersion} c
      JOIN closure p ON c."derivedFromVersionId" = p."id"
    )
    SELECT DISTINCT "assetId" FROM closure
  `)

  const ids = new Set(assetIds)
  for (const row of (result.rows ?? []) as { assetId: string }[]) ids.add(row.assetId)
  return [...ids]
}

/**
 * Hard-delete MediaAssets together with everything derived from them.
 *
 * 🔴 The whole closure goes in ONE statement. NO ACTION is checked at statement end, so a
 * delete that covers both the referencing and referenced rows passes, while deleting the
 * source alone — or paging the closure across statements — raises 23503.
 *
 * Storage is marked rather than deleted: `MediaAssetVersion.storageLocationId` is
 * `ON DELETE CASCADE`, so the versions vanish with the assets and an unmarked
 * `StorageLocation` becomes an S3 object nothing will ever reap. Callers that delete S3
 * inline (see `cleanupAssetThumbnails`) just re-mark rows that are already gone.
 *
 * Returns the full set of purged asset ids, derived ones included.
 */
export async function purgeMediaAssets(db: DbHandle, assetIds: string[]): Promise<string[]> {
  const closure = await expandDerivedAssetIds(db, assetIds)
  if (closure.length === 0) return []

  const idList = sql.join(
    closure.map((id) => sql`${id}`),
    sql`, `
  )

  await db.execute(sql`
    UPDATE ${schema.StorageLocation} SET "deletedAt" = now()
    WHERE "deletedAt" IS NULL
      AND "id" IN (
        SELECT v."storageLocationId"
        FROM ${schema.MediaAssetVersion} v
        WHERE v."assetId" IN (${idList}) AND v."storageLocationId" IS NOT NULL
      )
  `)

  await db.execute(sql`DELETE FROM ${schema.MediaAsset} WHERE "id" IN (${idList})`)

  return closure
}
