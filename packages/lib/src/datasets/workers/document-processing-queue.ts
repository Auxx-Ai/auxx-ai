// packages/lib/src/datasets/workers/document-processing-queue.ts

import { createScopedLogger } from '@auxx/logger'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import type {
  BatchOperationJobData,
  DocumentProcessingJobData,
  EmbeddingGenerationJobData,
} from '../types/worker.types'

const logger = createScopedLogger('document-processing-queue')

/**
 * Document processing queue service
 *
 * Manages job queuing and status tracking for document processing pipeline
 */
export class DocumentProcessingQueue {
  private static _documentProcessingQueue: ReturnType<typeof getQueue> | null = null
  private static _embeddingQueue: ReturnType<typeof getQueue> | null = null

  private static get documentProcessingQueue() {
    if (!DocumentProcessingQueue._documentProcessingQueue) {
      DocumentProcessingQueue._documentProcessingQueue = getQueue(Queues.documentProcessingQueue)
    }
    return DocumentProcessingQueue._documentProcessingQueue
  }

  private static get embeddingQueue() {
    if (!DocumentProcessingQueue._embeddingQueue) {
      DocumentProcessingQueue._embeddingQueue = getQueue(Queues.embeddingQueue)
    }
    return DocumentProcessingQueue._embeddingQueue
  }

  /**
   * Queue document for processing
   */
  static async queueDocumentProcessing(
    documentId: string,
    datasetId: string,
    organizationId: string,
    userId?: string,
    options?: {
      priority?: number
      delay?: number
      mediaAssetId?: string
      fileName?: string
      fileSize?: number
      mimeType?: string
      documentType?: string
      processingOptions?: DocumentProcessingJobData['extractorConfig']
      chunkingOptions?: DocumentProcessingJobData['chunkingConfig']
    }
  ) {
    try {
      const jobData: DocumentProcessingJobData = {
        organizationId,
        datasetId,
        documentId,
        userId,
        mediaAssetId: options?.mediaAssetId || '',
        fileName: options?.fileName || '',
        fileSize: options?.fileSize || 0,
        mimeType: options?.mimeType || 'application/octet-stream',
        documentType: (options?.documentType as any) || 'UNKNOWN',
        extractorConfig: options?.processingOptions,
        chunkingConfig: options?.chunkingOptions,
        metadata: { queuedAt: new Date().toISOString(), priority: options?.priority || 0 },
      }

      const job = await DocumentProcessingQueue.documentProcessingQueue.add(
        'process-document',
        jobData,
        {
          priority: options?.priority || 0,
          delay: options?.delay || 0,
          jobId: `process-doc-${documentId}-${Date.now()}`,
          removeOnComplete: 50,
          removeOnFail: 100,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }
      )

      logger.info('Document processing job queued', {
        documentId,
        datasetId,
        organizationId,
        jobId: job.id,
        priority: options?.priority || 0,
      })

      return job
    } catch (error) {
      logger.error('Failed to queue document processing job', {
        error: error instanceof Error ? error.message : error,
        documentId,
        datasetId,
        organizationId,
      })
      throw error
    }
  }

  /**
   * Queue embedding generation for multiple segments
   */
  static async queueEmbeddingGeneration(
    segments: Array<{
      segmentId: string
      content: string
      documentId: string
      datasetId: string
      organizationId: string
    }>,
    options?: {
      modelProvider?: string
      modelName?: string
      priority?: number
      batchSize?: number
      userId?: string
    }
  ) {
    if (segments.length === 0) return []

    try {
      const batchSize = options?.batchSize || 20
      const jobs = []

      // Process in batches to avoid overwhelming the embedding service
      for (let i = 0; i < segments.length; i += batchSize) {
        const batch = segments.slice(i, i + batchSize)

        const jobData: EmbeddingGenerationJobData = {
          organizationId: batch[0].organizationId,
          datasetId: batch[0].datasetId,
          userId: options?.userId,
          segmentIds: batch.map((s) => s.segmentId),
          batchSize,
          embeddingConfig: {
            model: options?.modelName || 'text-embedding-ada-002',
            provider: (options?.modelProvider as any) || 'openai',
            normalize: true,
          },
          retryConfig: { maxRetries: 3, retryDelay: 2000, exponentialBackoff: true },
          metadata: {
            contentLength: batch.reduce((sum, s) => sum + s.content.length, 0),
            queuedAt: new Date().toISOString(),
          },
        }

        const job = await DocumentProcessingQueue.embeddingQueue.add(
          'generate-batch-embeddings',
          jobData,
          {
            priority: options?.priority || 0,
            jobId: `embed-batch-${batch[0].datasetId}-${i}-${Date.now()}`,
            removeOnComplete: 100,
            removeOnFail: 50,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          }
        )

        jobs.push(job)
      }

      logger.info('Embedding generation jobs queued', {
        segmentCount: segments.length,
        batchCount: jobs.length,
        datasetId: segments[0].datasetId,
        organizationId: segments[0].organizationId,
      })

      return jobs
    } catch (error) {
      logger.error('Failed to queue embedding generation jobs', {
        error: error instanceof Error ? error.message : error,
        segmentCount: segments.length,
      })
      throw error
    }
  }

