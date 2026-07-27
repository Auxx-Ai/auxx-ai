// apps/web/src/server/api/routers/segment.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { IndexStatus } from '@auxx/database/enums'
import { SegmentService } from '@auxx/lib/datasets'
import { NotFoundError } from '@auxx/lib/errors'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '~/server/api/trpc'

const logger = createScopedLogger('api/segment')

/**
 * Resolve a segment to its grandparent `datasetId` via the segment's document —
 * segments inherit their dataset's access level same as documents (doc 11 §3).
 * Org-scoped; 404s a missing/foreign segment.
 */
async function datasetIdForSegment(
  db: Database,
  segmentId: string,
  organizationId: string
): Promise<string> {
  const [row] = await db
    .select({ datasetId: schema.Document.datasetId })
    .from(schema.DocumentSegment)
    .innerJoin(schema.Document, eq(schema.DocumentSegment.documentId, schema.Document.id))
    .where(
      and(
        eq(schema.DocumentSegment.id, segmentId),
        eq(schema.DocumentSegment.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!row) throw new NotFoundError('Segment not found')
  return row.datasetId
}

/** Resolve a batch of segments to their distinct grandparent `datasetId`s (§3). */
async function datasetIdsForSegments(
  db: Database,
  segmentIds: string[],
  organizationId: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ datasetId: schema.Document.datasetId })
    .from(schema.DocumentSegment)
    .innerJoin(schema.Document, eq(schema.DocumentSegment.documentId, schema.Document.id))
    .where(
      and(
        inArray(schema.DocumentSegment.id, segmentIds),
        eq(schema.DocumentSegment.organizationId, organizationId)
      )
    )
  return rows.map((r) => r.datasetId)
}

/** Resolve a document to its parent `datasetId` (doc 11 §3). Org-scoped; 404s a missing document. */
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

export const segmentRouter = createTRPCRouter({
  /**
   * Update segment content
   */
  updateContent: capabilityProcedure
    .input(
      z.object({
        segmentId: z.string(),
        content: z.string().min(1).max(10000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const datasetId = await datasetIdForSegment(ctx.db, input.segmentId, organizationId)
      ctx.capabilities.assertEditInstance('dataset', datasetId)
      const segmentService = new SegmentService(ctx.db)
      const updatedSegment = await segmentService.updateContent(
        input.segmentId,
        input.content,
        organizationId
      )
      logger.info('Segment content updated', {
        segmentId: input.segmentId,
        organizationId,
      })
      return updatedSegment
    }),
  /**
   * Toggle segment enabled status
   */
  toggleEnabled: capabilityProcedure
    .input(
      z.object({
        segmentId: z.string(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const datasetId = await datasetIdForSegment(ctx.db, input.segmentId, organizationId)
      ctx.capabilities.assertEditInstance('dataset', datasetId)
      const segmentService = new SegmentService(ctx.db)
      const updatedSegment = await segmentService.toggleEnabled(
        input.segmentId,
        input.enabled,
        organizationId
      )
      logger.info('Segment enabled status toggled', {
        segmentId: input.segmentId,
        enabled: input.enabled,
        organizationId,
      })
      return updatedSegment
    }),
  /**
   * Delete a segment
   */
  delete: capabilityProcedure
    .input(
      z.object({
        segmentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const datasetId = await datasetIdForSegment(ctx.db, input.segmentId, organizationId)
      ctx.capabilities.assertEditInstance('dataset', datasetId)
      const segmentService = new SegmentService(ctx.db)
      await segmentService.delete(input.segmentId, organizationId)
      logger.info('Segment deleted', {
        segmentId: input.segmentId,
        organizationId,
      })
      return { success: true }
    }),
  /**
   * Batch update segments
   */
  batchUpdate: capabilityProcedure
    .input(
      z.object({
        segmentIds: z.array(z.string()).min(1).max(100),
        operation: z.enum(['enable', 'disable', 'delete', 'reindex']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      // Write — resolve every segment to its dataset and require Edit on all.
      const datasetIds = await datasetIdsForSegments(ctx.db, input.segmentIds, organizationId)
      for (const datasetId of datasetIds) {
        ctx.capabilities.assertEditInstance('dataset', datasetId)
      }
      const segmentService = new SegmentService(ctx.db)
      const results = await segmentService.batchOperation(
        input.segmentIds,
        input.operation,
        organizationId
      )
      logger.info('Batch segment operation completed', {
        operation: input.operation,
        segmentCount: input.segmentIds.length,
        organizationId,
      })
      return results
    }),
  /**
   * Get segment by ID
   */
  getById: capabilityProcedure
    .input(
      z.object({
        segmentId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        return null
      }
      const datasetId = await datasetIdForSegment(ctx.db, input.segmentId, organizationId)
      ctx.capabilities.assertViewInstance('dataset', datasetId)
      const segmentService = new SegmentService(ctx.db)
      return await segmentService.getById(input.segmentId, organizationId)
    }),
  /**
   * List segments for a document with search and pagination
   */
  listByDocument: capabilityProcedure
    .input(
      z.object({
        documentId: z.string(),
        search: z.string().optional(),
        enabled: z.boolean().optional(),
        indexStatus: z.enum(IndexStatus).optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(500).default(50),
        sortBy: z.enum(['position', 'content', 'updatedAt']).default('position').optional(),
        sortOrder: z.enum(['asc', 'desc']).default('asc').optional(),
        cursor: z.number().optional(), // For cursor-based pagination
      })
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        return { segments: [], totalCount: 0, hasMore: false, page: input.page }
      }
      const datasetId = await datasetIdForDocument(ctx.db, input.documentId, organizationId)
      ctx.capabilities.assertViewInstance('dataset', datasetId)
      const segmentService = new SegmentService(ctx.db)
      return await segmentService.listByDocument(
        input.documentId,
        organizationId,
        {
          search: input.search,
          enabled: input.enabled,
          indexStatus: input.indexStatus,
        },
        {
          page: input.page,
          limit: input.limit,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
          cursor: input.cursor,
        }
      )
    }),
  /**
   * Reindex a segment
   */
  reindex: capabilityProcedure
    .input(
      z.object({
        segmentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new Error('No organization found')
      }
      const datasetId = await datasetIdForSegment(ctx.db, input.segmentId, organizationId)
      ctx.capabilities.assertEditInstance('dataset', datasetId)
      const segmentService = new SegmentService(ctx.db)
      await segmentService.reindex(input.segmentId, organizationId)
      logger.info('Segment queued for reindexing', {
        segmentId: input.segmentId,
        organizationId,
      })
      return { success: true }
    }),
})
