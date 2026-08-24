// packages/lib/src/files/core/attachment-service.ts

/**
 * @deprecated A thin, deprecated facade over `files/attachments/`.
 *
 * Every method below delegates to a function in
 * `files/attachments/attachment-queries.ts` or `attachment-mutations.ts`. The
 * class survives only because it has 15 external construction sites;
 * **PR 5h / Phase 10 move those and delete this file.** Do not add a method
 * here — add a function to `files/attachments/` and call it with a `FilesCtx`.
 *
 * What changed for callers of this class, and nothing else did:
 *
 * - **Errors are `AuxxError` subclasses**, not bare `Error`. A missing
 *   attachment is a `NotFoundError` (404) and a malformed create a
 *   `BadRequestError` (400), so `auxxErrorMiddleware` maps them instead of
 *   returning 500 for everything.
 * - **The `Authorizer` constructor parameter is gone.** No production site ever
 *   passed one, so the eleven `await this.ensureAuth(…)` calls were no-ops — and
 *   a permission hook below the router is what `docs/lib-module-guide.md` §6
 *   forbids outright. `attachmentRouter` already asserts per host.
 * - **`create` no longer accepts `idempotencyKey`.** See {@link create}.
 * - **`getDownloadInfo`'s filename no longer reads a column that was never
 *   selected.** See {@link getDownloadInfo}.
 *
 * ## Deleted outright rather than ported, all verified zero-caller
 *
 * Six were `throw new Error('Not implemented')` stubs: `attachAssetToEntity`,
 * `attachAssetVersionToEntity`, `bulkAttachFiles`, `bulkAttachAssets`,
 * `bulkDetachFromEntity`, `bulkUpdateRoles`.
 *
 * Seven were implemented but unreachable *and* defective, so porting would have
 * laundered the defect into the new module:
 *
 * - `detachFromEntity` and `reorderAttachments` wrote with
 *   `where(eq(Attachment.id, …))` and **no organization filter** — a
 *   cross-tenant delete and a cross-tenant update to anyone holding an id.
 * - `fixAttachmentSortOrders` and `copyAttachmentsToEntity` issued one statement
 *   per row; `getEntityAttachmentStats` issued four per attachment (it called
 *   `resolveVersion` in a loop); `getAttachmentStats` and `getAttachmentUsage`
 *   loaded or grouped every attachment row in the organization with no `LIMIT`.
 * - `getWithRelations` returned the base row `as unknown as
 *   AttachmentWithRelations` — the relations were never loaded, so every field
 *   the type promised was `undefined`.
 *
 * The rest were simply unreachable: `attachFileVersionToEntity`,
 * `moveAttachmentsToEntity`, `getAttachmentsByRole`, `getRecentAttachments`,
 * `getAttachmentsByCreator`, `search`, `getContent`, `streamContent`,
 * `getEntityAttachmentsByRole`.
 *
 * `cleanupOrphanedAttachments` and `validateAttachmentIntegrity` moved to
 * `files/lifecycle/attachment-maintenance.ts` — whole-organization sweeps, not
 * request-path API.
 */

import { database as db } from '@auxx/database'
import type { AttachmentEntity as Attachment } from '@auxx/database/types'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { BadRequestError } from '../../errors'
import type { DownloadRef } from '../adapters/base-adapter'
import { getAssetDownloadRef } from '../assets/download'
import type { CreateAttachmentInput } from '../attachments/attachment-mutations'
import {
  createAttachment,
  deleteAttachment,
  updateAttachment,
} from '../attachments/attachment-mutations'
import type { ResolvedAttachmentVersion } from '../attachments/attachment-queries'
import {
  fetchAttachmentsForEntities,
  getAttachment,
  getEntityAttachments,
  resolveAttachmentVersion,
} from '../attachments/attachment-queries'
import type { FilesCtx, FilesDeps } from '../ctx'
import { getFolderFileDownloadRef } from '../folder-files'
import { createS3StoragePort } from '../storage/ports'
import { BaseService, type DatabaseClient } from './base-service'
import type {
  AttachmentRole,
  AttachmentWithRelations,
  CreateAttachmentRequest,
  EntityType,
  FileDownloadInfo,
  UpdateAttachmentRequest,
} from './types'

export type { GroupedAttachmentInfo } from '../attachments/attachment-queries'

/**
 * @deprecated See the file header. Delegates to `files/attachments/`; deleted in Phase 10.
 */
export class AttachmentService extends BaseService<
  Attachment,
  AttachmentWithRelations,
  CreateAttachmentRequest,
  UpdateAttachmentRequest,
  never
