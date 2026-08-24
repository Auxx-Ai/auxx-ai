// packages/lib/src/files/assets/asset-queries.ts

/**
 * `MediaAsset` reads.
 *
 * Split from `assets/asset-mutations.ts` and `assets/version-mutations.ts` per
 * `docs/lib-module-guide.md` §5 — "a file that both queries and mutates is the
 * first step back toward a service class", which is precisely how
 * `core/media-asset-service.ts` reached 1,540 lines.
 *
 * ## Every read here is organization-scoped, unconditionally
 *
 * `MediaAssetService` scoped with `if (this.organizationId)`, so a service
 * constructed without one — and several production sites do exactly that —
 * silently widened every query to every tenant. `FilesCtx.organizationId` is
 * required, so the filter is not conditional any more.
 *
 * `MediaAsset.organizationId` is `NOT NULL`, so an `eq(...)` filter hides no
 * rows here; there is no nullable-scope trap of the kind `StorageLocation` had.
 *
 * ## Versions are scoped through their asset, never directly
 *
 * `MediaAssetVersion` carries no `organizationId` — its only tenant link is
 * `assetId`. So every version read below first resolves the asset through
 * {@link getAsset} (which is org-scoped) and constrains on `assetId`. The legacy
 * `getLatestVersion` skipped that step and queried versions by bare `assetId`,
 * which returned another tenant's version to anyone holding the id.
 */

import { schema } from '@auxx/database'
import type {
  MediaAssetEntity,
  MediaAssetVersionEntity,
  StorageLocationEntity,
} from '@auxx/database/types'
import { and, asc, desc, eq, isNull, lt, type SQL } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { NotFoundError } from '../../errors'
import type { AssetKind, MediaAssetWithRelations } from '../core/types'
import type { FilesCtx } from '../ctx'
import { guard, unwrap } from '../guard'

/**
 * A version row with its `StorageLocation` joined in.
 *
 * Every consumer of a version in this module wants the location too (to
 * presign, to copy, to purge), so the joined shape is the default rather than a
 * second round-trip per caller.
 */
export type AssetVersionWithLocation = MediaAssetVersionEntity & {
  storageLocation: StorageLocationEntity | null
}

/**
 * Knobs for {@link listAssets}.
 *
 * Deliberately a closed set of filters instead of the legacy `filters?: any`,
 * which was fed through a `getTableColumns(schema.MediaAsset)` lookup so any
 * string key became a `WHERE`. That map is also what forced the memoised static
 * getter on `MediaAssetService` (a static initializer ran `getTableColumns` at
 * module evaluation and killed unrelated test files at collection). A closed
 * union deletes both the injection surface and the hazard.
 */
export interface ListAssetsOptions {
  kind?: AssetKind
  isPrivate?: boolean
  limit?: number
  offset?: number
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'size'
  sortOrder?: 'asc' | 'desc'
  includeDeleted?: boolean
}

/**
 * One page of assets.
 *
 * `total` is the size of the page, not a count of matching rows — inherited
 * verbatim from `MediaAssetService.list`, which never issued a count query. It
 * is preserved rather than fixed because changing it here would be a silent
 * semantic change under cover of a refactor; `hasMore` is what callers should
 * read.
 */
export interface AssetPage {
  items: MediaAssetEntity[]
  total: number
  hasMore: boolean
}

const SORT_COLUMNS = {
  createdAt: schema.MediaAsset.createdAt,
  updatedAt: schema.MediaAsset.updatedAt,
  name: schema.MediaAsset.name,
  size: schema.MediaAsset.size,
} as const

/**
 * Load one live asset, scoped to the caller's organization.
 *
 * Returns `ok(null)` when the asset does not exist, is soft-deleted, or belongs
 * to another organization — the three collapse into one answer so a caller
 * cannot probe for ids outside its tenant.
 *
 * @param ctx Scope and database. Runs unchanged on a pool or inside a caller's
 *   transaction, because `FilesCtx.db` is `Database | Transaction`.
 * @param assetId The `MediaAsset.id` to load.
 */
export async function getAsset(
  ctx: FilesCtx,
  assetId: string
): Promise<Result<MediaAssetEntity | null, AuxxError>> {
  return guard(
    async () => {
      const asset = await ctx.db.query.MediaAsset.findFirst({
        where: and(
          eq(schema.MediaAsset.id, assetId),
          eq(schema.MediaAsset.organizationId, ctx.organizationId),
          isNull(schema.MediaAsset.deletedAt)
        ),
      })
      return (asset as MediaAssetEntity | undefined) ?? null
    },
    'Failed to get asset',
    { assetId, organizationId: ctx.organizationId }
  )
}

