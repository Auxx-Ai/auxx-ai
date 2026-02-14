// apps/web/src/server/api/routers/segment.ts

import { IndexStatus } from '@auxx/database/enums'
import { SegmentService } from '@auxx/lib/datasets'
import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api/segment')
export const segmentRouter = createTRPCRouter({
  /**
   * Update segment content
   */
  updateContent: protectedProcedure
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
  toggleEnabled: protectedProcedure
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
  delete: protectedProcedure
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
  batchUpdate: protectedProcedure
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
  getById: protectedProcedure
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
      const segmentService = new SegmentService(ctx.db)
      return await segmentService.getById(input.segmentId, organizationId)
    }),
  /**
   * List segments for a document with search and pagination
   */
  listByDocument: protectedProcedure
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
  reindex: protectedProcedure
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
      const segmentService = new SegmentService(ctx.db)
      await segmentService.reindex(input.segmentId, organizationId)
      logger.info('Segment queued for reindexing', {
        segmentId: input.segmentId,
        organizationId,
      })
      return { success: true }
    }),
})
