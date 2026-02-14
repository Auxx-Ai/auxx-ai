// packages/lib/src/datasets/workers/embedding-processor.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { EmbeddingService } from '../services/embedding-service'
import { VectorService } from '../services/vector.service'
import type { EmbeddingGenerationJobData, WorkerJobResult } from '../types/worker.types'

const logger = createScopedLogger('embedding-processor')

/**
 * Embedding processor service
 *
 * Handles batch embedding generation for document segments and
 * integration with vector database storage
 */
export class EmbeddingProcessor {
  private static embeddingInstances = new Map<string, EmbeddingService>()

  /**
   * Get or create embedding service instance for organization
   */
  private static getEmbeddingService(organizationId: string, userId?: string): EmbeddingService {
    const key = `${organizationId}:${userId || 'system'}`
    if (!EmbeddingProcessor.embeddingInstances.has(key)) {
      EmbeddingProcessor.embeddingInstances.set(
        key,
        new EmbeddingService(db, organizationId, userId)
      )
    }
    return EmbeddingProcessor.embeddingInstances.get(key)!
  }

  /**
   * Generate embeddings for multiple segments in batch
   */
  static async processBatchEmbeddings(
    jobData: EmbeddingGenerationJobData
  ): Promise<WorkerJobResult> {
    const { segmentIds, organizationId, datasetId, embeddingConfig, userId } = jobData
    const startTime = Date.now()

    logger.info('Starting batch embedding generation', {
      segmentCount: segmentIds.length,
      organizationId,
      datasetId,
      modelId: embeddingConfig?.modelId,
    })

    try {
      // Get segment data from database
      const segments = await db
        .select({
          id: schema.DocumentSegment.id,
          content: schema.DocumentSegment.content,
          position: schema.DocumentSegment.position,
          documentId: schema.DocumentSegment.documentId,
          createdAt: schema.DocumentSegment.createdAt,
          metadata: schema.DocumentSegment.metadata,
          document: {
            datasetId: schema.Document.datasetId,
            title: schema.Document.title,
          },
        })
        .from(schema.DocumentSegment)
        .leftJoin(schema.Document, eq(schema.DocumentSegment.documentId, schema.Document.id))
        .where(
          and(
            inArray(schema.DocumentSegment.id, segmentIds),
            eq(schema.DocumentSegment.enabled, true),
            eq(schema.DocumentSegment.indexStatus, 'PENDING')
          )
        )

      if (segments.length === 0) {
        logger.warn('No segments found for embedding generation', {
          requestedIds: segmentIds.length,
          organizationId,
        })

        return {
          success: true,
          data: {
            message: 'No segments found for processing',
            segmentsProcessed: 0,
          },
        }
      }

      // Filter segments that belong to the specified dataset
      const validSegments = segments.filter((segment) => segment.document.datasetId === datasetId)

      if (validSegments.length !== segments.length) {
        logger.warn('Some segments do not belong to specified dataset', {
          requestedCount: segments.length,
          validCount: validSegments.length,
          datasetId,
        })
      }

      // Update segments to processing status
      await db
        .update(schema.DocumentSegment)
        .set({
          indexStatus: 'PENDING',
          updatedAt: new Date(),
        })
        .where(
          inArray(
            schema.DocumentSegment.id,
            validSegments.map((s) => s.id)
          )
        )

      // Prepare content for embedding generation
      const contentToEmbed = validSegments.map((segment) => segment.content)

      logger.debug('Generating embeddings', {
        segmentCount: validSegments.length,
        modelId: embeddingConfig?.modelId,
      })

      // Generate embeddings using the embedding service
      const embeddingService = EmbeddingProcessor.getEmbeddingService(organizationId, userId)
      const embeddings = await embeddingService.generateBatch(contentToEmbed, {
        modelId: embeddingConfig?.modelId,
        batchSize: 20,
      })

      if (embeddings.length !== validSegments.length) {
        throw new Error(
          `Embedding count mismatch: expected ${validSegments.length}, got ${embeddings.length}`
        )
      }

      // Store embeddings in vector database
      const vectorDocuments = validSegments.map((segment, index) => ({
        id: segment.id,
        content: segment.content,
        embedding: embeddings[index],
        metadata: {
          documentId: segment.documentId,
          documentName: segment.document.title,
          position: segment.position,
          datasetId: segment.document.datasetId,
          createdAt: segment.createdAt.toISOString(),
          ...((segment.metadata as Record<string, any>) || {}),
        },
      }))

      logger.debug('Storing embeddings in vector database', {
        segmentCount: vectorDocuments.length,
        datasetId,
      })

      await VectorService.addDocumentsToVector(
        datasetId,
        vectorDocuments.map((doc) => ({
          id: doc.id,
          content: doc.content,
          metadata: doc.metadata,
        })),
        organizationId,
        userId
      )

      // Update segment status to indexed
      await db
        .update(schema.DocumentSegment)
        .set({
          indexStatus: 'INDEXED',
          updatedAt: new Date(),
        })
        .where(
          inArray(
            schema.DocumentSegment.id,
            validSegments.map((s) => s.id)
          )
        )

      const processingTime = Date.now() - startTime

      logger.info('Batch embedding generation completed', {
        segmentsProcessed: validSegments.length,
        datasetId,
        organizationId,
        processingTime,
        averageEmbeddingDimensions: embeddings[0]?.length || 0,
      })

      return {
        success: true,
        data: {
          segmentsProcessed: validSegments.length,
          datasetId,
          embeddingDimensions: embeddings[0]?.length || 0,
          modelId: embeddingConfig?.modelId,
        },
        metrics: {
          duration: processingTime,
          itemsProcessed: validSegments.length,
          memoryUsage: process.memoryUsage().heapUsed,
        },
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown embedding generation error'
      const processingTime = Date.now() - startTime

      logger.error('Batch embedding generation failed', {
        error: errorMessage,
        segmentIds: segmentIds.length,
        datasetId,
        organizationId,
        processingTime,
      })

      // Update segments to error status
      await db
        .update(schema.DocumentSegment)
        .set({
          indexStatus: 'ERROR',
          updatedAt: new Date(),
        })
        .where(inArray(schema.DocumentSegment.id, segmentIds))
        .catch((updateError) => {
          logger.error('Failed to update segment error status', {
            segmentIds: segmentIds.length,
            updateError: updateError instanceof Error ? updateError.message : updateError,
          })
        })

      return {
        success: false,
        error: {
          message: errorMessage,
          code: 'EMBEDDING_GENERATION_FAILED',
          details: {
            segmentIds: segmentIds.length,
            datasetId,
            processingTime,
          },
        },
        metrics: {
          duration: processingTime,
          itemsProcessed: 0,
        },
      }
    }
  }

  /**
   * Generate single embedding (for individual segment processing)
   */
  static async processSingleEmbedding(
    segmentId: string,
    organizationId: string,
    embeddingConfig?: EmbeddingGenerationJobData['embeddingConfig'],
    userId?: string
  ): Promise<WorkerJobResult> {
    const startTime = Date.now()

    try {
      // Get segment data
      const [segment] = await db
        .select({
          id: schema.DocumentSegment.id,
          content: schema.DocumentSegment.content,
          position: schema.DocumentSegment.position,
          documentId: schema.DocumentSegment.documentId,
          indexStatus: schema.DocumentSegment.indexStatus,
          metadata: schema.DocumentSegment.metadata,
          document: {
            datasetId: schema.Document.datasetId,
            title: schema.Document.title,
          },
        })
        .from(schema.DocumentSegment)
        .leftJoin(schema.Document, eq(schema.DocumentSegment.documentId, schema.Document.id))
        .where(eq(schema.DocumentSegment.id, segmentId))
        .limit(1)

      if (!segment) {
        throw new Error(`Segment ${segmentId} not found`)
      }

      if (segment.indexStatus === 'INDEXED') {
        logger.info('Segment already has embedding, skipping', { segmentId })
        return {
          success: true,
          data: { message: 'Segment already indexed', segmentId },
        }
      }

      // Generate single embedding
      const embeddingService = EmbeddingProcessor.getEmbeddingService(organizationId, userId)
      const embedding = await embeddingService.generateSingle(segment.content, {
        modelId: embeddingConfig?.modelId,
      })

      // Store in vector database
      await VectorService.addDocumentsToVector(
        segment.document.datasetId,
        [
          {
            id: segment.id,
            content: segment.content,
            metadata: {
              documentId: segment.documentId,
              documentName: segment.document.title,
              position: segment.position,
              datasetId: segment.document.datasetId,
              ...((segment.metadata as Record<string, any>) || {}),
            },
          },
        ],
        organizationId,
        userId
      )

      // Update segment status
      await db
        .update(schema.DocumentSegment)
        .set({
          indexStatus: 'INDEXED',
          updatedAt: new Date(),
        })
        .where(eq(schema.DocumentSegment.id, segmentId))

      const processingTime = Date.now() - startTime

      logger.info('Single embedding generation completed', {
        segmentId,
        datasetId: segment.document.datasetId,
        processingTime,
        embeddingDimensions: embedding.length,
      })

      return {
        success: true,
        data: {
          segmentId,
          datasetId: segment.document.datasetId,
          embeddingDimensions: embedding.length,
        },
        metrics: {
          duration: processingTime,
          itemsProcessed: 1,
        },
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Single embedding generation failed'
      const processingTime = Date.now() - startTime

      logger.error('Single embedding generation failed', {
        error: errorMessage,
        segmentId,
        organizationId,
        processingTime,
      })

      // Update segment status to error
      await db
        .update(schema.DocumentSegment)
        .set({
          indexStatus: 'ERROR',
          updatedAt: new Date(),
        })
        .where(eq(schema.DocumentSegment.id, segmentId))
        .catch((updateError) => {
          logger.error('Failed to update segment error status', {
            segmentId,
            updateError: updateError instanceof Error ? updateError.message : updateError,
          })
        })

      return {
        success: false,
        error: {
          message: errorMessage,
          code: 'SINGLE_EMBEDDING_FAILED',
          details: { segmentId, processingTime },
        },
        metrics: {
          duration: processingTime,
          itemsProcessed: 0,
        },
      }
    }
  }

  /**
   * Reindex embeddings for segments (regenerate embeddings)
   */
  static async reindexSegmentEmbeddings(
    segmentIds: string[],
    organizationId: string,
    datasetId: string,
    options?: {
      model?: string
      provider?: string
      forceReindex?: boolean
    }
  ): Promise<WorkerJobResult> {
    const startTime = Date.now()

    try {
      logger.info('Starting embedding reindexing', {
        segmentCount: segmentIds.length,
        datasetId,
        organizationId,
        forceReindex: options?.forceReindex,
      })

      // Get segments, optionally filtering by index status
      const whereClause: any = {
        id: { in: segmentIds },
        enabled: true,
        document: { datasetId },
      }

      if (!options?.forceReindex) {
        // Only reindex segments that don't have embeddings or are in error state
        whereClause.OR = [{ indexStatus: 'PENDING' }, { indexStatus: 'ERROR' }]
      }

      const segments = await db
        .select({
          id: schema.DocumentSegment.id,
          content: schema.DocumentSegment.content,
          position: schema.DocumentSegment.position,
          documentId: schema.DocumentSegment.documentId,
          createdAt: schema.DocumentSegment.createdAt,
          metadata: schema.DocumentSegment.metadata,
          document: {
            datasetId: schema.Document.datasetId,
            title: schema.Document.title,
          },
        })
        .from(schema.DocumentSegment)
        .leftJoin(schema.Document, eq(schema.DocumentSegment.documentId, schema.Document.id))
        .where(
          and(
            inArray(schema.DocumentSegment.id, segmentIds),
            eq(schema.DocumentSegment.enabled, true),
            eq(schema.Document.datasetId, datasetId),
            options?.forceReindex
              ? undefined // Include all segments if forcing reindex
              : or(
                  eq(schema.DocumentSegment.indexStatus, 'PENDING'),
                  eq(schema.DocumentSegment.indexStatus, 'ERROR')
                )
          )
        )

      if (segments.length === 0) {
        return {
          success: true,
          data: {
            message: 'No segments found for reindexing',
            segmentsProcessed: 0,
          },
        }
      }

      // Remove existing vector data for these segments
      if (options?.forceReindex) {
        await VectorService.removeDocumentsFromVector(
          datasetId,
          segments.map((s) => s.id),
          organizationId
        )
      }

      // Process in the same way as batch embedding
      const jobData: EmbeddingGenerationJobData = {
        organizationId,
        datasetId,
        segmentIds: segments.map((s) => s.id),
        embeddingConfig: {
          modelId: options?.model ? `${options.provider || 'openai'}:${options.model}` : undefined,
        },
      }

      return await EmbeddingProcessor.processBatchEmbeddings(jobData)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Reindexing failed'
      const processingTime = Date.now() - startTime

      logger.error('Embedding reindexing failed', {
        error: errorMessage,
        segmentCount: segmentIds.length,
        datasetId,
        processingTime,
      })

      return {
        success: false,
        error: {
          message: errorMessage,
          code: 'REINDEXING_FAILED',
          details: {
            segmentCount: segmentIds.length,
            datasetId,
            processingTime,
          },
        },
        metrics: {
          duration: processingTime,
          itemsProcessed: 0,
        },
      }
    }
  }

  /**
   * Get embedding processing statistics for a dataset
   */
  static async getEmbeddingStats(datasetId: string, organizationId: string) {
    try {
      // Get segment counts by status
      const [totalCount] = await db
        .select({
          count: sql<number>`count(*)`,
        })
        .from(schema.DocumentSegment)
        .leftJoin(schema.Document, eq(schema.DocumentSegment.documentId, schema.Document.id))
        .leftJoin(schema.Dataset, eq(schema.Document.datasetId, schema.Dataset.id))
        .where(
          and(
            eq(schema.Document.datasetId, datasetId),
            eq(schema.Dataset.organizationId, organizationId),
            eq(schema.DocumentSegment.enabled, true)
          )
        )

      const statusCounts = await db
        .select({
          indexStatus: schema.DocumentSegment.indexStatus,
          count: sql<number>`count(*)`,
        })
        .from(schema.DocumentSegment)
        .leftJoin(schema.Document, eq(schema.DocumentSegment.documentId, schema.Document.id))
        .leftJoin(schema.Dataset, eq(schema.Document.datasetId, schema.Dataset.id))
        .where(
          and(
            eq(schema.Document.datasetId, datasetId),
            eq(schema.Dataset.organizationId, organizationId),
            eq(schema.DocumentSegment.enabled, true)
          )
        )
        .groupBy(schema.DocumentSegment.indexStatus)

      const statusMap = statusCounts.reduce(
        (acc, item) => {
          acc[item.indexStatus] = item.count
          return acc
        },
        {} as Record<string, number>
      )

      return {
        total: totalCount.count,
        indexed: statusMap.INDEXED || 0,
        pending: statusMap.PENDING || 0,
        error: statusMap.ERROR || 0,
        datasetId,
        lastUpdated: new Date(),
      }
    } catch (error) {
      logger.error('Failed to get embedding stats', {
        error: error instanceof Error ? error.message : error,
        datasetId,
        organizationId,
      })
      throw error
    }
  }
}