/**
 * Load one live asset with its versions, attachments and creator populated.
 *
 * The relation set matches `MediaAssetService.getRelationIncludes` exactly —
 * current version (with location), all versions newest-first (with location),
 * attachments, and the creator's id/name/email. Callers that only need the row
 * should use {@link getAsset}: this issues a considerably wider query.
 */
export async function getAssetWithRelations(
  ctx: FilesCtx,
  assetId: string
): Promise<Result<MediaAssetWithRelations | null, AuxxError>> {
  return guard(
    async () => {
      const asset = await ctx.db.query.MediaAsset.findFirst({
        where: and(
          eq(schema.MediaAsset.id, assetId),
          eq(schema.MediaAsset.organizationId, ctx.organizationId),
          isNull(schema.MediaAsset.deletedAt)
        ),
        with: {
          currentVersion: { with: { storageLocation: true } },
          versions: {
            with: { storageLocation: true },
            orderBy: desc(schema.MediaAssetVersion.versionNumber),
          },
          attachments: true,
          createdBy: { columns: { id: true, name: true, email: true } },
        },
      })
      return (asset as MediaAssetWithRelations | undefined) ?? null
    },
    'Failed to get asset with relations',
    { assetId, organizationId: ctx.organizationId }
  )
}

/**
 * List assets in the caller's organization.
 *
 * @param ctx Scope and database.
 * @param options Filters, paging and sort. See {@link ListAssetsOptions} for why
 *   the filter set is closed rather than an arbitrary column map.
 */
export async function listAssets(
  ctx: FilesCtx,
  options: ListAssetsOptions = {}
): Promise<Result<AssetPage, AuxxError>> {
  return guard(
    async () => {
      const filters: SQL[] = [eq(schema.MediaAsset.organizationId, ctx.organizationId)]
      if (!options.includeDeleted) filters.push(isNull(schema.MediaAsset.deletedAt))
      if (options.kind) filters.push(eq(schema.MediaAsset.kind, options.kind))
      if (options.isPrivate !== undefined) {
        filters.push(eq(schema.MediaAsset.isPrivate, options.isPrivate))
      }

      const sortColumn = SORT_COLUMNS[options.sortBy ?? 'createdAt']
      const limit = options.limit ?? 50

      const items = (await ctx.db.query.MediaAsset.findMany({
        where: and(...filters),
        limit,
        offset: options.offset ?? 0,
        orderBy: options.sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn),
      })) as MediaAssetEntity[]

      return { items, total: items.length, hasMore: items.length === limit }
    },
    'Failed to list assets',
    { organizationId: ctx.organizationId }
  )
}

/**
 * All live assets of one kind in the organization, newest first.
 */
export async function findAssetsByKind(
  ctx: FilesCtx,
  kind: AssetKind
): Promise<Result<MediaAssetEntity[], AuxxError>> {
  return guard(
    async () => {
      const assets = await ctx.db.query.MediaAsset.findMany({
        where: and(
          eq(schema.MediaAsset.organizationId, ctx.organizationId),
          isNull(schema.MediaAsset.deletedAt),
          eq(schema.MediaAsset.kind, kind)
        ),
        orderBy: desc(schema.MediaAsset.createdAt),
      })
      return assets as MediaAssetEntity[]
    },
    'Failed to find assets by kind',
    { kind, organizationId: ctx.organizationId }
  )
}

/**
 * Temporary uploads created before `createdBefore`, oldest first — the cleanup
 * job's input.
 *
 * The cutoff arrives as a `Date` rather than the legacy `maxAgeHours = 24`,
 * which computed `new Date(Date.now() - …)` inside the query. Reading the clock
 * inside a read makes the function untestable without fake timers; the caller
 * owns `now` (`FilesDeps.now`) and hands the instant in.
 *
 * @param ctx Scope and database.
 * @param createdBefore Exclusive upper bound on `createdAt`.
 * @param kind Which kind to sweep. Defaults to `TEMP_UPLOAD`, the only kind the
 *   legacy method looked at.
 */
export async function findExpiredAssets(
  ctx: FilesCtx,
  createdBefore: Date,
  kind: AssetKind = 'TEMP_UPLOAD'
): Promise<Result<MediaAssetEntity[], AuxxError>> {
  return guard(
    async () => {
      const assets = await ctx.db.query.MediaAsset.findMany({
        where: and(
          eq(schema.MediaAsset.organizationId, ctx.organizationId),
          isNull(schema.MediaAsset.deletedAt),
          eq(schema.MediaAsset.kind, kind),
          lt(schema.MediaAsset.createdAt, createdBefore)
        ),
        orderBy: asc(schema.MediaAsset.createdAt),
      })
      return assets as MediaAssetEntity[]
    },
    'Failed to find expired assets',
    { kind, createdBefore, organizationId: ctx.organizationId }
  )
}

