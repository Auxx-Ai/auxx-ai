// @auxx/lib/kb/internal/resolve-cover-urls.ts

/**
 * Resolving article cover-image asset ids to URLs, fresh on every read.
 *
 * Public assets return their durable `externalUrl`; private ones return a
 * freshly-signed presigned URL. Nothing is cached — a presigned URL baked into a
 * cached payload 403s the moment its signature lapses.
 *
 * ## The batch read is THREE statements, and must stay that way
 *
 * {@link resolveCoverUrls} issues one query for the assets and at most two for
 * their versions, then resolves every row through `resolveAssetDownloadRef` with
 * **no further database access**. The obvious simplification —
 * `getAssetDownloadRef` once per id — re-reads the asset and its version per
 * cover, turning three statements into `3N` on a list payload that renders every
 * article in a knowledge base. That regression was recorded in PR 5a's retro,
 * and `resolveAssetDownloadRef` is exported precisely so this caller can share
 * the URL policy without paying for the reads again. `apps/kb/src/server/kb-data.ts`
 * is the same shape, deliberately.
 *
 * ## Both functions swallow failures
 *
 * A missing, deleted, cross-organization, or bucket-less cover resolves to
 * `null`. That is inherited from `MediaAssetService.getDownloadUrl`, which
 * returned `null` on every failure: this fills an image URL into a list payload,
 * and one broken row must not fail the page.
 */

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type { MediaAssetEntity } from '@auxx/database/types'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { FilesCtx, FilesDeps, VersionWithLocation } from '../../files/server'

type Db = Database | Transaction

/**
 * Module-level cache of S3 storage ports keyed by organization.
 *
 * The port closes over the one cached S3 adapter (and therefore its `S3Client`
 * cache), so building one per request would allocate a fresh closure set on
 * every KB read. Keyed by organization only — unlike the `MediaAssetService`
 * cache this replaces, it holds no database handle, because the functional
 * reads take `ctx.db` per call.
 */
const ports = new Map<string, FilesDeps['storage']>()

/**
 * Load the port lazily.
 *
 * Dynamic import so client-bundled call sites of the kb module do not pull in
 * `files/server`'s server-only dependencies (bullmq, sharp). This is the same
 * reason the `MediaAssetService` import it replaces was dynamic.
 */
async function getStoragePort(organizationId: string): Promise<FilesDeps['storage']> {
  const cached = ports.get(organizationId)
  if (cached) return cached
  const { createS3StoragePort } = await import('../../files/server')
  const port = createS3StoragePort(organizationId)
  ports.set(organizationId, port)
  return port
}

/**
 * Resolve a single cover asset id to a URL.
 *
 * Two statements (the asset, then its current version), which is what
 * `getAssetDownloadRef` costs. Prefer {@link resolveCoverUrls} whenever more
 * than one id is in hand.
 */
export async function resolveCoverUrl(
  db: Db,
  organizationId: string,
  coverImageId: string | null | undefined
): Promise<string | null> {
  if (!coverImageId) return null
  try {
    const { getAssetDownloadRef } = await import('../../files/server')
    const ctx: FilesCtx = { db, organizationId }
    const result = await getAssetDownloadRef(
      ctx,
      { storage: await getStoragePort(organizationId) },
      coverImageId
    )
    if (result.isErr()) return null
    return result.value.type === 'url' ? result.value.url : null
  } catch {
    return null
  }
}

/**
 * Batch-resolve cover URLs in a fixed number of statements.
 *
 * De-duplicates ids and returns a `Map` keyed by id, so an asset shared across a
 * draft and its published revision resolves once. Every requested id is present
 * in the result, `null` where it could not be resolved.
 *
 * @param db Pool or transaction. Every statement below runs on it.
 * @param organizationId Scope. Both the asset read and the port are bound to it.
 * @param ids Cover ids, possibly with nulls and duplicates.
 */
export async function resolveCoverUrls(
  db: Db,
  organizationId: string,
  ids: Array<string | null | undefined>
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  const unique = Array.from(new Set(ids.filter((id): id is string => !!id)))
  if (unique.length === 0) return result

  try {
    const { resolveAssetDownloadRef } = await import('../../files/server')

    // 1 — the assets, organization-scoped and live.
    const assets = (await db.query.MediaAsset.findMany({
      where: and(
        inArray(schema.MediaAsset.id, unique),
        eq(schema.MediaAsset.organizationId, organizationId),
        isNull(schema.MediaAsset.deletedAt)
      ),
    })) as MediaAssetEntity[]

    // 2 and 3 — every asset's current version: one query by explicit
    // `currentVersionId`, one by `assetId` (latest first) for assets without
    // one. The two branches are the same `currentVersionId`-then-highest-number
    // resolution `loadCurrentVersion` performs per asset, batched.
    const withCurrent = assets.filter((asset) => asset.currentVersionId)
    const withoutCurrent = assets.filter((asset) => !asset.currentVersionId)
    const [byId, byAsset] = await Promise.all([
      withCurrent.length
        ? db.query.MediaAssetVersion.findMany({
            where: inArray(
              schema.MediaAssetVersion.id,
              withCurrent.map((asset) => asset.currentVersionId as string)
            ),
            with: { storageLocation: true },
          })
        : Promise.resolve([]),
      withoutCurrent.length
        ? db.query.MediaAssetVersion.findMany({
            where: inArray(
              schema.MediaAssetVersion.assetId,
              withoutCurrent.map((asset) => asset.id)
            ),
            orderBy: desc(schema.MediaAssetVersion.versionNumber),
            with: { storageLocation: true },
          })
        : Promise.resolve([]),
    ])

    const versionById = new Map<string, VersionWithLocation>()
    for (const version of byId as VersionWithLocation[]) versionById.set(version.id, version)
    const latestByAsset = new Map<string, VersionWithLocation>()
    for (const version of byAsset as VersionWithLocation[]) {
      // Ordered by version desc, so the first seen per asset is the latest.
      if (!latestByAsset.has(version.assetId)) latestByAsset.set(version.assetId, version)
    }

    // No database access past this point — that is what keeps the read at three
    // statements instead of 3N.
    const deps = { storage: await getStoragePort(organizationId) }
    await Promise.all(
      assets.map(async (asset) => {
        const version = asset.currentVersionId
          ? versionById.get(asset.currentVersionId)
          : latestByAsset.get(asset.id)
        if (!version) {
          result.set(asset.id, null)
          return
        }
        try {
          const ref = await resolveAssetDownloadRef(deps, asset, version)
          result.set(asset.id, ref.type === 'url' ? ref.url : null)
        } catch {
          result.set(asset.id, null)
        }
      })
    )
  } catch {
    // A failure before the fan-out (the dynamic import, the asset read) must not
    // fail the page either.
  }

  for (const id of unique) if (!result.has(id)) result.set(id, null)
  return result
}