> {
  /** Lazily built once per service; see {@link downloadDeps}. */
  private _downloadDeps?: Pick<FilesDeps, 'storage' | 'now'>

  constructor(organizationId?: string, userId?: string, dbInstance: DatabaseClient = db) {
    super(organizationId, userId, dbInstance)
  }

  protected getEntityName(): string {
    return 'attachment'
  }

  /**
   * @deprecated Unused. Creation runs through
   * `attachments/attachment-mutations.ts`, which validates the file/asset XOR
   * and picks the default sort position itself. Present only because
   * `BaseService` declares this abstract.
   */
  protected async processCreateData(
    data: CreateAttachmentRequest
  ): Promise<CreateAttachmentRequest> {
    return data
  }

  // ============= CRUD =============

  /**
   * @deprecated Use `createAttachment(ctx, input)`.
   *
   * **`idempotencyKey` is no longer honoured, and never was.** The legacy branch
   * it gated matched on `(organizationId, entityType, entityId, title, fileId,
   * assetId)` and never compared the key to anything — it was only logged — so
   * it deduplicated by payload, not by key, and returned a partial row (a
   * fifteen-column projection cast to `Attachment`) on a hit. Nothing in the
   * repository has ever passed the field, so rather than port a dedup rule
   * nobody asked for, it is dropped here and recorded on
   * `CreateAttachmentRequest`. This is the same call PR 5a made on
   * `findAssetByChecksum`.
   */
  async create(data: CreateAttachmentRequest, dbClient?: DatabaseClient): Promise<Attachment> {
    const input: CreateAttachmentInput = {
      id: data.id,
      entityType: data.entityType,
      entityId: data.entityId,
      role: data.role,
      title: data.title,
      caption: data.caption,
      sort: data.sort,
      contentId: data.contentId,
      createdById: data.createdById ?? this.userId,
      fileId: data.fileId,
      fileVersionId: data.fileVersionId,
      assetId: data.assetId,
      assetVersionId: data.assetVersionId,
    }
    return this.unwrap(await createAttachment(this.filesCtx(dbClient, data.organizationId), input))
  }

  /** @deprecated Use `getAttachment(ctx, attachmentId)`. */
  async get(id: string, dbClient?: DatabaseClient): Promise<Attachment | null> {
    return this.unwrap(await getAttachment(this.filesCtx(dbClient), id))
  }

  /** @deprecated Use `updateAttachment(ctx, attachmentId, input)`. */
  async update(
    id: string,
    data: UpdateAttachmentRequest,
    dbClient?: DatabaseClient
  ): Promise<Attachment> {
    return this.unwrap(await updateAttachment(this.filesCtx(dbClient), id, data))
  }

  /** @deprecated Use `deleteAttachment(ctx, attachmentId)`. */
  async delete(id: string, dbClient?: DatabaseClient): Promise<void> {
    this.unwrap(await deleteAttachment(this.filesCtx(dbClient), id))
  }

  // ============= Entity attachment management =============

  /** @deprecated Use `getEntityAttachments(ctx, entityType, entityId)`. */
  async getEntityAttachments(entityType: EntityType, entityId: string): Promise<Attachment[]> {
    return this.unwrap(await getEntityAttachments(this.filesCtx(), entityType, entityId))
  }

  /**
   * @deprecated Use `createAttachment(ctx, { fileId, entityType, entityId, … })`.
   *
   * A named-argument spelling of {@link create} for the file side, kept because
   * `comments/comment-service.ts` and `messages/message-attachment.service.ts`
   * still call it. It has no counterpart in `files/attachments/` on purpose:
   * an argument shuffle is not worth a second exported name.
   */
  async attachFileToEntity(
    fileId: string,
    entityType: EntityType,
    entityId: string,
    createdById: string,
    role: AttachmentRole = 'ATTACHMENT',
    options?: { title?: string; caption?: string; sort?: number }
  ): Promise<Attachment> {
    return this.unwrap(
      await createAttachment(this.filesCtx(), {
        entityType,
        entityId,
        role,
        title: options?.title,
        caption: options?.caption,
        sort: options?.sort,
        fileId,
        createdById,
      })
    )
  }

  /**
   * @deprecated Use `fetchAttachmentsForEntities(ctx, entityType, entityIds)`.
   *
   * Still one query for the whole batch — see the note on the extracted
   * function. This is the mail and comment list read path.
   */
  async fetchAttachmentsForEntities(entityType: EntityType, entityIds: string[]) {
    return this.unwrap(await fetchAttachmentsForEntities(this.filesCtx(), entityType, entityIds))
  }

  // ============= Content & access =============

  /**
   * @deprecated Use `getAssetDownloadRef` / `getFolderFileDownloadRef` on the
   * attachment's own side, or read `.url` off this ref.
   *
   * **PR 5c closed the two `await import('./…-service')` holes here.** A pinned
   * attachment presigns its own `StorageLocation` directly. An unpinned one has
   * to ask the owning library which version is current *and* how that library's
   * download policy resolves (a public asset returns a durable URL; a file is
   * always presigned) — that used to mean constructing `FileService` or
   * `MediaAssetService` inside the body, which is the collaborator-by-`new`
   * pattern `files/ctx.ts` exists to delete. Both branches are now a direct call
   * to the one download function each library exposes, so there is exactly one
   * implementation of each policy.
   *
   * The pinned branch still goes through `StorageManager`, because it addresses
   * a `StorageLocation` by id and `storage/location-queries.ts` is
   * organization-scoped while `StorageLocation.organizationId` is nullable —
   * routing it through the port would make every pre-backfill row undownloadable.
   * That is a Phase-6/backfill decision, not this PR's.
   */
  async getDownloadRef(id: string): Promise<DownloadRef> {
    const resolved = await this.resolveVersion(id)
    const { attachment } = resolved

    if (resolved.isPinned) {
      const { createStorageManager } = await import('../storage/storage-manager')
      const storageManager = createStorageManager(this.requireOrganization())
      return await storageManager.getDownloadRef({
        locationId: resolved.storageLocationId,
        filename: attachment.title || undefined,
        mimeType: resolved.mimeType || undefined,
      })
    }

    const ctx = this.filesCtx()
    if (attachment.fileId) {
      return this.unwrap(
        await getFolderFileDownloadRef(ctx, this.downloadDeps(), attachment.fileId)
      )
    }
    return this.unwrap(
      await getAssetDownloadRef(ctx, this.downloadDeps(), attachment.assetId as string)
    )
  }

  /** @deprecated Read `.url` off {@link getDownloadRef} instead. */
  async getDownloadUrl(id: string): Promise<string> {
    const downloadRef = await this.getDownloadRef(id)
    if (downloadRef.type === 'url') return downloadRef.url
    throw new BadRequestError('Attachment content is not available via URL')
  }

  /**
   * @deprecated Compose {@link getDownloadRef} with the row you already hold.
   *
   * **The filename changed shape, not value.** The legacy body computed
   * `attachment.title || version.name || 'attachment'`, but `version` was typed
   * `any` and none of `resolveVersion`'s four projections ever selected a `name`
   * column — so the middle term was always `undefined` and the expression was
   * already `title || 'attachment'`. `ResolvedAttachmentVersion` refuses to
   * compile the dead read, which is how it surfaced.
   */
  async getDownloadInfo(id: string): Promise<FileDownloadInfo> {
    const resolved = await this.resolveVersion(id)
    const downloadRef = await this.getDownloadRef(id)
    return {
      kind: downloadRef.type,
      url: downloadRef.type === 'url' ? downloadRef.url : undefined,
      filename: resolved.attachment.title || 'attachment',
      mimeType: resolved.mimeType || undefined,
      size: resolved.size || undefined,
      expiresAt: downloadRef.type === 'url' ? downloadRef.expiresAt : undefined,
    }
  }

  // ============= Internals =============

  /** @deprecated Use `resolveAttachmentVersion(ctx, attachmentId)`. */
  private async resolveVersion(id: string): Promise<ResolvedAttachmentVersion> {
    return this.unwrap(await resolveAttachmentVersion(this.filesCtx(), id))
  }

  /**
   * Build the `FilesCtx` the extracted functions take.
   *
   * `requireOrganization()` throws when the service was constructed without one,
   * which is the legacy behaviour on every path — `FilesCtx.organizationId` is
   * required, so the "no organization means no filter" branch that widened
   * queries across tenants cannot be expressed any more.
   */
  private filesCtx(dbClient?: DatabaseClient, organizationId?: string): FilesCtx {
    return {
      db: (dbClient ?? this.db) as FilesCtx['db'],
      organizationId: organizationId ?? this.requireOrganization(),
    }
  }

  /**
   * Storage + clock, for {@link getDownloadRef}.
   *
   * Built once per service because `createS3StoragePort` shares the one cached
   * S3 adapter — and therefore its `S3Client` cache — so rebuilding it per call
   * would rebuild a client per request.
   */
  private downloadDeps(): Pick<FilesDeps, 'storage' | 'now'> {
    if (!this._downloadDeps) {
      this._downloadDeps = {
        storage: createS3StoragePort(this.requireOrganization()),
        now: () => new Date(),
      }
    }
    return this._downloadDeps
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
}

/** @deprecated Construct a `FilesCtx` and call `files/attachments/` directly. */
export const createAttachmentService = (organizationId?: string, userId?: string) =>
  new AttachmentService(organizationId, userId, db)