/**
 * Resolve the current version of an asset, with its storage location.
 *
 * Prefers the asset's explicit `currentVersionId` and falls back to the highest
 * `versionNumber` when the pointer is null — the same two-branch resolution
 * `assets/download.ts` performs, kept identical so a download and a content read
 * can never disagree about which bytes are current.
 *
 * Returns `ok(null)` when the asset has no version at all. Throws
 * `NotFoundError` when the *asset* is missing, because "which version is current
 * for an asset that does not exist" has no null answer worth returning.
 */
export async function getAssetCurrentVersion(
  ctx: FilesCtx,
  assetId: string
): Promise<Result<AssetVersionWithLocation | null, AuxxError>> {
  return guard(async () => {
    const asset = await requireAsset(ctx, assetId)
    return loadCurrentVersion(ctx, asset)
  }, 'Failed to get current asset version')
}

/**
 * Every version of an asset, newest version number first, locations joined in.
 */
export async function getAssetVersions(
  ctx: FilesCtx,
  assetId: string
): Promise<Result<AssetVersionWithLocation[], AuxxError>> {
  return guard(async () => {
    await requireAsset(ctx, assetId)
    const versions = await ctx.db.query.MediaAssetVersion.findMany({
      where: eq(schema.MediaAssetVersion.assetId, assetId),
      with: { storageLocation: true },
      orderBy: desc(schema.MediaAssetVersion.versionNumber),
    })
    return versions as AssetVersionWithLocation[]
  }, 'Failed to list asset versions')
}

/**
 * One version of an asset by its human-facing version *number*.
 *
 * Note the two id spaces: `versionNumber` is the 1-based counter shown in the
 * UI, while `MediaAssetVersion.id` is a cuid. `assets/download.ts` addresses
 * versions by id; this addresses them by number, and the two must not be
 * confused at a call site.
 */
export async function getAssetVersionByNumber(
  ctx: FilesCtx,
  assetId: string,
  versionNumber: number
): Promise<Result<AssetVersionWithLocation | null, AuxxError>> {
  return guard(async () => {
    await requireAsset(ctx, assetId)
    const version = await ctx.db.query.MediaAssetVersion.findFirst({
      where: and(
        eq(schema.MediaAssetVersion.assetId, assetId),
        eq(schema.MediaAssetVersion.versionNumber, versionNumber)
      ),
      with: { storageLocation: true },
    })
    return (version as AssetVersionWithLocation | undefined) ?? null
  }, 'Failed to get asset version')
}

/**
 * The highest-numbered version of an asset, regardless of `currentVersionId`.
 *
 * **Behaviour change:** the legacy `getLatestVersion` queried
 * `MediaAssetVersion` by bare `assetId` and never loaded the asset, so it had no
 * organization filter anywhere in the statement. This resolves the asset first,
 * so a version belonging to another tenant is simply not reachable.
 */
export async function getLatestAssetVersion(
  ctx: FilesCtx,
  assetId: string
): Promise<Result<AssetVersionWithLocation | null, AuxxError>> {
  return guard(async () => {
    await requireAsset(ctx, assetId)
    const version = await ctx.db.query.MediaAssetVersion.findFirst({
      where: eq(schema.MediaAssetVersion.assetId, assetId),
      with: { storageLocation: true },
      orderBy: desc(schema.MediaAssetVersion.versionNumber),
    })
    return (version as AssetVersionWithLocation | undefined) ?? null
  }, 'Failed to get latest asset version')
}

/**
 * Which version to serve, by the 1-based counter the UI shows or by one of the
 * two words that follow a pointer.
 *
 * `'current'` follows `MediaAsset.currentVersionId` (falling back to the highest
 * number when the pointer is null); `'latest'` always takes the highest number.
 * The two differ after a `restoreAssetVersion`, which repoints
 * `currentVersionId` at an older row.
 *
 * Spelled the same way as `FolderFileVersionSelector` on purpose: the two
 * libraries are twins, and a caller that has to remember which one speaks
 * `number | 'latest' | 'current'` is a caller that will eventually pass the
 * wrong thing.
 */
export type AssetVersionSelector = number | 'latest' | 'current'