  /**
   * Queue batch operation (reprocessing, deletion, etc.)
   */
  static async queueBatchOperation(
    operation: 'delete' | 'reindex' | 'update' | 'export',
    targetIds: string[],
    targetType: 'documents' | 'segments' | 'dataset',
    datasetId: string,
    organizationId: string,
    operationConfig?: Record<string, any>
  ) {
    try {
      const jobData: BatchOperationJobData = {
        organizationId,
        datasetId,
        operation,
        targetIds,
        targetType,
        operationConfig,
        progressTracking: {
          totalItems: targetIds.length,
          processedItems: 0,
          failedItems: 0,
          startedAt: new Date(),
        },
      }

      const job = await DocumentProcessingQueue.documentProcessingQueue.add(
        'batch-operation',
        jobData,
        {
          priority: 0, // Lower priority for batch operations
          jobId: `batch-${operation}-${datasetId}-${Date.now()}`,
          removeOnComplete: 20,
          removeOnFail: 50,
          attempts: 2,
          backoff: { type: 'exponential', delay: 10000 },
        }
      )

      logger.info('Batch operation job queued', {
        operation,
        targetType,
        targetCount: targetIds.length,
        datasetId,
        organizationId,
        jobId: job.id,
      })

      return job
    } catch (error) {
      logger.error('Failed to queue batch operation job', {
        error: error instanceof Error ? error.message : error,
        operation,
        targetType,
        targetCount: targetIds.length,
        datasetId,
      })
      throw error
    }
  }

  /**
   * Get processing status for dataset
   */
  static async getProcessingStatus(datasetId: string) {
    try {
      const [processingJobs, embeddingJobs] = await Promise.all([
        DocumentProcessingQueue.documentProcessingQueue.getJobs([
          'waiting',
          'active',
          'completed',
          'failed',
        ]),
        DocumentProcessingQueue.embeddingQueue.getJobs([
          'waiting',
          'active',
          'completed',
          'failed',
        ]),
      ])

      const datasetProcessingJobs = processingJobs.filter(
        (job) => job.data?.datasetId === datasetId
      )

      const datasetEmbeddingJobs = embeddingJobs.filter((job) => job.data?.datasetId === datasetId)

      const allJobs = [...datasetProcessingJobs, ...datasetEmbeddingJobs]

      return {
        waiting: allJobs.filter((job) => !job.processedOn && !job.finishedOn).length,
        active: allJobs.filter((job) => job.processedOn && !job.finishedOn).length,
        completed: allJobs.filter((job) => job.finishedOn && !job.failedReason).length,
        failed: allJobs.filter((job) => job.failedReason).length,
        total: allJobs.length,
        details: {
          processing: {
            waiting: datasetProcessingJobs.filter((job) => !job.processedOn && !job.finishedOn)
              .length,
            active: datasetProcessingJobs.filter((job) => job.processedOn && !job.finishedOn)
              .length,
            completed: datasetProcessingJobs.filter((job) => job.finishedOn && !job.failedReason)
              .length,
            failed: datasetProcessingJobs.filter((job) => job.failedReason).length,
          },
          embedding: {
            waiting: datasetEmbeddingJobs.filter((job) => !job.processedOn && !job.finishedOn)
              .length,
            active: datasetEmbeddingJobs.filter((job) => job.processedOn && !job.finishedOn).length,
            completed: datasetEmbeddingJobs.filter((job) => job.finishedOn && !job.failedReason)
              .length,
            failed: datasetEmbeddingJobs.filter((job) => job.failedReason).length,
          },
        },
      }
    } catch (error) {
      logger.error('Failed to get processing status', {
        error: error instanceof Error ? error.message : error,
        datasetId,
      })
      throw error
    }
  }

  /**
   * Cancel all jobs for a dataset
   */
  static async cancelDatasetJobs(datasetId: string) {
    try {
      const [processingJobs, embeddingJobs] = await Promise.all([
        DocumentProcessingQueue.documentProcessingQueue.getJobs(['waiting', 'active']),
        DocumentProcessingQueue.embeddingQueue.getJobs(['waiting', 'active']),
      ])

      const jobsToCancel = [
        ...processingJobs.filter((job) => job.data?.datasetId === datasetId),
        ...embeddingJobs.filter((job) => job.data?.datasetId === datasetId),
      ]

      const cancelPromises = jobsToCancel.map((job) =>
        job
          .remove()
          .catch((error: any) => logger.warn('Failed to cancel job', { jobId: job.id, error }))
      )

      await Promise.all(cancelPromises)

      logger.info('Dataset jobs cancelled', { datasetId, cancelledCount: jobsToCancel.length })

      return { success: true, cancelledCount: jobsToCancel.length }
    } catch (error) {
      logger.error('Failed to cancel dataset jobs', {
        error: error instanceof Error ? error.message : error,
        datasetId,
      })
      throw error
    }
  }

  /**
   * Retry failed jobs for a dataset
   */
  static async retryFailedJobs(datasetId: string) {
    try {
      const [processingJobs, embeddingJobs] = await Promise.all([
        DocumentProcessingQueue.documentProcessingQueue.getJobs(['failed']),
        DocumentProcessingQueue.embeddingQueue.getJobs(['failed']),
      ])

      const failedJobs = [
        ...processingJobs.filter((job) => job.data?.datasetId === datasetId),
        ...embeddingJobs.filter((job) => job.data?.datasetId === datasetId),
      ]

      const retryPromises = failedJobs.map((job) =>
        job
          .retry()
          .catch((error: any) => logger.warn('Failed to retry job', { jobId: job.id, error }))
      )

      await Promise.all(retryPromises)

      logger.info('Failed dataset jobs retried', { datasetId, retriedCount: failedJobs.length })

      return { success: true, retriedCount: failedJobs.length }
    } catch (error) {
      logger.error('Failed to retry dataset jobs', {
        error: error instanceof Error ? error.message : error,
        datasetId,
      })
      throw error
    }
  }
}
