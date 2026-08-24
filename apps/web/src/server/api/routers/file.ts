// apps/web/src/server/api/routers/file.ts

import { schema } from '@auxx/database'
import { createMediaAssetService } from '@auxx/lib/files'
import type { MoveEntryOutcome } from '@auxx/lib/files/server'
import {
  copyFolderFile,
  createFileVersion,
  deleteFileVersion,
  deleteFolderFile,
  executeMoveEntry,
  findFolderFilesByExtension,
  findFolderFilesByMimeType,
  getCompleteFileSystem,
  getFolderFileCurrentVersion,
  getFolderFileDownloadRef,
  getFolderFileVersions,
  getFolderFileWithRelations,
  listFolderFiles,
  moveFolderFile,
  planMoveItems,
  renameFilesystemItem,
  renameFolderFile,
  restoreFileVersion,
  restoreFolderFile,
  searchFolderFiles,
  summarizeMoveOutcomes,
  updateFolderFile,
} from '@auxx/lib/files/server'
import { FeatureKey, FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { z } from 'zod'
import {
  capabilityProcedure,
  createTRPCRouter,
  permissionProcedure,
  protectedProcedure,
} from '~/server/api/trpc'
import { assertDatasetDocumentAssetAccess } from '~/server/lib/dataset-document-asset-access'
import { toFilesCtx, toFilesDownloadDeps, toFilesWriteDeps } from '~/server/lib/files-ctx'

/**
 * Unwrap a `files/` `Result` into this router's throw-based flow.
 *
 * Every `folder-files/` function returns `Promise<Result<T, AuxxError>>`, and
 * the error is always an `AuxxError` subclass, so rethrowing it hands
 * `auxxErrorMiddleware` the right status: a missing file is 404, an empty name
 * 400, "cannot delete the current version" 409. Before PR 5c every one of those
 * was a bare `Error` that the per-procedure `catch` below flattened into
 * `BAD_REQUEST`.
 */
function unwrap<V>(result: Result<V, Error>): V {
  if (result.isErr()) throw result.error
  return result.value
}

const logger = createScopedLogger('api/file')

// Input schemas
const listFilesSchema = z.object({
  folderId: z.string().nullable().optional(),
  // No `search` here: `listFolderFiles` has no text filter, so a `search` field
  // would be silently dropped (it was, until 2026-07-31). Use the `search`
  // procedure below, which runs the relevance-scored query.
  fileTypes: z.array(z.string()).optional(),
  // Opaque cursor over `listFolderFiles`'s offset pagination — the read is
  // offset-based, so the cursor is the stringified next offset.
  cursor: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  sortBy: z.enum(['name', 'size', 'createdAt', 'updatedAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  includeArchived: z.boolean().default(false),
})

const fileIdSchema = z.object({
  fileId: z.string(),
})

const moveFileSchema = z.object({
  fileId: z.string(),
  targetFolderId: z.string().nullable(),
})

const renameFileSchema = z.object({
  fileId: z.string(),
  newName: z.string().min(1),
})

const copyFileSchema = z.object({
  sourceFileId: z.string(),
  targetFolderId: z.string().nullable(),
  newName: z.string().optional(),
})

const searchFilesSchema = z.object({
  query: z.string().min(1),
  folderId: z.string().nullable().optional(),
  fileTypes: z.array(z.string()).optional(),
  cursor: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
})

const findByExtensionSchema = z.object({
  extensions: z.array(z.string()),
  limit: z.number().min(1).max(100).default(50),
})

const findByMimeTypeSchema = z.object({
  mimeTypes: z.array(z.string()),
  limit: z.number().min(1).max(100).default(50),
})

const createVersionSchema = z.object({
  fileId: z.string(),
  // The version to snapshot content from. Omitted → the file's current version.
  // `FileVersion.versionNumber` is assigned by `createFileVersion` (last + 1);
  // it is not client-supplied, and the table carries no comment/author columns.
  storageLocationId: z.string().optional(),
})

// `FileVersion` is addressed by its integer `versionNumber` within a file, not
// by row id — `getFolderFileVersionByNumber` / `restoreFileVersion` /
// `deleteFileVersion` all take `(fileId, versionNumber)`.
const versionRefSchema = z.object({
  fileId: z.string(),
  versionNumber: z.number().int().positive(),
})

const moveItemsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['file', 'folder']),
    })
  ),
  targetFolderId: z.union([z.string(), z.null(), z.literal('root')]),
  position: z.enum(['above', 'below', 'inside']).optional(),
})