/** How a caller addresses one version of an asset. See {@link resolveAssetVersion}. */
export interface AssetVersionAddress {
  /** Defaults to `'current'`, matching every legacy entry point. */
  version?: AssetVersionSelector
  /**
   * Target a specific version **row id** instead of the asset's current one.
   *
   * Kept alongside {@link AssetVersionAddress.version} rather than folded into
   * it because the two address different id spaces — `versionNumber` is the
   * 1-based UI counter and `MediaAssetVersion.id` is a cuid — and because a
   * caller holding a row id (a pinned attachment, a thumbnail's source) has no
   * cheap way to turn it back into a number.
   *
   * When both are supplied `versionId` wins: it is the narrower address, and
   * silently preferring the vaguer one would serve different bytes than asked
   * for.
   */
  versionId?: string
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/**
 * Turn an {@link AssetVersionAddress} into a version row, locations joined in.
 *
 * **The single implementation of "which version did the caller mean" for the
 * asset library.** It lives here, next to the version reads it composes, rather
 * than inside `assets/download.ts`, because it now has two consumers —
 * `getAssetDownloadRef` and `getAssetContent` — and a second copy is precisely
 * how a download and a content read start disagreeing about which bytes are
 * current. `folder-files/file-queries.ts` holds the twin for files.
 *
 * Every branch is constrained by `asset.id`, so a version belonging to a
 * different asset — possibly another org's — cannot be served through an asset
 * the caller can see.
 *
 * The `'latest'` and numeric branches delegate to {@link getLatestAssetVersion}
 * and {@link getAssetVersionByNumber}, each of which re-runs {@link requireAsset}.
 * Those two selectors therefore cost one extra primary-key read of a row the
 * caller has already loaded. That is the price of having exactly one
 * implementation of "which version is version N", and it is the cheap side of
 * the trade.
 *
 * Throws rather than returning `Result`: it is a helper, and every caller is
 * already inside a {@link guard}.
 *
 * @param ctx Scope. `ctx.db` may be a pool or a transaction.
 * @param asset The asset the caller has already loaded, org-scoped.
 * @param address Which version. Defaults to `'current'`.
 * @throws {NotFoundError} when the addressed version does not exist for this asset.
 */
export async function resolveAssetVersion(
  ctx: FilesCtx,
  asset: MediaAssetEntity,
  address: AssetVersionAddress = {}
): Promise<AssetVersionWithLocation> {
  if (address.versionId) {
    const version = (await ctx.db.query.MediaAssetVersion.findFirst({
      where: and(
        eq(schema.MediaAssetVersion.id, address.versionId),
        eq(schema.MediaAssetVersion.assetId, asset.id)
      ),
      orderBy: desc(schema.MediaAssetVersion.versionNumber),
      with: { storageLocation: true },
    })) as AssetVersionWithLocation | undefined
    if (!version) {
      throw new NotFoundError(`Version ${address.versionId} not found for asset ${asset.id}`)
    }
    return version
  }

  const selector = address.version ?? 'current'

  if (selector === 'current') {
    // Takes the already-loaded asset, so the default path still costs exactly
    // two reads: the asset, then its version.
    const version = await loadCurrentVersion(ctx, asset)
    if (!version) throw new NotFoundError(`No version found for asset ${asset.id}`)
    return version
  }

  const version =
    selector === 'latest'
      ? unwrap(await getLatestAssetVersion(ctx, asset.id))
      : unwrap(await getAssetVersionByNumber(ctx, asset.id, selector))

  if (!version) throw new NotFoundError(`Version ${selector} not found for asset ${asset.id}`)
  return version
}

/**
 * Load an asset or throw `NotFoundError`.
 *
 * Exported for the mutation modules, which all need the same org-scoped
 * existence check before they write, and must throw rather than return `err()`
 * so a failure inside a caller's transaction rolls it back.
 */
export async function requireAsset(ctx: FilesCtx, assetId: string): Promise<MediaAssetEntity> {
  const asset = await ctx.db.query.MediaAsset.findFirst({
    where: and(
      eq(schema.MediaAsset.id, assetId),
      eq(schema.MediaAsset.organizationId, ctx.organizationId),
      isNull(schema.MediaAsset.deletedAt)
    ),
  })
  if (!asset) throw new NotFoundError(`Asset ${assetId} not found`)
  return asset as MediaAssetEntity
}

/**
 * The `currentVersionId`-then-highest-number resolution, on an already-loaded
 * asset. Exported for the mutation modules so neither re-fetches the asset.
 */
export async function loadCurrentVersion(
  ctx: FilesCtx,
  asset: MediaAssetEntity
): Promise<AssetVersionWithLocation | null> {
  const version = asset.currentVersionId
    ? await ctx.db.query.MediaAssetVersion.findFirst({
        where: and(
          eq(schema.MediaAssetVersion.id, asset.currentVersionId),
          eq(schema.MediaAssetVersion.assetId, asset.id)
        ),
        with: { storageLocation: true },
      })
    : await ctx.db.query.MediaAssetVersion.findFirst({
        where: eq(schema.MediaAssetVersion.assetId, asset.id),
        with: { storageLocation: true },
        orderBy: desc(schema.MediaAssetVersion.versionNumber),
      })
  return (version as AssetVersionWithLocation | undefined) ?? null
}
