// packages/lib/src/datasets/services/segment-service.ts

import { type Database, schema } from '@auxx/database'
import { IndexStatus as IndexStatusEnum } from '@auxx/database/enums'
import type { IndexStatus } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, count, desc, eq, gt, gte, ilike, lte, or, type SQL, sql } from 'drizzle-orm'
import { DocumentProcessingError } from '../types'

const logger = createScopedLogger('segment-service')

interface SegmentFilters {
  search?: string
  enabled?: boolean
  indexStatus?: IndexStatus
  minPosition?: number
  maxPosition?: number
}

interface PaginationParams {
  page?: number
  limit?: number
  sortBy?: 'position' | 'content' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  cursor?: number
}

interface SegmentListResponse {
  segments: any[]
  totalCount: number
  hasMore: boolean
  page: number
  nextCursor?: number
}

/**
 * Service for managing document segments
 */
export class SegmentService {
  constructor(private db: Database) {}

  /**
   * Get segment by ID
   */
  async getById(segmentId: string, organizationId: string) {
    try {
      return await this.db.query.DocumentSegment.findFirst({
        where: (segments, { eq, and }) =>
          and(eq(segments.id, segmentId), eq(segments.organizationId, organizationId)),
        with: {
          document: {
            columns: {
              id: true,
              title: true,
              filename: true,
              datasetId: true,
            },
          },
        },
      })
    } catch (error) {
      throw new DocumentProcessingError('Failed to get segment', { error, segmentId })
    }
  }

  /**
   * Update segment content
   */
  async updateContent(segmentId: string, content: string, organizationId: string) {
    try {
      // Verify segment exists and belongs to organization
      const segment = await this.getById(segmentId, organizationId)
      if (!segment) {
        throw new DocumentProcessingError('Segment not found', { segmentId })
      }

      // Calculate new token count (rough estimation)
      const tokenCount = Math.ceil(content.length / 4)

      // Update segment
      const [updatedSegment] = await this.db
        .update(schema.DocumentSegment)
        .set({
          content,
          tokenCount,
          indexStatus: IndexStatusEnum.PENDING, // Mark for re-indexing
          updatedAt: new Date(),
        })
        .where(eq(schema.DocumentSegment.id, segmentId))
        .returning()

      logger.info('Segment content updated', {
        segmentId,
        organizationId,
        oldLength: segment.content.length,
        newLength: content.length,
      })

      // Queue for re-indexing (would integrate with your existing queue system)
      // await this.queueForReindexing(segmentId, segment.document.datasetId)

      return updatedSegment
    } catch (error) {
      if (error instanceof DocumentProcessingError) {
        throw error
      }
      throw new DocumentProcessingError('Failed to update segment content', {
        error,
        segmentId,
      })
    }
  }

  /**
   * Toggle segment enabled status
   */
  async toggleEnabled(segmentId: string, enabled: boolean, organizationId: string) {
    try {
      // Verify segment exists and belongs to organization
      const segment = await this.getById(segmentId, organizationId)
      if (!segment) {
        throw new DocumentProcessingError('Segment not found', { segmentId })
      }

      // Update enabled status
      const [updatedSegment] = await this.db
        .update(schema.DocumentSegment)
        .set({
          enabled,
          updatedAt: new Date(),
        })
        .where(eq(schema.DocumentSegment.id, segmentId))
        .returning()

      logger.info('Segment enabled status toggled', {
        segmentId,
        organizationId,
        enabled,
      })

      return updatedSegment
    } catch (error) {
      if (error instanceof DocumentProcessingError) {
        throw error
      }
      throw new DocumentProcessingError('Failed to toggle segment enabled status', {
        error,
        segmentId,
      })
    }
  }

