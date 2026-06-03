// @auxx/lib/kb/internal/resolve-cover-urls.ts
import type { Database, Transaction } from '@auxx/database'

type Db = Database | Transaction

type AssetService = {
  getDownloadUrl: (id: string) => Promise<string | null>
  getDownloadUrls: (ids: string[]) => Promise<Map<string, string | null>>
}

/**
 * Module-level cache of MediaAssetService instances keyed by org+db. Imported
 * dynamically so client-bundled call sites of the kb module don't pull in
 * server-only deps. One instance per (orgId, db) covers both the singleton
 * `database` and transaction-scoped handles.
 */
const cache = new WeakMap<Db, Map<string, AssetService>>()

async function getAssetService(db: Db, organizationId: string): Promise<AssetService> {
  let perDb = cache.get(db)
  if (!perDb) {
    perDb = new Map()
    cache.set(db, perDb)
  }
  const cached = perDb.get(organizationId)
  if (cached) return cached
  const { MediaAssetService } = await import('../../files/server')
  const svc = new MediaAssetService(organizationId, undefined, db as Database)
  perDb.set(organizationId, svc)
  return svc
}

/**
 * Resolve a cover MediaAsset id to a URL fresh on every read. Public assets
 * return their durable externalUrl; private assets return a freshly-signed
 * presigned URL. Returns null when the id is null/missing or the asset has
 * been deleted.
 */
export async function resolveCoverUrl(
  db: Db,
  organizationId: string,
  coverImageId: string | null | undefined
): Promise<string | null> {
  if (!coverImageId) return null
  try {
    const assetService = await getAssetService(db, organizationId)
    return await assetService.getDownloadUrl(coverImageId)
  } catch {
    return null
  }
}

/**
 * Batch-resolve cover URLs for a list of ids. De-duplicates ids and returns
 * a Map keyed by id so a single asset shared across draft+published renders
 * to one resolution.
 */
export async function resolveCoverUrls(
  db: Db,
  organizationId: string,
  ids: Array<string | null | undefined>
): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => !!id)))
  if (unique.length === 0) return new Map()
  try {
    const assetService = await getAssetService(db, organizationId)
    return await assetService.getDownloadUrls(unique)
  } catch {
    return new Map(unique.map((id) => [id, null]))
  }
}
