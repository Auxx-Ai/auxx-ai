// packages/lib/src/files/core/media-asset-service.ts

/**
 * @deprecated A thin, deprecated facade over `files/assets/`.
 *
 * Every method below now delegates to a function in
 * `files/assets/asset-queries.ts`, `asset-mutations.ts`,
 * `version-mutations.ts`, `download.ts` or `content.ts`. The class survives only
 * because it has external construction sites; **PR Y / Phase 10 move those and
 * delete this file.** Do not add a method here — add a function to
 * `files/assets/` and call it directly with a `FilesCtx`.
 *
 * **Nothing here reaches `StorageManager` any more.** `getContent` was the last
 * one, and it now goes through `assets/content.ts` and a `StoragePort`, which
 * is what let `getStorageManager` and its lazy `_storageManager` field go.
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
 * `count`, `listByKind`, `findByMimeType`; and in PR X `convertTempToPermanent`,
 * `createFromFolderFile`, `findByKind`, `findByChecksum`, `streamContent`,
 * `getDownloadUrl`, `getDownloadUrls`, `getStorageManager`.
 *
 * Two of those are worth naming. **`streamContent` never worked**: its body
 * called `storageManager.streamContent(...)`, a method `StorageManager` does not
 * have (it is `streamFileContent`), through a `Promise<any>` accessor that hid
 * the mistake from the compiler; it had no callers, so the throw was never
 * reached. `streamAssetContent` in `assets/content.ts` is the working
 * replacement. **`findByChecksum` never worked either** — `MediaAsset` has no
 * checksum column, so it ignored its argument and returned whichever live asset
 * the organization filter yielded first. It survived only because
 * `ContentAccessible` declared it, so the `implements ContentAccessible` clause
 * went with it (`FileService` dropped the same clause in 5b). `getDownloadUrl` /
 * `getDownloadUrls` had one consumer between them, `kb/internal/resolve-cover-urls.ts`,
 * which now batches through `resolveAssetDownloadRef` itself.
 */

import type { Transaction } from '@auxx/database'
import type {
  MediaAssetEntity as MediaAsset,
  MediaAssetVersionEntity as MediaAssetVersion,
  StorageLocationEntity as StorageLocation,
} from '@auxx/database/types'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type { DownloadRef } from '../adapters/base-adapter'
import {
  createAsset,
  createAssetWithVersion,
  deleteAsset,
  updateAsset,
} from '../assets/asset-mutations'
import type { AssetVersionWithLocation } from '../assets/asset-queries'
import {
  findExpiredAssets,
  getAsset,
  getAssetCurrentVersion,
  getAssetVersionByNumber,
  getAssetVersions,
  getAssetWithRelations,
  getLatestAssetVersion,
  listAssets,
} from '../assets/asset-queries'
import { getAssetContent } from '../assets/content'
import type { DownloadDeps } from '../assets/download'
import { getAssetDownloadRef } from '../assets/download'
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
  implements Versioned
{
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

  // ============= Content access =============

  /**
   * @deprecated Use `getAssetContent(ctx, deps, assetId)`.
   *
   * **No longer goes through `StorageManager`.** It delegates to
   * `assets/content.ts`, which addresses the object through a
   * {@link StoragePort} with the bucket taken off the `StorageLocation` row.
   * Two things changed as a result, both improvements:
   *
   * - The location read is gone. `StorageManager.getContent(locationId)` did its
   *   own **unscoped** `StorageLocation` lookup behind the caller's back; the
   *   row now arrives joined onto the version this facade already resolved.
   * - A missing storage location is a `NotFoundError` (404) rather than a bare
   *   `Error`, matching every other method on this class since PR 5a.
   */
  async getContent(id: string): Promise<Buffer> {
    return this.unwrap(await getAssetContent(this.filesCtx(), this.filesDownloadDeps(), id))
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
