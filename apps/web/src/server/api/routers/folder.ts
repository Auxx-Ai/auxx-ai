// apps/web/src/server/api/routers/folder.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { createScopedLogger } from '@auxx/logger'
import { createFolderService } from '@auxx/lib/files'
import { TRPCError } from '@trpc/server'

const logger = createScopedLogger('api/folder')

// Input schemas
const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().nullable().optional(),
})

const updateFolderSchema = z.object({
  folderId: z.string(),
  name: z.string().min(1).max(255).optional(),
  parentId: z.string().nullable().optional(),
})

const folderIdSchema = z.object({
  folderId: z.string(),
})

const moveFolderSchema = z.object({
  folderId: z.string(),
  targetParentId: z.string().nullable(),
})

const copyFolderSchema = z.object({
  sourceFolderId: z.string(),
  targetParentId: z.string().nullable(),
  newName: z.string().optional(),
})

const renameFolderSchema = z.object({
  folderId: z.string(),
  newName: z.string().min(1),
})

const mergeFolderSchema = z.object({
  sourceFolderId: z.string(),
  targetFolderId: z.string(),
})

const folderPathSchema = z.object({
  path: z.string(),
})

const validateNameSchema = z.object({
  name: z.string(),
  parentId: z.string().nullable(),
  excludeId: z.string().optional(),
})

const searchFoldersSchema = z.object({
  query: z.string().min(1),
  parentId: z.string().nullable().optional(),
  limit: z.number().min(1).max(100).default(20),
})