const renameItemSchema = z.object({
  id: z.string(),
  type: z.enum(['file', 'folder']),
  newName: z.string().min(1),
})

const getFileSystemSchema = z.object({
  // Pagination for files. The field MUST be named `cursor` — `useInfiniteQuery`
  // injects the page param under that key, and zod strips anything else, so the
  // previous `filesCursor` meant every `fetchNextPage()` refetched page 1.
  cursor: z.string().optional(),
  filesLimit: z.number().min(1).max(1000).default(500),

  // Optional filtering
  fileTypes: z.array(z.string()).optional(),
  includeArchived: z.boolean().default(false),

  // `lastSync` is gone with PR 5e. It selected an incremental `changes` payload
  // that cost six extra queries and that no client has ever asked for — the
  // Files store re-reads the page instead.
})

/**
 * Which resource authorizes an attachment preview.
 *
 * `files` (the default) — the Files app is the authority, so the request runs
 * the `FeatureKey.files` plan gate plus `filesView`, i.e. exactly what
 * `permissionProcedure(PermissionKey.filesView)` used to run for every caller.
 *
 * `datasetDocument` — the asset belongs to a dataset document, which is dataset
 * content and authorizes against the parent dataset instead. See
 * `assertDatasetDocumentAssetAccess` for why, and for the check that stops the
 * scope from being claimed over an unrelated asset.
 */
const attachmentPreviewScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('files') }),
  z.object({ kind: z.literal('datasetDocument'), documentId: z.string() }),
])

const getAttachmentPreviewRefSchema = z.object({
  type: z.enum(['file', 'asset']),
  id: z.string(),
  version: z.union([z.literal('current'), z.literal('latest'), z.number()]).default('current'),
  disposition: z.enum(['inline', 'attachment']).default('inline'),
  scope: attachmentPreviewScopeSchema.default({ kind: 'files' }),
})

