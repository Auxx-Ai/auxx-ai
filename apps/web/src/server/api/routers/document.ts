// apps/web/src/server/api/routers/document.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { ChunkingStrategyValues, DocumentStatus } from '@auxx/database/enums'
import { DocumentService } from '@auxx/lib/datasets'
import { NotFoundError } from '@auxx/lib/errors'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, count, desc, eq, ilike, inArray, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '~/server/api/trpc'

const logger = createScopedLogger('api/document')

/**
 * Resolve a document to its parent `datasetId` — documents inherit their
 * dataset's access level (doc 11 §3), so every document gate keys on the
 * parent. Org-scoped; 404s a missing/foreign document.
 */
async function datasetIdForDocument(
  db: Database,
  documentId: string,
  organizationId: string
): Promise<string> {
  const [row] = await db
    .select({ datasetId: schema.Document.datasetId })
    .from(schema.Document)
    .where(
      and(eq(schema.Document.id, documentId), eq(schema.Document.organizationId, organizationId))
    )
    .limit(1)
  if (!row) throw new NotFoundError('Document not found')
  return row.datasetId
}

/** Resolve a batch of documents to their distinct parent `datasetId`s (§3). */
async function datasetIdsForDocuments(
  db: Database,
  documentIds: string[],
  organizationId: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ datasetId: schema.Document.datasetId })
    .from(schema.Document)
    .where(
      and(
        inArray(schema.Document.id, documentIds),
        eq(schema.Document.organizationId, organizationId)
      )
    )
  return rows.map((r) => r.datasetId)
}

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
  list: capabilityProcedure.input(listDocumentsSchema).query(async ({ ctx, input }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    if (!organizationId) {
      return { documents: [], totalCount: 0, hasMore: false }
    }
    ctx.capabilities.assertViewInstance('dataset', input.datasetId)

    const page = input.page
    const limit = input.limit
    const offset = (page - 1) * limit

    const whereParts: SQL<unknown>[] = [
      eq(schema.Document.organizationId, organizationId),
      eq(schema.Document.datasetId, input.datasetId),
    ]
    if (input.status) {
      whereParts.push(eq(schema.Document.status, input.status as any))
    }
    if (input.search) {
      whereParts.push(ilike(schema.Document.title, `%${input.search}%`))
    }

    const whereClause = and(...whereParts)

    // Determine sort column and direction
    let orderByClause: SQL<unknown> | undefined
    if (input.sortBy) {
      const col = (schema.Document as any)[input.sortBy]
      if (col) {
        orderByClause = input.sortOrder === 'asc' ? (asc(col) as any) : (desc(col) as any)
      }
    }
    if (!orderByClause) {
      orderByClause = desc(schema.Document.createdAt) as any
    }

    // Query page of documents
    const documents = await ctx.db
      .select()
      .from(schema.Document)
      .where(whereClause)
      .orderBy(orderByClause as any)
      .limit(limit)
      .offset(offset)

    // Count total
    const [countRow] = await ctx.db
      .select({ value: count() })
      .from(schema.Document)
      .where(whereClause)
    const totalCount = countRow?.value ?? 0

    return {
      documents,
      totalCount,
      hasMore: totalCount > page * limit,
    }
  }),

  /**
   * Get a document by ID
   */
  getById: capabilityProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        return null
      }
      const datasetId = await datasetIdForDocument(ctx.db, input.documentId, organizationId)
      ctx.capabilities.assertViewInstance('dataset', datasetId)
      const documentService = new DocumentService(ctx.db)
      return await documentService.getById(input.documentId, organizationId)
    }),

  /**
   * Delete a document
   */
  delete: capabilityProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const datasetId = await datasetIdForDocument(ctx.db, input.documentId, organizationId)
      ctx.capabilities.assertEditInstance('dataset', datasetId)
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
  reprocess: capabilityProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const datasetId = await datasetIdForDocument(ctx.db, input.documentId, organizationId)
      ctx.capabilities.assertEditInstance('dataset', datasetId)
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
  getDownloadUrl: capabilityProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        return null
      }
      const datasetId = await datasetIdForDocument(ctx.db, input.documentId, organizationId)
      ctx.capabilities.assertViewInstance('dataset', datasetId)
      const documentService = new DocumentService(ctx.db)
      return await documentService.getDownloadUrl(input.documentId, organizationId)
    }),
  /**
   * Update a document (title, status, enabled, chunkSettings)
   */
  update: capabilityProcedure
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
      const datasetId = await datasetIdForDocument(ctx.db, input.documentId, organizationId)
      ctx.capabilities.assertEditInstance('dataset', datasetId)
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
  createFromExistingFiles: capabilityProcedure
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
      // Write — adding files to the target dataset.
      ctx.capabilities.assertEditInstance('dataset', input.datasetId)
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
  batchProcess: capabilityProcedure
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
      // Write — resolve each document to its dataset and require Edit on all.
      const datasetIds = await datasetIdsForDocuments(ctx.db, input.documentIds, organizationId)
      for (const datasetId of datasetIds) {
        ctx.capabilities.assertEditInstance('dataset', datasetId)
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
