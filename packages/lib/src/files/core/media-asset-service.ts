// packages/lib/src/files/core/media-asset-service.ts

/**
 * @deprecated A thin, deprecated facade over `files/assets/`.
 *
 * Every method below now delegates to a function in
 * `files/assets/asset-queries.ts`, `asset-mutations.ts`,
 * `version-mutations.ts` or `download.ts`. The class survives only because it
 * has 41 external construction sites; **PR 5h / Phase 10 move those and delete
 * this file.** Do not add a method here — add a function to `files/assets/` and
 * call it directly with a `FilesCtx`.
 *
 * What changed for callers of this class, and nothing else did:
 *
 * - **Errors are `AuxxError` subclasses**, not bare `Error`. A missing asset or
 *   version is a `NotFoundError` (404), an invalid kind a `BadRequestError`
 *   (400), and deleting the current version a `ConflictError` (409), so
 *   `auxxErrorMiddleware` maps them instead of returning 500 for everything.
 * - **Organization scope is unconditional.** The old bodies scoped with
 *   `if (this.organizationId)`, so a service constructed without one queried
 *   every tenant; the delegated functions take a required `ctx.organizationId`,
 *   and this facade throws if it has none.
 * - **`getDownloadRefForVersion` returns the durable public URL** for a public
 *   asset whose storage location has one, instead of always presigning. Same
 *   rule `getDownloadRef` has followed since the Phase-2 pilot.
 *
 * Deleted outright rather than ported, all verified zero-caller:
 * `processEmailAttachment`, `generateThumbnail`, `extractMetadata`,
 * `findLargeAssets`, `findOrphanedAssets`, `findPublicAssets`, `convertKind`,
 * `validateKindConversion`, `getDownloadInfo`, `copyVersions`, `search`,
 * `count`, `listByKind`, `findByMimeType`.
 */

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type {
  MediaAssetEntity as MediaAsset,
  MediaAssetVersionEntity as MediaAssetVersion,
  StorageLocationEntity as StorageLocation,
} from '@auxx/database/types'
import { and, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type { DownloadRef } from '../adapters/base-adapter'
import {
  convertTempAssetToPermanent,
  createAsset,
  createAssetFromFolderFile,
  createAssetWithVersion,
  deleteAsset,
  updateAsset,
} from '../assets/asset-mutations'
import type { AssetVersionWithLocation } from '../assets/asset-queries'
import {
  findAssetsByKind,
  findExpiredAssets,
  getAsset,
  getAssetCurrentVersion,
  getAssetVersionByNumber,
  getAssetVersions,
  getAssetWithRelations,
  getLatestAssetVersion,
  listAssets,
} from '../assets/asset-queries'
import type { DownloadDeps, VersionWithLocation } from '../assets/download'
import { getAssetDownloadRef, resolveAssetDownloadRef } from '../assets/download'
import type { AssetWriteDeps, ThumbnailCleanupPort } from '../assets/ports'
import {
  createAssetVersion,
  deleteAssetVersion,
  restoreAssetVersion,
  updateAssetContent,
} from '../assets/version-mutations'
import type { FilesCtx } from '../ctx'
import { createS3StoragePort } from '../storage/ports'
import { createThumbnailCleanupPort } from '../thumbnails/thumbnail-mutations'
import { BaseService, type DatabaseClient, defaultDatabase } from './base-service'
import type { ContentAccessible } from './mixins/content-accessible'
import type { Versioned } from './mixins/versioned'
import type {
  AssetKind,
  AssetSearchResult,
  CreateAssetRequest,
  MediaAssetWithRelations,
  UpdateAssetRequest,
} from './types'

/** The version shape the legacy `getDownloadRefForVersion` promised its callers. */
export type AssetVersionDownloadRef = DownloadRef & {
  filename: string
  mimeType?: string
  size?: number
  expiresAt?: Date
  versionNumber: number
}

/** How long a legacy `getDownloadRefForVersion` result claims to be valid when the ref carries no expiry. */
const LEGACY_PREVIEW_TTL_MS = 10 * 60 * 1000

/**
 * @deprecated See the file header. Delegates to `files/assets/`; deleted in Phase 10.
 */
export class MediaAssetService
  extends BaseService<
    MediaAsset,
    MediaAssetWithRelations,
    CreateAssetRequest,
    UpdateAssetRequest,
    AssetSearchResult
  >
  implements ContentAccessible, Versioned
{
  private _storageManager?: any

  private _filesDownloadDeps?: DownloadDeps

  constructor(
    organizationId?: string,
    userId?: string,
    dbInstance: DatabaseClient = defaultDatabase()
  ) {
    super(organizationId, userId, dbInstance)
  }

  protected getEntityName(): string {
    return 'asset'
  }

  /**
   * @deprecated Unused. Creation runs through `assets/asset-mutations.ts`, which
   * validates the kind and stamps `updatedAt` itself. Present only because
   * `BaseService` declares this abstract.
   */
  protected async processCreateData(data: CreateAssetRequest): Promise<CreateAssetRequest> {
    return data
  }

  // ============= Base CRUD =============

  /** @deprecated Use `createAsset(ctx, deps, input)`. */
  async create(data: CreateAssetRequest, db?: DatabaseClient): Promise<MediaAsset> {
    return this.unwrap(
      await createAsset(this.filesCtx(db, data.organizationId), this.writeDeps(), {
        kind: data.kind,
        purpose: data.purpose,
        name: data.name,
        mimeType: data.mimeType,
        size: data.size,
        isPrivate: data.isPrivate,
        createdById: data.createdById ?? this.userId,
        expiresAt: data.expiresAt,
      })
    )
  }

  /** @deprecated Use `getAsset(ctx, assetId)`. */
  async get(id: string, db?: DatabaseClient): Promise<MediaAsset | null> {
    return this.unwrap(await getAsset(this.filesCtx(db), id))
  }

  /** @deprecated Use `getAssetWithRelations(ctx, assetId)`. */
  async getWithRelations(id: string, db?: DatabaseClient): Promise<MediaAssetWithRelations | null> {
    return this.unwrap(await getAssetWithRelations(this.filesCtx(db), id))
  }

  /** @deprecated Use `updateAsset(ctx, deps, assetId, input)`. */
  async update(id: string, data: UpdateAssetRequest, db?: DatabaseClient): Promise<MediaAsset> {
    return this.unwrap(await updateAsset(this.filesCtx(db), this.writeDeps(), id, data))
  }

  /**
   * @deprecated Use `listAssets(ctx, options)`.
   *
   * The legacy `filters` bag was an arbitrary `Record<string, unknown>` resolved
   * through `getTableColumns(schema.MediaAsset)`; only `kind` and `isPrivate`
   * were ever passed, and only those two survive.
   */
  async list(
    options: {
      limit?: number
      offset?: number
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
      filters?: { kind?: AssetKind; isPrivate?: boolean }
      includeDeleted?: boolean
    } = {}
  ): Promise<{ items: MediaAsset[]; total: number; hasMore: boolean }> {
    const sortBy =
      options.sortBy === 'createdAt' ||
      options.sortBy === 'updatedAt' ||
      options.sortBy === 'name' ||
      options.sortBy === 'size'
        ? options.sortBy
        : undefined

    return this.unwrap(
      await listAssets(this.filesCtx(), {
        kind: options.filters?.kind,
        isPrivate: options.filters?.isPrivate,
        limit: options.limit,
        offset: options.offset,
        sortBy,
        sortOrder: options.sortOrder,
        includeDeleted: options.includeDeleted,
      })
    )
  }

  // ============= Asset-specific operations =============

  /** @deprecated Use `deleteAsset(tx, ctx, deps, assetId)`. */
  async delete(id: string, db?: DatabaseClient): Promise<void> {
    return this.inTransaction(db, async (tx) =>
      this.unwrap(
        await deleteAsset(
          tx,
          this.filesCtx(tx),
          { ...this.writeDeps(), thumbnails: this.thumbnails(tx) },
          id
        )
      )
    )
  }

  /** @deprecated Use `convertTempAssetToPermanent(ctx, assetId, kind)`. */
  async convertTempToPermanent(
    mediaAssetId: string,
    newKind: AssetKind,
    organizationId: string,
    tx?: DatabaseClient
  ): Promise<void> {
    return this.unwrap(
      await convertTempAssetToPermanent(this.filesCtx(tx, organizationId), mediaAssetId, newKind)
    )
  }

  /** @deprecated Use `createAssetWithVersion(tx, ctx, deps, input)`. */
  async createWithVersion(
    data: CreateAssetRequest,
    storageLocationId: string
  ): Promise<{
    asset: MediaAsset
    version: MediaAssetVersion & { storageLocation: StorageLocation }
  }> {
    return this.inTransaction(undefined, async (tx) =>
      this.unwrap(
        await createAssetWithVersion(tx, this.filesCtx(tx, data.organizationId), this.writeDeps(), {
          kind: data.kind,
          purpose: data.purpose,
          name: data.name,
          mimeType: data.mimeType,
          size: data.size,
          isPrivate: data.isPrivate,
          createdById: data.createdById ?? this.userId,
          expiresAt: data.expiresAt,
          storageLocationId,
        })
      )
    )
  }

  /** @deprecated Use `createAssetFromFolderFile(tx, ctx, deps, input)`. */
  async createFromFolderFile(
    fileId: string,
    fileVersionId?: string,
    options?: {
      kind?: AssetKind
      skipIfExists?: boolean
    }
  ): Promise<MediaAsset> {
    return this.inTransaction(undefined, async (tx) =>
      this.unwrap(
        await createAssetFromFolderFile(tx, this.filesCtx(tx), this.writeDeps(), {
          fileId,
          fileVersionId,
          kind: options?.kind,
          skipIfExists: options?.skipIfExists,
        })
      )
    )
  }

  /** @deprecated Use `updateAssetContent(tx, ctx, deps, input)`. */
  async updateContent(
    id: string,
    storageLocationId: string,
    metadata: {
      size?: number
      mimeType?: string
    } = {}
  ): Promise<{
    asset: MediaAsset
    version: MediaAssetVersion & { storageLocation: StorageLocation }
  }> {
    return this.inTransaction(undefined, async (tx) =>
      this.unwrap(
        await updateAssetContent(tx, this.filesCtx(tx), this.writeDeps(), {
          assetId: id,
          storageLocationId,
          size: metadata.size,
          mimeType: metadata.mimeType,
        })
      )
    )
  }

  // ============= Asset queries =============

  /** @deprecated Use `findAssetsByKind(ctx, kind)`. */
  async findByKind(kind: AssetKind): Promise<MediaAsset[]> {
    return this.unwrap(await findAssetsByKind(this.filesCtx(), kind))
  }

  /**
   * @deprecated Use `findExpiredAssets(ctx, createdBefore)`.
   *
   * The cutoff is computed here rather than inside the query, because the
   * extracted read takes an instant instead of reading the clock itself.
   */
  async findExpired(maxAgeHours = 24): Promise<MediaAsset[]> {
    const createdBefore = new Date(this.writeDeps().now().getTime() - maxAgeHours * 60 * 60 * 1000)
    return this.unwrap(await findExpiredAssets(this.filesCtx(), createdBefore))
  }

  /**
   * @deprecated Zero callers, and it never worked: `MediaAsset` has no checksum
   * column, so the body below ignores its argument and returns whichever live
   * asset the organization filter happens to yield first. It is kept only
   * because `ContentAccessible` declares it (`FileService` has a real
   * implementation — `FolderFile.checksum` exists) and is deleted with this
   * class. It was deliberately NOT ported to `files/assets/`: porting it would
   * launder the bug into the new module.
   */
  async findByChecksum(_checksum: string): Promise<MediaAsset | null> {
    const asset = await this.db.query.MediaAsset.findFirst({
      where: and(
        eq(schema.MediaAsset.organizationId, this.requireOrganization()),
        isNull(schema.MediaAsset.deletedAt)
      ),
    })
    return (asset as MediaAsset | undefined) ?? null
  }

  // ============= Content access =============

  /**
   * @deprecated Still on `StorageManager` rather than the `StoragePort`.
   *
   * `assets/` has no content-read function yet: PR 5a's scope was the CRUD,
   * version and download surface, and `getContent` / `streamContent` need
   * `StoragePort.getObject` / `.streamObject` plus the bucket-from-the-row rule
   * that `download.ts` implements. That is the next extraction, not this one —
   * which is also why `getStorageManager` survives despite the plan listing it
   * as deletable.
   */
  async getContent(id: string): Promise<Buffer> {
    const currentVersion = await this.getCurrentVersion(id)
    if (!currentVersion?.storageLocationId) {
      throw new Error(`No storage location found for ${this.getEntityName()}`)
    }
    const storageManager = await this.getStorageManager()
    return storageManager.getContent(currentVersion.storageLocationId)
  }

  /** @deprecated Same caveat as {@link getContent}. */
  async streamContent(id: string): Promise<NodeJS.ReadableStream> {
    const currentVersion = await this.getCurrentVersion(id)
    if (!currentVersion?.storageLocationId) {
      throw new Error(`No storage location found for ${this.getEntityName()}`)
    }
    const storageManager = await this.getStorageManager()
    return storageManager.streamContent(currentVersion.storageLocationId)
  }

  // ============= Download =============

  /**
   * @deprecated Use `getAssetDownloadRef(ctx, deps, assetId)` and read `.url`
   * off the ref — it is the single accessor that replaced this method,
   * `getDownloadRefForVersion`, `getDownloadUrl`, `getDownloadUrls`,
   * `getDownloadInfo` and the private `downloadUrlFor`.
   */
  async getDownloadRef(id: string): Promise<DownloadRef> {
    return this.unwrap(await getAssetDownloadRef(this.filesCtx(), this.filesDownloadDeps(), id))
  }

  /**
   * @deprecated Use `getAssetDownloadRef(ctx, deps, assetId, { versionId })`.
   *
   * Two id spaces meet here and the extracted function only speaks one of them:
   * this method addresses a version by its **number** (or the words `current` /
   * `latest`), while `getAssetDownloadRef` takes a version **id**. So the
   * number is resolved to a row first, and the row's id is what gets passed
   * down. The extra metadata this returns — filename, size, `versionNumber` —
   * is read off the rows that resolution already loaded.
   */
  async getDownloadRefForVersion(
    entityId: string,
    opts: {
      version?: number | 'latest' | 'current'
      disposition?: 'inline' | 'attachment'
    } = {}
  ): Promise<AssetVersionDownloadRef> {
    const { version = 'current', disposition = 'inline' } = opts
    const ctx = this.filesCtx()

    const entity = await this.get(entityId)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    const targetVersion =
      version === 'current'
        ? this.unwrap(await getAssetCurrentVersion(ctx, entityId))
        : version === 'latest'
          ? this.unwrap(await getLatestAssetVersion(ctx, entityId))
          : this.unwrap(await getAssetVersionByNumber(ctx, entityId, version))

    if (!targetVersion?.storageLocationId) {
      throw new Error(`Version ${version} not found for ${this.getEntityName()}`)
    }

    const downloadRef = this.unwrap(
      await getAssetDownloadRef(ctx, this.filesDownloadDeps(), entityId, {
        versionId: targetVersion.id,
        disposition,
      })
    )

    const fallbackExpiry = new Date(this.writeDeps().now().getTime() + LEGACY_PREVIEW_TTL_MS)
    return {
      ...downloadRef,
      filename: entity.name || `${entity.kind.toLowerCase()}_${entity.id}`,
      mimeType: entity.mimeType || undefined,
      size: entity.size || undefined,
      versionNumber: targetVersion.versionNumber,
      expiresAt:
        downloadRef.type === 'url' ? (downloadRef.expiresAt ?? fallbackExpiry) : fallbackExpiry,
    }
  }

  /**
   * @deprecated Use `getAssetDownloadRef(...)` and read `.url`.
   *
   * Returns `null` on every failure, exactly as before — this is a best-effort
   * convenience used to fill avatar/thumbnail URLs into list payloads, and a
   * throw there would fail a whole page for one broken row.
   */
  async getDownloadUrl(id: string): Promise<string | null> {
    try {
      const result = await getAssetDownloadRef(this.filesCtx(), this.filesDownloadDeps(), id)
      if (result.isErr()) return null
      return result.value.type === 'url' ? result.value.url : null
    } catch {
      // `filesCtx()` throws when the service has no organization context; the
      // documented contract of this method is null-on-failure, so swallow it.
      return null
    }
  }

  /**
   * @deprecated Use `resolveAssetDownloadRef(deps, asset, version)` over rows
   * the caller already batched.
   *
   * Resolves many asset ids in a fixed number of round-trips (one for the
   * assets, up to two for their versions) instead of the per-id `getDownloadUrl`
   * fan-out. The URL policy itself is no longer duplicated here: the private
   * `downloadUrlFor` this used to call is gone, and each row now goes through
   * `resolveAssetDownloadRef` — the same tail `getAssetDownloadRef` runs.
   *
   * Ids that are missing, deleted, or whose storage location cannot name its
   * bucket resolve to `null`.
   */
  async getDownloadUrls(ids: string[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>()
    const unique = Array.from(new Set(ids.filter((id): id is string => !!id)))
    if (unique.length === 0) return result

    const filters: SQL[] = [
      inArray(schema.MediaAsset.id, unique),
      isNull(schema.MediaAsset.deletedAt),
      eq(schema.MediaAsset.organizationId, this.requireOrganization()),
    ]
    const assets = (await this.db.query.MediaAsset.findMany({
      where: and(...filters),
    })) as MediaAsset[]

    // Resolve every asset's current version in at most two queries: one by
    // explicit currentVersionId, one by assetId (latest) for assets without it.
    const withCurrent = assets.filter((asset) => asset.currentVersionId)
    const withoutCurrent = assets.filter((asset) => !asset.currentVersionId)
    const versionById = new Map<string, VersionWithLocation>()
    const latestByAsset = new Map<string, VersionWithLocation>()

    const [byId, byAsset] = await Promise.all([
      withCurrent.length
        ? this.db.query.MediaAssetVersion.findMany({
            where: inArray(
              schema.MediaAssetVersion.id,
              withCurrent.map((asset) => asset.currentVersionId as string)
            ),
            with: { storageLocation: true },
          })
        : Promise.resolve([]),
      withoutCurrent.length
        ? this.db.query.MediaAssetVersion.findMany({
            where: inArray(
              schema.MediaAssetVersion.assetId,
              withoutCurrent.map((asset) => asset.id)
            ),
            orderBy: desc(schema.MediaAssetVersion.versionNumber),
            with: { storageLocation: true },
          })
        : Promise.resolve([]),
    ])
    for (const version of byId as VersionWithLocation[]) versionById.set(version.id, version)
    for (const version of byAsset as VersionWithLocation[]) {
      // ordered by version desc → first seen per asset is the latest
      if (!latestByAsset.has(version.assetId)) latestByAsset.set(version.assetId, version)
    }

    const deps = this.filesDownloadDeps()
    await Promise.all(
      assets.map(async (entity) => {
        const version = entity.currentVersionId
          ? versionById.get(entity.currentVersionId)
          : latestByAsset.get(entity.id)
        if (!version) {
          result.set(entity.id, null)
          return
        }
        try {
          const ref = await resolveAssetDownloadRef(deps, entity, version)
          result.set(entity.id, ref.type === 'url' ? ref.url : null)
        } catch {
          result.set(entity.id, null)
        }
      })
    )
    for (const id of unique) if (!result.has(id)) result.set(id, null)
    return result
  }

  // ============= Versions =============

  /** @deprecated Use `getAssetCurrentVersion(ctx, assetId)`. */
  async getCurrentVersion(entityId: string): Promise<AssetVersionWithLocation | null> {
    return this.unwrap(await getAssetCurrentVersion(this.filesCtx(), entityId))
  }

  /** @deprecated Use `createAssetVersion(tx, ctx, input)`. */
  async createVersion(
    entityId: string,
    storageLocationId: string,
    metadata: { size?: number; mimeType?: string; metadata?: Record<string, unknown> } = {},
    db?: DatabaseClient
  ): Promise<MediaAssetVersion & { storageLocation: StorageLocation }> {
    return this.inTransaction(db, async (tx) =>
      this.unwrap(
        await createAssetVersion(tx, this.filesCtx(tx), {
          assetId: entityId,
          storageLocationId,
          size: metadata.size,
          mimeType: metadata.mimeType,
          metadata: metadata.metadata,
        })
      )
    )
  }

  /** @deprecated Use `getAssetVersions(ctx, assetId)`. */
  async getVersions(entityId: string): Promise<AssetVersionWithLocation[]> {
    return this.unwrap(await getAssetVersions(this.filesCtx(), entityId))
  }

  /** @deprecated Use `getAssetVersionByNumber(ctx, assetId, versionNumber)`. */
  async getVersion(
    entityId: string,
    versionNumber: number
  ): Promise<AssetVersionWithLocation | null> {
    return this.unwrap(await getAssetVersionByNumber(this.filesCtx(), entityId, versionNumber))
  }

  /** @deprecated Use `getLatestAssetVersion(ctx, assetId)`. */
  async getLatestVersion(entityId: string): Promise<AssetVersionWithLocation | null> {
    return this.unwrap(await getLatestAssetVersion(this.filesCtx(), entityId))
  }

  /** @deprecated Use `restoreAssetVersion(ctx, deps, assetId, versionNumber)`. */
  async restoreVersion(entityId: string, versionNumber: number): Promise<MediaAsset> {
    return this.unwrap(
      await restoreAssetVersion(this.filesCtx(), this.writeDeps(), entityId, versionNumber)
    )
  }

  /** @deprecated Use `deleteAssetVersion(ctx, deps, assetId, versionNumber)`. */
  async deleteVersion(entityId: string, versionNumber: number): Promise<void> {
    return this.unwrap(
      await deleteAssetVersion(
        this.filesCtx(),
        { thumbnails: this.thumbnails(this.db) },
        entityId,
        versionNumber
      )
    )
  }

  // ============= Bridge to the functional `files/` surface =============

  /**
   * Build the {@link FilesCtx} the extracted `files/` functions take, from the
   * scope this service already carries.
   *
   * `FilesCtx` carries no actor, so `this.userId` is deliberately not forwarded
   * — a function that records one takes it in its own `input` instead. That
   * matters here: many production sites construct `new MediaAssetService(orgId)`
   * with no actor at all (a worker resolving a thumbnail URL, for one).
   *
   * `organizationId` is the opposite case: it is in the `WHERE` clause, so a
   * missing one must throw rather than silently widen the query to every tenant.
   *
   * @param db Override client — a transaction the caller already opened.
   * @param organizationId Override scope, for the two methods that take one as
   *   an argument rather than from the constructor.
   */
  private filesCtx(db?: DatabaseClient, organizationId?: string): FilesCtx {
    return {
      db: db ?? this.db,
      organizationId: organizationId ?? this.requireOrganization(),
    }
  }

  /**
   * The clock the extracted writes stamp `updatedAt` / `deletedAt` from.
   *
   * A real `FilesDeps.now` here, so production behaviour is `new Date()` while
   * the extracted functions stay testable with a frozen clock.
   */
  private writeDeps(): AssetWriteDeps {
    return { now: () => new Date() }
  }

  /**
   * The thumbnail sweep the delete paths take as a parameter.
   *
   * PR 5f landed `files/thumbnails/`, so this is now the real
   * {@link ThumbnailCleanupPort} rather than a lambda that dynamically imported
   * a service class — which was the whole reason `assets/ports.ts` exists. The
   * port is built here, at the composition site, and handed down as a parameter.
   *
   * `db` is threaded through so a delete running inside a transaction sweeps on
   * that transaction. Passing `this.db` while inside one is the Tier-1 §1.3
   * stale-read bug.
   */
  private thumbnails(db: DatabaseClient): ThumbnailCleanupPort {
    return createThumbnailCleanupPort(this.filesCtx(db), {
      storage: createS3StoragePort(this.requireOrganization()),
      now: () => new Date(),
    })
  }

  /**
   * The storage collaborator for the extracted download reads, lazily built and
   * cached per service instance, so a service that never downloads anything
   * never resolves credentials.
   */
  private filesDownloadDeps(): DownloadDeps {
    if (!this._filesDownloadDeps) {
      this._filesDownloadDeps = { storage: createS3StoragePort(this.requireOrganization()) }
    }
    return this._filesDownloadDeps
  }

  /**
   * Get storage manager for content operations (lazy singleton).
   *
   * Survives PR 5a because `getContent` / `streamContent` still go through it —
   * see the note on {@link getContent}.
   */
  protected async getStorageManager(): Promise<any> {
    if (!this._storageManager) {
      // Import storage manager dynamically to avoid circular dependencies
      const { createStorageManager } = await import('../storage/storage-manager')
      // Use organization-scoped instance for proper credential management
      this._storageManager = createStorageManager(this.requireOrganization())
    }
    return this._storageManager
  }

  /**
   * Unwrap a `Result` into the throw-based contract this class has always had.
   *
   * The thrown value is an `AuxxError` subclass rather than the bare `Error` the
   * old bodies threw, which is the one deliberate change to this facade's
   * behaviour.
   */
  private unwrap<T>(result: Result<T, AuxxError>): T {
    if (result.isErr()) throw result.error
    return result.value
  }

  /**
   * Run `fn` inside a transaction, reproducing `BaseService.getTx` exactly.
   *
   * This is the one place the deprecated facade casts, and it is unavoidable
   * here: `BaseService.db` and the legacy `db?` parameters are
   * `Database | Transaction`, while the extracted writes require a real
   * `Transaction` — which is the entire point of that parameter, since a pool in
   * the slot silently stops a multi-statement write from being atomic. Isolating
   * the cast to this method keeps every new call site honest, and Phase 6 deletes
   * it along with `getTx`.
   *
   * @param client A client the caller says is already transactional; when
   *   present, `fn` runs on it directly, matching the legacy `if (db) … else
   *   getTx(…)` branch.
   */
  private async inTransaction<T>(
    client: DatabaseClient | undefined,
    fn: (tx: Transaction) => Promise<T>
  ): Promise<T> {
    if (client) return fn(client as Transaction)
    return this.getTx((tx) => fn(tx as Transaction))
  }
}

// Export factory functions for creating service instances
export const createMediaAssetService = (organizationId?: string, userId?: string) =>
  new MediaAssetService(organizationId, userId)