export const fileRouter = createTRPCRouter({
  // Query Procedures

  /** List files in a folder with pagination and filtering */
  list: permissionProcedure(PermissionKey.filesView)
    .input(listFilesSchema)
    .query(async ({ ctx, input }) => {
      try {
        const offset = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0
        const result = unwrap(
          await listFolderFiles(toFilesCtx(ctx), {
            folderId: input.folderId || null,
            limit: input.limit,
            offset,
            sortBy: input.sortBy,
            sortOrder: input.sortOrder,
            fileTypes: input.fileTypes,
            includeArchived: input.includeArchived,
          })
        )

        const nextCursor = result.hasMore ? String(offset + result.items.length) : null

        logger.info('Files listed successfully', {
          folderId: input.folderId,
          count: result.items.length,
          hasNextPage: result.hasMore,
          nextCursor,
        })

        return { ...result, hasNextPage: result.hasMore, nextCursor }
      } catch (error) {
        logger.error('Failed to list files', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to list files',
        })
      }
    }),

  /** Get file by ID with full relations */
  getById: permissionProcedure(PermissionKey.filesView)
    .input(fileIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        // `getFolderFileWithRelations`, not a `getById` — the latter has never
        // existed, so this procedure threw `TypeError` for every caller until
        // 2026-07-31.
        const file = unwrap(await getFolderFileWithRelations(toFilesCtx(ctx), input.fileId))

        if (!file) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'File not found',
          })
        }

        logger.info('File retrieved successfully', { fileId: input.fileId })
        return file
      } catch (error) {
        logger.error('Failed to get file', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to get file',
        })
      }
    }),

  /** Search files with relevance scoring */
  search: permissionProcedure(PermissionKey.filesView)
    .input(searchFilesSchema)
    .query(async ({ ctx, input }) => {
      try {
        // `searchFolderFiles` has no `folderId` filter — it scores across the
        // whole org — so the folder filter is applied to the results here rather
        // than being passed in and silently ignored.
        const offset = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0
        const matches = unwrap(
          await searchFolderFiles(toFilesCtx(ctx), input.query, {
            fileTypes: input.fileTypes,
            offset,
            limit: input.limit,
          })
        )
        const items =
          input.folderId === undefined
            ? matches
            : matches.filter((match) => match.file.folderId === input.folderId)
        const hasNextPage = matches.length === input.limit
        const nextCursor = hasNextPage ? String(offset + matches.length) : null

        logger.info('File search completed', {
          query: input.query,
          resultCount: items.length,
          hasNextPage,
          nextCursor,
        })

        return { items, hasNextPage, nextCursor }
      } catch (error) {
        logger.error('File search failed', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Search failed',
        })
      }
    }),

  /** Get download URL/info for a file */
  getDownloadInfo: permissionProcedure(PermissionKey.filesView)
    .input(fileIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        // `FileDownloadInfo` is a projection of the one download accessor, not a
        // second one: `getFolderFileDownloadRef` already carries the filename,
        // MIME type and size off the row it loaded, so this costs no extra query.
        const ref = unwrap(
          await getFolderFileDownloadRef(toFilesCtx(ctx), toFilesDownloadDeps(ctx), input.fileId)
        )

        logger.info('Download info retrieved', { fileId: input.fileId })
        return {
          kind: ref.type === 'url' ? ('url' as const) : ('stream' as const),
          url: ref.type === 'url' ? ref.url : undefined,
          filename: ref.filename,
          mimeType: ref.mimeType,
          size: ref.size,
          expiresAt: ref.type === 'url' ? ref.expiresAt : undefined,
        }
      } catch (error) {
        logger.error('Failed to get download info', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to get download info',
        })
      }
    }),

  /** Get all versions of a file */
  getVersions: permissionProcedure(PermissionKey.filesView)
    .input(fileIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        const versions = unwrap(await getFolderFileVersions(toFilesCtx(ctx), input.fileId))

        logger.info('File versions retrieved', {
          fileId: input.fileId,
          versionCount: versions.length,
        })

        return versions
      } catch (error) {
        logger.error('Failed to get file versions', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to get versions',
        })
      }
    }),

  /** Find files by extension */
  findByExtension: permissionProcedure(PermissionKey.filesView)
    .input(findByExtensionSchema)
    .query(async ({ ctx, input }) => {
      try {
        const files = unwrap(
          await findFolderFilesByExtension(toFilesCtx(ctx), input.extensions, {
            limit: input.limit,
          })
        )

        logger.info('Files found by extension', {
          extensions: input.extensions,
          count: files.length,
        })

        return files
      } catch (error) {
        logger.error('Failed to find files by extension', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to find files',
        })
      }
    }),

  /** Find files by MIME type */
  findByMimeType: permissionProcedure(PermissionKey.filesView)
    .input(findByMimeTypeSchema)
    .query(async ({ ctx, input }) => {
      try {
        // Returned `[]` for every caller until PR 5c: the legacy
        // `findByMimeType` interpolated the whole array into one `LIKE` pattern
        // (`%image/png,application/pdf%`). See `folder-files/file-queries.ts`.
        const files = unwrap(
          await findFolderFilesByMimeType(toFilesCtx(ctx), input.mimeTypes, {
            limit: input.limit,
          })
        )

        logger.info('Files found by MIME type', {
          mimeTypes: input.mimeTypes,
          count: files.length,
        })

        return files
      } catch (error) {
        logger.error('Failed to find files by MIME type', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to find files',
        })
      }
    }),

  /** Get complete filesystem state in single call */
  getFileSystem: permissionProcedure(PermissionKey.filesView)
    .input(getFileSystemSchema)
    .query(async ({ ctx, input }) => {
      try {
        // Four statements regardless of folder count. The service this replaces
        // issued `3 + 2N` — two `COUNT(*)`s per folder, neither of them
        // organization-scoped. See `files/filesystem/filesystem-queries.ts`.
        const result = unwrap(
          await getCompleteFileSystem(toFilesCtx(ctx), {
            filesCursor: input.cursor,
            filesLimit: input.filesLimit,
            fileTypes: input.fileTypes,
            includeArchived: input.includeArchived,
          })
        )

        logger.info('Complete filesystem retrieved', {
          itemsCount: result.items.length,
          hasMoreFiles: result.filesHasNextPage,
          totalFiles: result.totalFiles,
          totalFolders: result.totalFolders,
        })

        return result
      } catch (error) {
        logger.error('Failed to get complete filesystem', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to get filesystem',
        })
      }
    }),

  /**
   * Get preview download reference for attachment (files or assets).
   *
   * The returned ref is a live, presigned download URL for any `FolderFile` or
   * `MediaAsset` in the org, resolved by id with no ownership or folder check, so
   * it must be authorized — as a bare `protectedProcedure` it made the `filesView`
   * gate on `getDownloadInfo` (the same read, one procedure over) decorative.
   *
   * Authorization is per `input.scope`, because the two callers are owned by
   * different resources. The Files detail drawer keeps `FeatureKey.files` +
   * `filesView`; the dataset document drawer authorizes against its parent
   * dataset, matching `document.getDownloadUrl`, which already resolves the same
   * bytes for the same principal. A single `permissionProcedure(filesView)` here
   * meant a member scoped to a dataset with `files` below Read could download a
   * document but not preview it — the gate blocked no content, it only broke the
   * pane. No plan gate on the dataset branch, matching every procedure in
   * `routers/document.ts`, which is `capabilityProcedure` throughout.
   *
   * The gates run BEFORE the try/catch below on purpose: that catch rewrites
   * anything that is not a `TRPCError` into a 400, which would flatten a denial
   * into `BAD_REQUEST` instead of 403/404.
   */
  getAttachmentPreviewRef: capabilityProcedure
    .input(getAttachmentPreviewRefSchema)
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      if (input.scope.kind === 'datasetDocument') {
        if (input.type !== 'asset') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Dataset documents are backed by media assets',
          })
        }
        await assertDatasetDocumentAssetAccess(ctx.db, ctx.capabilities, {
          documentId: input.scope.documentId,
          assetId: input.id,
          organizationId,
        })
      } else {
        await new FeaturePermissionService().requireAccess(organizationId, FeatureKey.files)
        ctx.capabilities.assert(PermissionKey.filesView)
      }

      try {
        if (input.type === 'file') {
          const result = unwrap(
            await getFolderFileDownloadRef(toFilesCtx(ctx), toFilesDownloadDeps(ctx), input.id, {
              version: input.version,
              disposition: input.disposition,
            })
          )

          logger.info('File preview reference retrieved', {
            fileId: input.id,
            version: input.version,
            disposition: input.disposition,
          })

          return result
        } else if (input.type === 'asset') {
          const assetService = createMediaAssetService(organizationId, userId)
          const result = await assetService.getDownloadRefForVersion(input.id, {
            version: input.version,
            disposition: input.disposition,
          })

          logger.info('Asset preview reference retrieved', {
            assetId: input.id,
            version: input.version,
            disposition: input.disposition,
          })

          return result
        } else {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid attachment type',
          })
        }
      } catch (error) {
        logger.error('Failed to get attachment preview reference', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to get preview reference',
        })
      }
    }),

  /**
   * Resolve file ref strings ("asset:id" / "file:id") into display details.
   * Used by FILE field components to fetch name, mimeType, size for each ref.
   */
  resolveFileRefs: protectedProcedure
    .input(z.object({ refs: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      if (input.refs.length === 0) return []

      const assetIds: string[] = []
      const fileIds: string[] = []
      for (const ref of input.refs) {
        const colonIdx = ref.indexOf(':')
        if (colonIdx === -1) continue
        const type = ref.slice(0, colonIdx)
        const id = ref.slice(colonIdx + 1)
        if (type === 'asset') assetIds.push(id)
        else if (type === 'file') fileIds.push(id)
      }

      const results: Array<{
        ref: string
        name: string
        mimeType: string | null
        size: number | null
      }> = []

      if (assetIds.length > 0) {
        const assets = await ctx.db
          .select({
            id: schema.MediaAsset.id,
            name: schema.MediaAsset.name,
            mimeType: schema.MediaAsset.mimeType,
            size: schema.MediaAsset.size,
          })
          .from(schema.MediaAsset)
          .where(
            and(
              eq(schema.MediaAsset.organizationId, ctx.session.organizationId),
              inArray(schema.MediaAsset.id, assetIds),
              isNull(schema.MediaAsset.deletedAt)
            )
          )
        results.push(
          ...assets.map((a) => ({
            ref: `asset:${a.id}`,
            name: a.name ?? 'Untitled',
            mimeType: a.mimeType,
            size: a.size,
          }))
        )
      }

      if (fileIds.length > 0) {
        const files = await ctx.db
          .select({
            id: schema.FolderFile.id,
            name: schema.FolderFile.name,
            mimeType: schema.FolderFile.mimeType,
            size: schema.FolderFile.size,
          })
          .from(schema.FolderFile)
          .where(
            and(
              eq(schema.FolderFile.organizationId, ctx.session.organizationId),
              inArray(schema.FolderFile.id, fileIds),
              isNull(schema.FolderFile.deletedAt)
            )
          )
        results.push(
          ...files.map((f) => ({
            ref: `file:${f.id}`,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size,
          }))
        )
      }

      return results
    }),

  // Mutation Procedures

  /** Soft delete a file */
  delete: permissionProcedure(PermissionKey.filesManage)
    .input(fileIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Idempotent: deleting an id that names nothing succeeds, which is what
        // the legacy `delete` did and what a double-clicked button relies on.
        unwrap(await deleteFolderFile(toFilesCtx(ctx), toFilesWriteDeps(), input.fileId))

        logger.info('File deleted successfully', { fileId: input.fileId })
        return { success: true }
      } catch (error) {
        logger.error('Failed to delete file', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to delete file',
        })
      }
    }),

  /** Restore a soft-deleted file */
  restore: permissionProcedure(PermissionKey.filesManage)
    .input(fileIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const file = unwrap(
          await restoreFolderFile(toFilesCtx(ctx), toFilesWriteDeps(), input.fileId)
        )

        logger.info('File restored successfully', { fileId: input.fileId })
        return file
      } catch (error) {
        logger.error('Failed to restore file', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to restore file',
        })
      }
    }),

  /** Archive a file */
  archive: permissionProcedure(PermissionKey.filesManage)
    .input(fileIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // There has never been an `archive` operation; archiving is the
        // `isArchived` flag on the row.
        const file = unwrap(
          await updateFolderFile(toFilesCtx(ctx), toFilesWriteDeps(), input.fileId, {
            isArchived: true,
          })
        )

        logger.info('File archived successfully', { fileId: input.fileId })
        return file
      } catch (error) {
        logger.error('Failed to archive file', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to archive file',
        })
      }
    }),

  /** Move file to different folder */
  move: permissionProcedure(PermissionKey.filesManage)
    .input(moveFileSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const file = unwrap(
          await moveFolderFile(
            toFilesCtx(ctx),
            toFilesWriteDeps(),
            input.fileId,
            input.targetFolderId
          )
        )

        logger.info('File moved successfully', {
          fileId: input.fileId,
          targetFolderId: input.targetFolderId,
        })

        return file
      } catch (error) {
        logger.error('Failed to move file', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to move file',
        })
      }
    }),

  /** Rename a file */
  rename: permissionProcedure(PermissionKey.filesManage)
    .input(renameFileSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const file = unwrap(
          await renameFolderFile(toFilesCtx(ctx), toFilesWriteDeps(), input.fileId, input.newName)
        )

        logger.info('File renamed successfully', {
          fileId: input.fileId,
          newName: input.newName,
        })

        return file
      } catch (error) {
        logger.error('Failed to rename file', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to rename file',
        })
      }
    }),

  /** Copy file to different location */
  copy: permissionProcedure(PermissionKey.filesManage)
    .input(copyFileSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // The row and its whole version history are copied in ONE transaction,
        // opened here. The legacy `copy` inserted the file and then looped
        // `createVersion`, each in its own savepoint, so a failure halfway left
        // a half-copied file that nothing could tell from a real one.
        const filesCtx = toFilesCtx(ctx)
        const newFile = await ctx.db.transaction(async (tx) =>
          unwrap(
            await copyFolderFile(tx, { ...filesCtx, db: tx }, toFilesWriteDeps(), {
              sourceFileId: input.sourceFileId,
              targetFolderId: input.targetFolderId,
              newName: input.newName,
              createdById: ctx.session.userId,
            })
          )
        )

        logger.info('File copied successfully', {
          sourceFileId: input.sourceFileId,
          targetFolderId: input.targetFolderId,
          newFileId: newFile.id,
        })

        return newFile
      } catch (error) {
        logger.error('Failed to copy file', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to copy file',
        })
      }
    }),

  /** Create new version of file */
  createVersion: permissionProcedure(PermissionKey.filesManage)
    .input(createVersionSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const filesCtx = toFilesCtx(ctx)
        const storageLocationId =
          input.storageLocationId ??
          unwrap(await getFolderFileCurrentVersion(filesCtx, input.fileId))?.storageLocationId
        if (!storageLocationId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'File has no stored content to version',
          })
        }
        // Two statements — insert the row, move `currentVersionId` — so the
        // transaction is opened here rather than guessed at inside lib.
        const version = await ctx.db.transaction(async (tx) =>
          unwrap(
            await createFileVersion(tx, filesCtx, {
              fileId: input.fileId,
              storageLocationId,
            })
          )
        )

        logger.info('File version created successfully', {
          fileId: input.fileId,
          versionId: version.id,
        })

        return version
      } catch (error) {
        logger.error('Failed to create file version', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to create version',
        })
      }
    }),

  /** Restore to specific version */
  restoreVersion: permissionProcedure(PermissionKey.filesManage)
    .input(versionRefSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const file = unwrap(
          await restoreFileVersion(
            toFilesCtx(ctx),
            toFilesWriteDeps(),
            input.fileId,
            input.versionNumber
          )
        )

        logger.info('File version restored successfully', {
          fileId: input.fileId,
          versionNumber: input.versionNumber,
        })

        return file
      } catch (error) {
        logger.error('Failed to restore file version', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to restore version',
        })
      }
    }),

  /** Delete a specific version */
  deleteVersion: permissionProcedure(PermissionKey.filesManage)
    .input(versionRefSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // A `FileVersion` is addressed by `(fileId, versionNumber)`, never by row
        // id — this used to pass a version id into the `fileId` slot, and every
        // call threw "file not found".
        unwrap(await deleteFileVersion(toFilesCtx(ctx), input.fileId, input.versionNumber))

        logger.info('File version deleted successfully', {
          fileId: input.fileId,
          versionNumber: input.versionNumber,
        })

        return { success: true }
      } catch (error) {
        logger.error('Failed to delete file version', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to delete version',
        })
      }
    }),

  /** Move multiple files and folders to a target folder */
  moveItems: permissionProcedure(PermissionKey.filesManage)
    .input(moveItemsSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const filesCtx = toFilesCtx(ctx)
        const deps = toFilesWriteDeps()

        // Plan first, with no writes: three statements answer every collision,
        // rename and cycle question that used to cost one query apiece.
        const plan = unwrap(
          await planMoveItems(filesCtx, {
            items: input.items,
            targetFolderId: input.targetFolderId,
            collision: 'rename',
          })
        )

        // ONE TRANSACTION PER ENTRY, opened here because this is where the
        // boundary belongs. Best-effort means a failed item must not roll back
        // the ones already moved; move-plus-rename must still land together.
        // `FilesystemService` opened these inside lib on a `Database |
        // Transaction`, so whether they isolated anything or merely issued a
        // SAVEPOINT depended on who constructed the service.
        const outcomes: MoveEntryOutcome[] = []
        for (const entry of plan) {
          if (entry.reason) {
            outcomes.push({
              id: entry.id,
              type: entry.type,
              status: 'skipped',
              reason: entry.reason,
            })
            continue
          }
          try {
            const item = await ctx.db.transaction(async (tx) =>
              unwrap(await executeMoveEntry(tx, { ...filesCtx, db: tx }, entry, deps))
            )
            outcomes.push({
              id: entry.id,
              type: entry.type,
              status: 'moved',
              renamed: entry.willRename === true,
              item,
            })
          } catch (error) {
            outcomes.push({
              id: entry.id,
              type: entry.type,
              status: 'failed',
              error: error instanceof Error ? error.message : 'Move failed',
            })
          }
        }

        const result = summarizeMoveOutcomes(outcomes)

        logger.info('Bulk move completed', {
          items: input.items.map((i) => ({ id: i.id, type: i.type })),
          targetFolderId: input.targetFolderId,
          moved: result.moved,
          failed: result.failed,
          skipped: result.skipped,
        })

        return result
      } catch (error) {
        logger.error('Failed to move items', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to move items',
        })
      }
    }),

  /** Rename a file or folder */
  renameItem: permissionProcedure(PermissionKey.filesManage)
    .input(renameItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // A folder rename rewrites the path of every descendant folder and
        // file, so the whole thing is one transaction — opened here, not
        // guessed at inside lib.
        const filesCtx = toFilesCtx(ctx)
        const result = await ctx.db.transaction(async (tx) =>
          unwrap(
            await renameFilesystemItem(
              tx,
              { ...filesCtx, db: tx },
              input.id,
              input.type,
              input.newName,
              toFilesWriteDeps()
            )
          )
        )

        logger.info('Item renamed successfully', {
          id: input.id,
          type: input.type,
          newName: input.newName,
        })

        return result
      } catch (error) {
        logger.error('Failed to rename item', { error, input })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to rename item',
        })
      }
    }),
})
