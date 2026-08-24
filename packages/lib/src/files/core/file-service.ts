// packages/lib/src/files/core/file-service.ts

/**
 * @deprecated A thin, deprecated facade over `files/folder-files/`.
 *
 * Every method below delegates to a function in
 * `files/folder-files/file-queries.ts`, `file-mutations.ts`,
 * `version-mutations.ts` or `download.ts`. The class survives only because a
 * handful of call sites outside `fileRouter` still construct it;
 * **PR 5d/5e/Phase 10 move those and delete this file.** Do not add a method
 * here — add a function to `files/folder-files/` and call it with a `FilesCtx`.
 *
 * ## Why this facade is nine methods and not thirty
 *
 * `plans/attachments/05-core-services.md` §5.4 says a facade over `FileService`
 * "would just be the router by another name", because ~28 of its 40 methods were
 * 1:1 with a `fileRouter` procedure. So the router was rewired to the functions
 * in the same PR, and what is left here is exactly the surface with a consumer
 * that is *not* the router:
 *
 * | Method | Who still calls it |
 * | --- | --- |
 * | `get` | `api/files/download/[fileId]`, `attachmentRouter`, the document-extractor node |
 * | `getWithRelations` | `messages/message-sender.service.ts` |
 * | `getContent` | `documents/render.ts`, message-sender, the document-extractor node |
 * | `getDownloadRef` | `workflow-engine/services/file-context-service.ts` (×2) |
 * | `getCurrentVersion` | `apps/web`'s file download route |
 * | `createWithVersion` | `upload/processors/file-processor.ts` |
 * | `move` / `rename` | `core/filesystem-service.ts` (PR 5e) |
 * | `findOrphanedFiles` | `lifecycle/cleanup-service.ts` |
 *
 * ## What changed for callers of this class, and nothing else did
 *
 * - **Errors are `AuxxError` subclasses**, not bare `Error`. A missing file is a
 *   `NotFoundError` (404) and an empty name a `BadRequestError` (400), so
 *   `auxxErrorMiddleware` maps them instead of returning 500 for everything.
 * - **Organization scope is unconditional.** `BaseService.buildBaseWhereClause`
 *   guarded its organization filter with `if (this.organizationId)`, so a
 *   service constructed without one read, updated and deleted across every
 *   tenant. `FilesCtx.organizationId` is required, so `requireOrganization()`
 *   now throws where the query used to widen.
 * - **`move` to the root actually moves the row.** See
 *   `folder-files/file-mutations.ts`.
 *
 * ## Deleted outright rather than ported, all verified zero-caller
 *
 * `streamContent`, `permanentDelete`, `count`, `getStats`, `findByPath`,
 * `findLargeFiles`, `findByChecksum`, `updateContent`, `pinVersion`,
 * `getLatestVersion`, plus the `BaseService` scaffolding they needed
 * (`getFileSelectFields`, `getRelationIncludes`, `buildFilterConditions`,
 * `buildScopedWhere`, `getSearchFields`, `getVersionTableName`,
 * `getEntityIdFieldName`, `generateSearchSnippet`, `generateFilePath`,
 * `getStorageManager`'s cache); and in PR X `copyVersions` (its last caller,
 * `core/folder-service.ts`, moved to `copyFileVersions` in 5d) and
 * `getStorageManager` itself, now that `getContent` runs on a `StoragePort`.
 *
 * `findByChecksum` is the `MediaAssetService.findAssetByChecksum` precedent in
 * reverse: `FolderFile` really does have a `checksum` column, but nothing has
 * ever written a non-null value into it and nothing read the method.
 *
 * `pinVersion` and `restoreVersion` had byte-identical bodies down to the error
 * message; only `restoreFileVersion` survives.
 *
 * The rest moved to `fileRouter`, which now calls the functions directly:
 * `create`, `update`, `delete`, `restore`, `list`, `listInFolder`, `search`,
 * `findByExtension`, `findByMimeType`, `getDownloadInfo`,
 * `getDownloadRefForVersion`, `copy`, `createVersion`, `getVersions`,
 * `getVersion`, `restoreVersion`, `deleteVersion`.
 */

import { database as db } from '@auxx/database'
import type {
  FileVersionEntity as FileVersion,
  FolderFileEntity as FolderFile,
} from '@auxx/database/types'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type { DownloadRef } from '../adapters/base-adapter'
import type { FilesCtx, FilesDeps } from '../ctx'
import type { FileVersionWithLocation } from '../folder-files'
import {
  createFolderFileWithVersion,
  findOrphanedFolderFiles,
  getFolderFile,
  getFolderFileContent,
  getFolderFileCurrentVersion,
  getFolderFileDownloadRef,
  getFolderFileWithRelations,
  moveFolderFile,
  renameFolderFile,
} from '../folder-files'
import { createS3StoragePort } from '../storage/ports'
import { BaseService, type DatabaseClient } from './base-service'
import type { CreateFileRequest, FolderFileWithRelations } from './types'

/**
 * @deprecated See the file header. Delegates to `files/folder-files/`; deleted in Phase 10.
 *
 * `implements ContentAccessible, Versioned` is gone with the methods those
 * interfaces declare (`streamContent`, `findByChecksum`, `getVersion`,
 * `getLatestVersion`, …). `MediaAssetService` still implements both, so
 * `core/mixins/` stays until PR 5g.
 */
export class FileService extends BaseService<
  FolderFile,
  FolderFileWithRelations,
  CreateFileRequest,
  never,
  never