export const folderRouter = createTRPCRouter({
  // Query Procedures

  /** Get all folders in organization */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const result = await folderService.list()

      logger.info('Folders listed successfully', {
        count: result.items.length,
        total: result.total,
      })

      return result.items
    } catch (error) {
      logger.error('Failed to list folders', { error })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to list folders',
      })
    }
  }),

  /** Get folder by ID with relations */
  getById: protectedProcedure.input(folderIdSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const folder = await folderService.getById(input.folderId)

      if (!folder) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Folder not found',
        })
      }

      logger.info('Folder retrieved successfully', { folderId: input.folderId })
      return folder
    } catch (error) {
      logger.error('Failed to get folder', { error, input })

      if (error instanceof TRPCError) {
        throw error
      }

      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to get folder',
      })
    }
  }),

  /** Get complete folder tree */
  getTree: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const tree = await folderService.getFolderTree()

      logger.info('Folder tree retrieved successfully', {
        nodeCount: Array.isArray(tree) ? tree.length : 1,
      })

      return tree
    } catch (error) {
      logger.error('Failed to get folder tree', { error })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to get folder tree',
      })
    }
  }),

  /** Get immediate subfolders */
  getSubfolders: protectedProcedure.input(folderIdSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const subfolders = await folderService.getSubfolders(input.folderId)

      logger.info('Subfolders retrieved successfully', {
        folderId: input.folderId,
        count: subfolders.length,
      })

      return subfolders
    } catch (error) {
      logger.error('Failed to get subfolders', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to get subfolders',
      })
    }
  }),

  /** Get folder's ancestor chain */
  getAncestors: protectedProcedure.input(folderIdSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const ancestors = await folderService.getAncestors(input.folderId)

      logger.info('Folder ancestors retrieved successfully', {
        folderId: input.folderId,
        ancestorCount: ancestors.length,
      })

      return ancestors
    } catch (error) {
      logger.error('Failed to get folder ancestors', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to get ancestors',
      })
    }
  }),

  /** Get all descendant folders */
  getDescendants: protectedProcedure.input(folderIdSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const descendants = await folderService.getDescendants(input.folderId)

      logger.info('Folder descendants retrieved successfully', {
        folderId: input.folderId,
        descendantCount: descendants.length,
      })

      return descendants
    } catch (error) {
      logger.error('Failed to get folder descendants', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to get descendants',
      })
    }
  }),

  /** Search folders with relevance */
  search: protectedProcedure.input(searchFoldersSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const results = await folderService.search(input.query, {
        parentId: input.parentId,
        limit: input.limit,
      })

      logger.info('Folder search completed', {
        query: input.query,
        resultCount: results.length,
      })

      return results
    } catch (error) {
      logger.error('Folder search failed', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Search failed',
      })
    }
  }),

  /** Get folder statistics */
  getStats: protectedProcedure.input(folderIdSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const stats = await folderService.getStats(input.folderId)

      logger.info('Folder stats retrieved successfully', {
        folderId: input.folderId,
        stats,
      })

      return stats
    } catch (error) {
      logger.error('Failed to get folder stats', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to get stats',
      })
    }
  }),

  /** Get folder usage analytics */
  getUsage: protectedProcedure.input(folderIdSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const usage = await folderService.getUsage(input.folderId)

      logger.info('Folder usage retrieved successfully', {
        folderId: input.folderId,
        usage,
      })

      return usage
    } catch (error) {
      logger.error('Failed to get folder usage', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to get usage',
      })
    }
  }),

  /** Validate folder name uniqueness */
  validateName: protectedProcedure.input(validateNameSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const isValid = await folderService.validateName(input.name, input.parentId, input.excludeId)

      logger.info('Folder name validation completed', {
        name: input.name,
        isValid,
      })

      return { isValid }
    } catch (error) {
      logger.error('Failed to validate folder name', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to validate name',
      })
    }
  }),

  // Mutation Procedures

  /** Create new folder */
  create: protectedProcedure.input(createFolderSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const folder = await folderService.create({
        name: input.name,
        parentId: input.parentId,
        organizationId,
        createdById: userId,
      })

      logger.info('Folder created successfully', {
        folderId: folder.id,
        name: input.name,
        parentId: input.parentId,
      })

      return folder
    } catch (error) {
      logger.error('Failed to create folder', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to create folder',
      })
    }
  }),

  /** Update folder properties */
  update: protectedProcedure.input(updateFolderSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const folder = await folderService.update(input.folderId, {
        name: input.name,
        parentId: input.parentId,
      })

      logger.info('Folder updated successfully', {
        folderId: input.folderId,
        updates: { name: input.name, parentId: input.parentId },
      })

      return folder
    } catch (error) {
      logger.error('Failed to update folder', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to update folder',
      })
    }
  }),

  /** Soft delete folder and contents */
  delete: protectedProcedure.input(folderIdSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      await folderService.delete(input.folderId)

      logger.info('Folder deleted successfully', { folderId: input.folderId })
      return { success: true }
    } catch (error) {
      logger.error('Failed to delete folder', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to delete folder',
      })
    }
  }),

  /** Restore soft-deleted folder */
  restore: protectedProcedure.input(folderIdSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const folder = await folderService.restore(input.folderId)

      logger.info('Folder restored successfully', { folderId: input.folderId })
      return folder
    } catch (error) {
      logger.error('Failed to restore folder', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to restore folder',
      })
    }
  }),

  /** Permanently delete folder */
  permanentDelete: protectedProcedure.input(folderIdSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      await folderService.permanentDelete(input.folderId)

      logger.info('Folder permanently deleted', { folderId: input.folderId })
      return { success: true }
    } catch (error) {
      logger.error('Failed to permanently delete folder', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to permanently delete folder',
      })
    }
  }),

  /** Move folder to new parent */
  move: protectedProcedure.input(moveFolderSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const folder = await folderService.move(input.folderId, input.targetParentId)

      logger.info('Folder moved successfully', {
        folderId: input.folderId,
        targetParentId: input.targetParentId,
      })

      return folder
    } catch (error) {
      logger.error('Failed to move folder', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to move folder',
      })
    }
  }),

  /** Rename folder */
  rename: protectedProcedure.input(renameFolderSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const folder = await folderService.rename(input.folderId, input.newName)

      logger.info('Folder renamed successfully', {
        folderId: input.folderId,
        newName: input.newName,
      })

      return folder
    } catch (error) {
      logger.error('Failed to rename folder', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to rename folder',
      })
    }
  }),

  /** Copy folder with all contents */
  copy: protectedProcedure.input(copyFolderSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const newFolder = await folderService.copy(
        input.sourceFolderId,
        input.targetParentId,
        input.newName
      )

      logger.info('Folder copied successfully', {
        sourceFolderId: input.sourceFolderId,
        targetParentId: input.targetParentId,
        newFolderId: newFolder.id,
      })

      return newFolder
    } catch (error) {
      logger.error('Failed to copy folder', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to copy folder',
      })
    }
  }),

  /** Merge two folders */
  merge: protectedProcedure.input(mergeFolderSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const folder = await folderService.merge(input.sourceFolderId, input.targetFolderId)

      logger.info('Folders merged successfully', {
        sourceFolderId: input.sourceFolderId,
        targetFolderId: input.targetFolderId,
      })

      return folder
    } catch (error) {
      logger.error('Failed to merge folders', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to merge folders',
      })
    }
  }),

  /** Create folder path if not exists */
  ensurePath: protectedProcedure.input(folderPathSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    const folderService = createFolderService(organizationId, userId)

    try {
      const folder = await folderService.ensurePath(input.path)

      logger.info('Folder path ensured successfully', {
        path: input.path,
        folderId: folder.id,
      })

      return folder
    } catch (error) {
      logger.error('Failed to ensure folder path', { error, input })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to ensure path',
      })
    }
  }),
})
