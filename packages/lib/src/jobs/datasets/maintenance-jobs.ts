// packages/lib/src/jobs/datasets/maintenance-jobs.ts

import { database as db, schema } from '@auxx/database'
import { DocumentProcessingQueue } from '@auxx/lib/datasets'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, count, eq, inArray, isNull, or } from 'drizzle-orm'

const logger = createScopedLogger('dataset-maintenance-jobs')

interface DatasetCleanupJobData {
  datasetId: string
  organizationId: string
  cleanupType: 'SOFT_DELETE' | 'HARD_DELETE' | 'ARCHIVE'
  options?: {
    deleteFiles?: boolean
    deleteEmbeddings?: boolean
    preserveMetadata?: boolean
  }
}

interface DatasetReindexJobData {
  datasetId: string
  organizationId: string
  options: {
    rebuildEmbeddings?: boolean
    rebuildSearch?: boolean
    batchSize?: number
  }
}

interface OrphanedDataCleanupJobData {
  organizationId: string
}

/**
 * Clean up dataset resources
 */
export const cleanupDatasetJob = async (job: Job<DatasetCleanupJobData>) => {
  const { datasetId, organizationId, cleanupType, options = {} } = job.data

  logger.info('Starting dataset cleanup job', {
    datasetId,
    organizationId,
    cleanupType,
    jobId: job.id,
  })

  try {
    await job.updateProgress(10)

    // Get dataset information
    const [dataset] = await db
      .select()
      .from(schema.Dataset)
      .where(
        and(eq(schema.Dataset.id, datasetId), eq(schema.Dataset.organizationId, organizationId))
      )
      .limit(1)

    // Get document count for the dataset
    const [documentCountResult] = await db
      .select({ count: count() })
      .from(schema.Document)
      .where(eq(schema.Document.datasetId, datasetId))

    const datasetWithCount = dataset
      ? {
          ...dataset,
          _count: { documents: documentCountResult?.count || 0 },
        }
      : null

    if (!datasetWithCount) {
      throw new Error(`Dataset ${datasetId} not found`)
    }

    let documentsDeleted = 0

    // Clean up documents and segments
    await job.updateProgress(30)
    if (cleanupType === 'HARD_DELETE') {
      const deleteResult = await db
        .delete(schema.Document)
        .where(eq(schema.Document.datasetId, datasetId))
        .returning({ id: schema.Document.id })
      documentsDeleted = deleteResult.length
    } else {
      // Soft delete - update status
      const updateResult = await db
        .update(schema.Document)
        .set({
          status: 'ARCHIVED',
          updatedAt: new Date(),
        })
        .where(eq(schema.Document.datasetId, datasetId))
        .returning({ id: schema.Document.id })
      documentsDeleted = updateResult.length
    }

    // Clean up embeddings if requested
    if (options.deleteEmbeddings !== false) {
      await job.updateProgress(50)
      const documentIds = await db
        .select({ id: schema.Document.id })
        .from(schema.Document)
        .where(eq(schema.Document.datasetId, datasetId))

      if (documentIds.length > 0) {
        await db
          .update(schema.DocumentSegment)
          .set({
            embedding: null,
            updatedAt: new Date(),
          })
          .where(
            inArray(
              schema.DocumentSegment.documentId,
              documentIds.map((d) => d.id)
            )
          )
      }
    }

    // Update dataset status
    await job.updateProgress(90)
    if (cleanupType === 'HARD_DELETE') {
      await db.delete(schema.Dataset).where(eq(schema.Dataset.id, datasetId))
    } else {
      await db
        .update(schema.Dataset)
        .set({
          status: cleanupType === 'ARCHIVE' ? 'INACTIVE' : 'ACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(schema.Dataset.id, datasetId))
    }

    await job.updateProgress(100)

    logger.info('Dataset cleanup job completed', {
      datasetId,
      documentsDeleted,
      cleanupType,
      jobId: job.id,
    })

    return {
      success: true,
      datasetId,
      documentsDeleted,
      cleanupType,
    }
  } catch (error) {
    logger.error('Dataset cleanup job failed', {
      error: error instanceof Error ? error.message : error,
      datasetId,
      organizationId,
      jobId: job.id,
    })

    throw error
  }
}

/**
 * Reindex dataset for improved search performance
 */
export const reindexDatasetJob = async (job: Job<DatasetReindexJobData>) => {
  const { datasetId, organizationId, options } = job.data

  logger.info('Starting dataset reindex job', {
    datasetId,
    organizationId,
    options,
    jobId: job.id,
  })

  try {
    const batchSize = options.batchSize || 100
    let processedCount = 0

    await job.updateProgress(5)

    // Get document count
    const [documentCountResult] = await db
      .select({ count: count() })
      .from(schema.Document)
      .innerJoin(schema.Dataset, eq(schema.Document.datasetId, schema.Dataset.id))
      .where(
        and(
          eq(schema.Document.datasetId, datasetId),
          eq(schema.Dataset.organizationId, organizationId)
        )
      )
    const totalDocuments = documentCountResult?.count || 0

    if (totalDocuments === 0) {
      return { success: true, message: 'No documents to reindex' }
    }

    // Process documents in batches
    for (let skip = 0; skip < totalDocuments; skip += batchSize) {
      const documents = await db
        .select({
          id: schema.Document.id,
          title: schema.Document.title,
          filename: schema.Document.filename,
          datasetId: schema.Document.datasetId,
          status: schema.Document.status,
          organizationId: schema.Document.organizationId,
        })
        .from(schema.Document)
        .innerJoin(schema.Dataset, eq(schema.Document.datasetId, schema.Dataset.id))
        .where(
          and(
            eq(schema.Document.datasetId, datasetId),
            eq(schema.Dataset.organizationId, organizationId)
          )
        )
        .offset(skip)
        .limit(batchSize)

      // Queue reprocessing if requested
      if (options.rebuildEmbeddings || options.rebuildSearch) {
        for (const document of documents) {
          await DocumentProcessingQueue.queueDocumentProcessing(
            document.id,
            datasetId,
            organizationId,
            undefined // System maintenance job has no user
          )
        }
      }

      processedCount += documents.length
      const progress = Math.min((processedCount / totalDocuments) * 90 + 5, 95)
      await job.updateProgress(progress)

      logger.info('Reindex batch completed', {
        datasetId,
        batchSkip: skip,
        batchSize: documents.length,
        progress: `${processedCount}/${totalDocuments}`,
      })
    }

    await job.updateProgress(100)

    logger.info('Dataset reindex job completed', {
      datasetId,
      totalDocuments: processedCount,
      jobId: job.id,
    })

    return {
      success: true,
      datasetId,
      documentsProcessed: processedCount,
      options,
    }
  } catch (error) {
    logger.error('Dataset reindex job failed', {
      error: error instanceof Error ? error.message : error,
      datasetId,
      organizationId,
      jobId: job.id,
    })

    throw error
  }
}

/**
 * Clean up orphaned data across organization
 */
export const cleanupOrphanedDataJob = async (job: Job<OrphanedDataCleanupJobData>) => {
  const { organizationId } = job.data

  logger.info('Starting orphaned data cleanup job', {
    organizationId,
    jobId: job.id,
  })

  try {
    await job.updateProgress(10)

    // Find segments without documents
    const orphanedSegments = await db
      .select({
        id: schema.DocumentSegment.id,
        documentId: schema.DocumentSegment.documentId,
        organizationId: schema.DocumentSegment.organizationId,
        document: {
          id: schema.Document.id,
          status: schema.Document.status,
          datasetId: schema.Document.datasetId,
        },
      })
      .from(schema.DocumentSegment)
      .innerJoin(schema.Document, eq(schema.DocumentSegment.documentId, schema.Document.id))
      .innerJoin(schema.Dataset, eq(schema.Document.datasetId, schema.Dataset.id))
      .where(eq(schema.Dataset.organizationId, organizationId))

    const segmentsToDelete = orphanedSegments.filter(
      (segment) => !segment.document || segment.document.status === 'ARCHIVED'
    )

    await job.updateProgress(40)

    // Delete orphaned segments
    if (segmentsToDelete.length > 0) {
      await db.delete(schema.DocumentSegment).where(
        inArray(
          schema.DocumentSegment.id,
          segmentsToDelete.map((s) => s.id)
        )
      )
    }

    await job.updateProgress(70)

    // Find documents without datasets (shouldn't happen, but just in case)
    const orphanedDocuments = await db
      .select({
        id: schema.Document.id,
        status: schema.Document.status,
        datasetId: schema.Document.datasetId,
        organizationId: schema.Document.organizationId,
      })
      .from(schema.Document)
      .innerJoin(schema.Dataset, eq(schema.Document.datasetId, schema.Dataset.id))
      .where(
        and(
          eq(schema.Dataset.organizationId, organizationId),
          or(eq(schema.Document.status, 'ARCHIVED'), isNull(schema.Document.datasetId))
        )
      )

    await job.updateProgress(90)

    const cleanupStats = {
      segmentsDeleted: segmentsToDelete.length,
      documentsFound: orphanedDocuments.length,
    }

    await job.updateProgress(100)

    logger.info('Orphaned data cleanup job completed', {
      organizationId,
      stats: cleanupStats,
      jobId: job.id,
    })

    return {
      success: true,
      organizationId,
      cleanupStats,
    }
  } catch (error) {
    logger.error('Orphaned data cleanup job failed', {
      error: error instanceof Error ? error.message : error,
      organizationId,
      jobId: job.id,
    })

    throw error
  }
}
