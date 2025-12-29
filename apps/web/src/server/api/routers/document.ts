// apps/web/src/server/api/routers/document.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { createScopedLogger } from '@auxx/logger'
import { DocumentService } from '@auxx/lib/datasets'
import { DocumentModel } from '@auxx/database/models'
import { DocumentStatus, ChunkingStrategyValues } from '@auxx/database/enums'
const logger = createScopedLogger('api/document')

/** Preprocessing options schema for chunk settings */
const chunkPreprocessingSchema = z.object({
  normalizeWhitespace: z.boolean(),
  removeUrlsAndEmails: z.boolean(),
})

/** Chunk settings schema for document-level override */
const chunkSettingsSchema = z.object({
  strategy: z.enum(ChunkingStrategyValues),
  size: z.number().min(100).max(5000),
  overlap: z.number().min(0).max(1000),
  delimiter: z.string().max(50).nullable().optional(),
  preprocessing: chunkPreprocessingSchema,
})
const listDocumentsSchema = z.object({
  datasetId: z.string(),
  status: z.enum(DocumentStatus).optional(),
  search: z.string().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  sortBy: z.string().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})
export const documentRouter = createTRPCRouter({
  /**
   * List documents in a dataset
   */
  list: protectedProcedure.input(listDocumentsSchema).query(async ({ ctx, input }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    if (!organizationId) {
      return { documents: [], totalCount: 0, hasMore: false }
    }
    const model = new DocumentModel(organizationId)
    const listRes = await model.list({
      datasetId: input.datasetId,
      status: input.status as any,
      search: input.search,
      page: input.page,
      limit: input.limit,
      sortBy: input.sortBy as any,
      sortOrder: input.sortOrder,
    })
    if (!listRes.ok) throw listRes.error
    const { documents, totalCount } = listRes.value
    return {
      documents,
      totalCount,
      hasMore: totalCount > input.page * input.limit,
    }
  }),

  /**
   * Get a document by ID
   */
  getById: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        return null
      }
      const documentService = new DocumentService(ctx.db)
      return await documentService.getById(input.documentId, organizationId)
    }),

  /**
   * Delete a document
   */
  delete: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const documentService = new DocumentService(ctx.db)
      await documentService.delete(input.documentId, organizationId)
      logger.info('Document deleted', {
        documentId: input.documentId,
        organizationId,
      })
      return { success: true }
    }),

  /**
   * Reprocess a document
   */
  reprocess: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const documentService = new DocumentService(ctx.db)
      await documentService.reprocess(input.documentId, organizationId, {
        updateChunking: true,
        priority: 2,
      })
      logger.info('Document queued for reprocessing', {
        documentId: input.documentId,
        organizationId,
      })
      return { success: true }
    }),
  /**
   * Get document download URL
   */
  getDownloadUrl: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        return null
      }
      const documentService = new DocumentService(ctx.db)
      return await documentService.getDownloadUrl(input.documentId, organizationId)
    }),
  /**
   * Update a document (title, status, enabled, chunkSettings)
   */
  update: protectedProcedure
    .input(
      z.object({
        documentId: z.string(),
        title: z.string().min(1).max(255).optional(),
        status: z.enum(['INDEXED', 'ARCHIVED']).optional(),
        enabled: z.boolean().optional(),
        /** Pass partial settings to update, null to clear override (revert to dataset defaults) */
        chunkSettings: chunkSettingsSchema.partial().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const documentService = new DocumentService(ctx.db)
      const { documentId, ...data } = input
      await documentService.update(documentId, organizationId, data)
      logger.info('Document updated', {
        documentId,
        organizationId,
        updates: data,
      })
      return await documentService.getById(documentId, organizationId)
    }),
  /**
   * Create documents from existing files
   * Single endpoint, duplicate checking handled internally
   */
  createFromExistingFiles: protectedProcedure
    .input(
      z.object({
        fileSelections: z.array(
          z.object({
            fileId: z.string(),
            fileVersionId: z.string().optional(),
            title: z.string().optional(),
          })
        ),
        datasetId: z.string(),
        skipDuplicates: z.boolean().default(true),
        processImmediately: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const documentService = new DocumentService(ctx.db)
      const results = await documentService.createFromExistingFiles(
        {
          ...input,
          uploadedById: ctx.session.user.id,
        },
        organizationId
      )
      logger.info('Documents created from existing files', {
        created: results.created.length,
        skipped: results.skipped.length,
        failed: results.failed.length,
        datasetId: input.datasetId,
        organizationId,
      })
      return results
    }),

  /**
   * Batch process documents (enable, disable, archive, delete, reprocess)
   */
  batchProcess: protectedProcedure
    .input(
      z.object({
        documentIds: z.array(z.string()).min(1),
        operation: z.enum(['reprocess', 'delete', 'archive', 'enable', 'disable']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const documentService = new DocumentService(ctx.db)
      const results = await documentService.batchProcess(organizationId, {
        documentIds: input.documentIds,
        operation: input.operation,
      })
      logger.info('Batch process completed', {
        operation: input.operation,
        success: results.success,
        failed: results.failed,
        organizationId,
      })
      return results
    }),
})