> {
  private _downloadDeps?: Pick<FilesDeps, 'storage' | 'now'>

  constructor(organizationId?: string, userId?: string, dbInstance: DatabaseClient = db) {
    super(organizationId, userId, dbInstance)
  }

  protected getEntityName(): string {
    return 'file'
  }

  /**
   * @deprecated Unused. Creation runs through
   * `folder-files/file-mutations.ts`, which derives the collision-safe path and
   * takes its scope from `ctx`. Present only because `BaseService` declares this
   * abstract.
   */
  protected async processCreateData(data: CreateFileRequest): Promise<CreateFileRequest> {
    return data
  }

  // ============= Reads =============

  /** @deprecated Use `getFolderFile(ctx, fileId)`. */
  async get(id: string, dbClient?: DatabaseClient): Promise<FolderFile | null> {
    return this.unwrap(await getFolderFile(this.filesCtx(dbClient), id))
  }

  /** @deprecated Use `getFolderFileWithRelations(ctx, fileId)`. */
  async getWithRelations(
    id: string,
    dbClient?: DatabaseClient
  ): Promise<FolderFileWithRelations | null> {
    return this.unwrap(await getFolderFileWithRelations(this.filesCtx(dbClient), id))
  }

  /** @deprecated Use `getFolderFileCurrentVersion(ctx, fileId)`. */
  async getCurrentVersion(entityId: string): Promise<FileVersionWithLocation | null> {
    return this.unwrap(await getFolderFileCurrentVersion(this.filesCtx(), entityId))
  }

  /** @deprecated Use `findOrphanedFolderFiles(ctx)`. */
  async findOrphanedFiles(): Promise<FolderFile[]> {
    return this.unwrap(await findOrphanedFolderFiles(this.filesCtx()))
  }

  // ============= Writes =============

  /**
   * @deprecated Use `createFolderFileWithVersion(tx, ctx, deps, input)`.
   *
   * Still opens its own transaction through `getTx` — its one caller
   * (`upload/processors/file-processor.ts`) may already be inside one, because
   * `BaseProcessor.process` rebinds the service with `withTx(opts.tx)`. Deciding
   * where that boundary belongs is Phase 6's job, so the legacy behaviour is
   * preserved verbatim here rather than changed under cover of Phase 5.
   */
  async createWithVersion(
    data: CreateFileRequest,
    storageLocationId: string
  ): Promise<{ file: FolderFile; version: FileVersion }> {
    return this.getTx(async (tx) => {
      const result = await createFolderFileWithVersion(
        // `getTx` is typed `DatabaseClient` because it may hand back either the
        // pool-opened transaction or an already-bound one. Phase 6 deletes it.
        tx as never,
        this.filesCtx(tx, data.organizationId),
        this.writeDeps(),
        {
          name: data.name,
          folderId: data.folderId,
          path: data.path,
          ext: data.ext,
          mimeType: data.mimeType,
          size: data.size,
          checksum: data.checksum,
          createdById: data.createdById ?? this.userId,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          storageLocationId,
        }
      )
      return this.unwrap(result)
    })
  }

  /** @deprecated Use `moveFolderFile(ctx, deps, fileId, targetFolderId)`. */
  async move(id: string, targetFolderId: string | null): Promise<FolderFile> {
    return this.unwrap(await moveFolderFile(this.filesCtx(), this.writeDeps(), id, targetFolderId))
  }

  /** @deprecated Use `renameFolderFile(ctx, deps, fileId, newName)`. */
  async rename(id: string, newName: string): Promise<FolderFile> {
    return this.unwrap(await renameFolderFile(this.filesCtx(), this.writeDeps(), id, newName))
  }

  // ============= Content & download =============

  /**
   * @deprecated Use `getFolderFileContent(ctx, deps, fileId)`.
   *
   * **No longer goes through `StorageManager`.** It delegates to
   * `folder-files/content.ts`, which addresses the object through a
   * `StoragePort` with the bucket taken off the `StorageLocation` row, so the
   * unscoped `StorageLocation` lookup `StorageManager.getContent(locationId)`
   * did behind the caller's back is gone — the row arrives joined onto the
   * version. The archived-file behaviour is unchanged: content is readable for
   * an archived file, while `getDownloadRef` refuses one. See that module's
   * header.
   */
  async getContent(id: string): Promise<Buffer> {
    return this.unwrap(await getFolderFileContent(this.filesCtx(), this.downloadDeps(), id))
  }

  /**
   * @deprecated Use `getFolderFileDownloadRef(ctx, deps, fileId, opts)` and read
   * `.url` off the ref — it is the single accessor that replaced this method,
   * `getDownloadRefForVersion` and `getDownloadInfo`.
   */
  async getDownloadRef(id: string): Promise<DownloadRef> {
    return this.unwrap(await getFolderFileDownloadRef(this.filesCtx(), this.downloadDeps(), id))
  }

  // ============= Internals =============

  /**
   * Build the `FilesCtx` the extracted functions take.
   *
   * `requireOrganization()` throws when the service was constructed without one.
   * That is the deliberate change: `FilesCtx.organizationId` is required, so the
   * "no organization means no filter" branch that widened queries across tenants
   * cannot be expressed any more.
   */
  private filesCtx(dbClient?: DatabaseClient, organizationId?: string): FilesCtx {
    return {
      db: (dbClient ?? this.db) as FilesCtx['db'],
      organizationId: organizationId ?? this.requireOrganization(),
    }
  }

  /** The `now` slice every `folder-files/` write takes, so `updatedAt` is not read off the wall clock. */
  private writeDeps(): Pick<FilesDeps, 'now'> {
    return { now: () => new Date() }
  }

  /** Storage + clock, for the download accessor. Built once because it caches an S3 adapter. */
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

/** @deprecated Construct a `FilesCtx` and call `files/folder-files/` directly. */
export const createFileService = (organizationId?: string, userId?: string) =>
  new FileService(organizationId, userId)