  /**
   * Delete a segment and reorder remaining segments
   */
  async delete(segmentId: string, organizationId: string) {
    try {
      // Get segment to delete
      const segment = await this.getById(segmentId, organizationId)
      if (!segment) {
        throw new DocumentProcessingError('Segment not found', { segmentId })
      }

      // Use transaction to delete and reorder
      await this.db.transaction(async (tx) => {
        // Delete the segment
        await tx.delete(schema.DocumentSegment).where(eq(schema.DocumentSegment.id, segmentId))

        // Reorder remaining segments
        await tx
          .update(schema.DocumentSegment)
          .set({
            position: sql`${schema.DocumentSegment.position} - 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.DocumentSegment.documentId, segment.documentId),
              gt(schema.DocumentSegment.position, segment.position)
            )
          )
      })

      logger.info('Segment deleted and positions reordered', {
        segmentId,
        documentId: segment.documentId,
        deletedPosition: segment.position,
      })
    } catch (error) {
      if (error instanceof DocumentProcessingError) {
        throw error
      }
      throw new DocumentProcessingError('Failed to delete segment', {
        error,
        segmentId,
      })
    }
  }

  /**
   * Perform batch operations on segments
   */
  async batchOperation(
    segmentIds: string[],
    operation: 'enable' | 'disable' | 'delete' | 'reindex',
    organizationId: string
  ) {
    const results = {
      success: [] as string[],
      failed: [] as { id: string; error: string }[],
    }

    for (const segmentId of segmentIds) {
      try {
        switch (operation) {
          case 'enable':
            await this.toggleEnabled(segmentId, true, organizationId)
            break
          case 'disable':
            await this.toggleEnabled(segmentId, false, organizationId)
            break
          case 'delete':
            await this.delete(segmentId, organizationId)
            break
          case 'reindex':
            await this.reindex(segmentId, organizationId)
            break
        }
        results.success.push(segmentId)
      } catch (error) {
        results.failed.push({
          id: segmentId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        logger.error('Batch operation failed for segment', {
          segmentId,
          operation,
          error,
        })
      }
    }

    logger.info('Batch operation completed', {
      operation,
      total: segmentIds.length,
      success: results.success.length,
      failed: results.failed.length,
    })

    return results
  }

  /**
   * List segments for a document with search and advanced filtering
   */
  async listByDocument(
    documentId: string,
    organizationId: string,
    filters?: SegmentFilters,
    pagination?: PaginationParams
  ): Promise<SegmentListResponse> {
    try {
      const {
        page = 1,
        limit = 50,
        sortBy = 'position',
        sortOrder = 'asc',
        cursor,
      } = pagination || {}

      const offset = cursor ? cursor : (page - 1) * limit

      // Build base where conditions
      const whereConditions: SQL[] = [
        eq(schema.DocumentSegment.documentId, documentId),
        eq(schema.DocumentSegment.organizationId, organizationId),
      ]

      // Add optional filters
      if (filters?.enabled !== undefined) {
        whereConditions.push(eq(schema.DocumentSegment.enabled, filters.enabled))
      }
      if (filters?.indexStatus) {
        whereConditions.push(eq(schema.DocumentSegment.indexStatus, filters.indexStatus))
      }
      if (filters?.minPosition !== undefined) {
        whereConditions.push(gte(schema.DocumentSegment.position, filters.minPosition))
      }
      if (filters?.maxPosition !== undefined) {
        whereConditions.push(lte(schema.DocumentSegment.position, filters.maxPosition))
      }

      // Add search condition if provided
      if (filters?.search) {
        const searchConditions: SQL[] = [
          ilike(schema.DocumentSegment.content, `%${filters.search}%`),
        ]

        // If search query is a number, also search by position
        const positionNumber = parseInt(filters.search, 10)
        if (!Number.isNaN(positionNumber)) {
          searchConditions.push(eq(schema.DocumentSegment.position, positionNumber))
        }

        whereConditions.push(or(...searchConditions)!)
      }

      // Build orderBy
      const orderByClause =
        sortOrder === 'desc'
          ? desc(schema.DocumentSegment[sortBy as keyof typeof schema.DocumentSegment])
          : asc(schema.DocumentSegment[sortBy as keyof typeof schema.DocumentSegment])

      const [segments, totalCountResult] = await Promise.all([
        this.db
          .select({
            id: schema.DocumentSegment.id,
            documentId: schema.DocumentSegment.documentId,
            position: schema.DocumentSegment.position,
            content: schema.DocumentSegment.content,
            tokenCount: schema.DocumentSegment.tokenCount,
            enabled: schema.DocumentSegment.enabled,
            indexStatus: schema.DocumentSegment.indexStatus,
            metadata: schema.DocumentSegment.metadata,
            createdAt: schema.DocumentSegment.createdAt,
            updatedAt: schema.DocumentSegment.updatedAt,
            organizationId: schema.DocumentSegment.organizationId,
          })
          .from(schema.DocumentSegment)
          .where(and(...whereConditions))
          .orderBy(orderByClause)
          .offset(offset)
          .limit(limit),
        this.db
          .select({ count: count() })
          .from(schema.DocumentSegment)
          .where(and(...whereConditions)),
      ])

      const totalCount = totalCountResult[0]?.count || 0
      const hasMore = totalCount > offset + segments.length
      const nextCursor = hasMore ? offset + segments.length : undefined

      return {
        segments,
        totalCount,
        hasMore,
        page,
        nextCursor,
      }
    } catch (error) {
      throw new DocumentProcessingError('Failed to list segments', {
        error,
        documentId,
      })
    }
  }

  /**
   * Mark segment for re-indexing
   */
  async reindex(segmentId: string, organizationId: string) {
    try {
      // Verify segment exists and belongs to organization
      const segment = await this.getById(segmentId, organizationId)
      if (!segment) {
        throw new DocumentProcessingError('Segment not found', { segmentId })
      }

      // Update index status to pending
      await this.db
        .update(schema.DocumentSegment)
        .set({
          indexStatus: IndexStatusEnum.PENDING,
          updatedAt: new Date(),
        })
        .where(eq(schema.DocumentSegment.id, segmentId))

      logger.info('Segment marked for re-indexing', {
        segmentId,
        organizationId,
      })

      // Here you would queue the segment for re-indexing
      // This would integrate with your existing document processing queue
      // await DocumentProcessingQueue.queueSegmentReindexing(segmentId, segment.document.datasetId)
    } catch (error) {
      if (error instanceof DocumentProcessingError) {
        throw error
      }
      throw new DocumentProcessingError('Failed to reindex segment', {
        error,
        segmentId,
      })
    }
  }

  /**
   * Update segment metadata
   */
  async updateMetadata(segmentId: string, metadata: any, organizationId: string) {
    try {
      // Verify segment exists and belongs to organization
      const segment = await this.getById(segmentId, organizationId)
      if (!segment) {
        throw new DocumentProcessingError('Segment not found', { segmentId })
      }

      // Merge with existing metadata
      const updatedMetadata = {
        ...((segment.metadata as any) || {}),
        ...metadata,
      }

      // Update segment
      const [updatedSegment] = await this.db
        .update(schema.DocumentSegment)
        .set({
          metadata: updatedMetadata,
          updatedAt: new Date(),
        })
        .where(eq(schema.DocumentSegment.id, segmentId))
        .returning()

      logger.info('Segment metadata updated', {
        segmentId,
        organizationId,
      })

      return updatedSegment
    } catch (error) {
      if (error instanceof DocumentProcessingError) {
        throw error
      }
      throw new DocumentProcessingError('Failed to update segment metadata', {
        error,
        segmentId,
      })
    }
  }

  /**
   * Calculate token count for text
   * This is a simple approximation - you may want to use a proper tokenizer
   */
  private calculateTokenCount(text: string): number {
    // Rough approximation: ~4 characters per token on average
    return Math.ceil(text.length / 4)
  }
}
