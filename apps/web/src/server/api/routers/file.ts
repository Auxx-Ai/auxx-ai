// apps/web/src/server/api/routers/file.ts

import {
  createFileService,
  createFilesystemService,
  createMediaAssetService,
} from '@auxx/lib/files'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api/file')

// Input schemas
const listFilesSchema = z.object({
  folderId: z.string().nullable().optional(),
  search: z.string().optional(),
  fileTypes: z.array(z.string()).optional(),
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
  versionNumber: z.string(),
  comment: z.string().optional(),
})

const restoreVersionSchema = z.object({
  fileId: z.string(),
  versionId: z.string(),
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
  // Pagination for files
  filesCursor: z.string().optional(),
  filesLimit: z.number().min(1).max(1000).default(500),

  // Optional filtering
  fileTypes: z.array(z.string()).optional(),
  includeArchived: z.boolean().default(false),

  // Cache optimization
  lastSync: z.date().optional(),
})

const getAttachmentPreviewRefSchema = z.object({
  type: z.enum(['file', 'asset']),
  id: z.string(),
  version: z.union([z.literal('current'), z.literal('latest'), z.number()]).default('current'),
  disposition: z.enum(['inline', 'attachment']).default('inline'),
})

export const fileRouter = createTRPCRouter({
  // Query Procedures

  /** List files in a folder with pagination and filtering */
  list: protectedProcedure.input(listFilesSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const result = await fileService.listInFolder(input.folderId || null, {
        limit: input.limit,
        cursor: input.cursor,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
        fileTypes: input.fileTypes,
        includeArchived: input.includeArchived,
        search: input.search,
      })

      logger.info('Files listed successfully', {
        folderId: input.folderId,
        count: result.items.length,
        hasNextPage: result.hasNextPage,
        nextCursor: result.nextCursor,
      })

      return result
    } catch (error) {
      logger.error('Failed to list files', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to list files',
      })
    }
  }),

  /** Get file by ID with full relations */
  getById: protectedProcedure.input(fileIdSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const file = await fileService.getById(input.fileId)

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
  search: protectedProcedure.input(searchFilesSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const results = await fileService.search(input.query, {
        folderId: input.folderId,
        fileTypes: input.fileTypes,
        cursor: input.cursor,
        limit: input.limit,
      })

      logger.info('File search completed', {
        query: input.query,
        resultCount: results.items.length,
        hasNextPage: results.hasNextPage,
        nextCursor: results.nextCursor,
      })

      return results
    } catch (error) {
      logger.error('File search failed', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Search failed',
      })
    }
  }),

  /** Get download URL/info for a file */
  getDownloadInfo: protectedProcedure.input(fileIdSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const downloadInfo = await fileService.getDownloadInfo(input.fileId)

      if (!downloadInfo) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'File not found or not downloadable',
        })
      }

      logger.info('Download info retrieved', { fileId: input.fileId })
      return downloadInfo
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
  getVersions: protectedProcedure.input(fileIdSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const versions = await fileService.getVersions(input.fileId)

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
  findByExtension: protectedProcedure.input(findByExtensionSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const files = await fileService.findByExtension(input.extensions, {
        limit: input.limit,
      })

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
  findByMimeType: protectedProcedure.input(findByMimeTypeSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const files = await fileService.findByMimeType(input.mimeTypes, {
        limit: input.limit,
      })

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
  getFileSystem: protectedProcedure.input(getFileSystemSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const filesystemService = createFilesystemService(organizationId, userId)

    try {
      const result = await filesystemService.getCompleteFileSystem({
        filesCursor: input.filesCursor,
        filesLimit: input.filesLimit,
        fileTypes: input.fileTypes,
        includeArchived: input.includeArchived,
        lastSync: input.lastSync,
      })

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

  /** Get preview download reference for attachment (files or assets) */
  getAttachmentPreviewRef: protectedProcedure
    .input(getAttachmentPreviewRefSchema)
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      try {
        if (input.type === 'file') {
          const fileService = createFileService(organizationId, userId)
          const result = await fileService.getDownloadRefForVersion(input.id, {
            version: input.version,
            disposition: input.disposition,
          })

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

  // Mutation Procedures

  /** Soft delete a file */
  delete: protectedProcedure.input(fileIdSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      await fileService.delete(input.fileId)

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
  restore: protectedProcedure.input(fileIdSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const file = await fileService.restore(input.fileId)

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
  archive: protectedProcedure.input(fileIdSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const file = await fileService.archive(input.fileId)

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
  move: protectedProcedure.input(moveFileSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const file = await fileService.move(input.fileId, input.targetFolderId)

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
  rename: protectedProcedure.input(renameFileSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const file = await fileService.rename(input.fileId, input.newName)

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
  copy: protectedProcedure.input(copyFileSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const newFile = await fileService.copy(
        input.sourceFileId,
        input.targetFolderId,
        input.newName
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
  createVersion: protectedProcedure.input(createVersionSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      const version = await fileService.createVersion(input.fileId, {
        versionNumber: input.versionNumber,
        comment: input.comment,
        createdById: userId,
      })

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
  restoreVersion: protectedProcedure
    .input(restoreVersionSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const fileService = createFileService(organizationId, userId)

      try {
        const file = await fileService.restoreVersion(input.fileId, input.versionId)

        logger.info('File version restored successfully', {
          fileId: input.fileId,
          versionId: input.versionId,
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
  deleteVersion: protectedProcedure.input(restoreVersionSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const fileService = createFileService(organizationId, userId)

    try {
      await fileService.deleteVersion(input.versionId)

      logger.info('File version deleted successfully', {
        fileId: input.fileId,
        versionId: input.versionId,
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
  moveItems: protectedProcedure.input(moveItemsSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    try {
      const fsSvc = createFilesystemService(organizationId, userId)
      const result = await fsSvc.moveItems(input.items, input.targetFolderId, {
        mode: 'best-effort',
        collision: 'rename',
        dryRun: false,
      })

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
  renameItem: protectedProcedure.input(renameItemSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    try {
      const fsSvc = createFilesystemService(organizationId, userId)
      const result = await fsSvc.renameItem(input.id, input.type, input.newName)

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
