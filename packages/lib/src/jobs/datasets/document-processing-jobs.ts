// packages/lib/src/jobs/datasets/document-processing-jobs.ts
/**
 * Document Processing Job Handlers
 *
 * BullMQ job handlers for the document processing pipeline. These handlers are
 * registered with workers and process jobs from the document and embedding queues.
 *
 * Job Handlers:
 * - processDocumentJob: Main document processing (extraction, chunking, flow creation)
 * - generateEmbeddingJob: Legacy embedding generation for non-flow jobs
 * - generateEmbeddingsFlowJob: Flow-based embedding generation (child job)
 * - finalizeDocumentJob: Document finalization after embeddings complete (parent job)
 * - batchOperationJob: Batch operations (delete, reindex) on documents/segments
 *
 * Used by:
 * - apps/worker/src/workers/worker-definitions/document-processing-worker.ts
 *   - processDocumentJob (queue: 'process-document')
 *   - batchOperationJob (queue: 'batch-operation')
 *   - finalizeDocumentJob (flow job: DocumentFlowJobs.FINALIZE_DOCUMENT)
 *
 * - apps/worker/src/workers/worker-definitions/dataset-embedding-worker.ts
 *   - generateEmbeddingJob (queue: 'generate-batch-embeddings')
 *   - batchOperationJob (queue: 'batch-operation')
 *   - generateEmbeddingsFlowJob (flow job: DocumentFlowJobs.GENERATE_EMBEDDINGS)
 */

import { database as db } from '@auxx/database'
import { DocumentStatus } from '@auxx/database/enums'
import { DocumentModel, DocumentSegmentModel } from '@auxx/database/models'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { RedisDocumentExecutionReporter } from '../../datasets/events/document-execution-reporter'
import { DocumentEventType } from '../../datasets/events/types'
import { DocumentService } from '../../datasets/services/document-service'
import type {
  BatchOperationJobData,
  DocumentProcessingJobData,
  EmbeddingGenerationJobData,
} from '../../datasets/types'
import { DocumentProcessingQueue } from '../../datasets/workers/document-processing-queue'
import { DocumentProcessor } from '../../datasets/workers/document-processor'
import { EmbeddingProcessor } from '../../datasets/workers/embedding-processor'
import type { FinalizeDocumentJobData, FlowEmbeddingGenerationJobData } from '../flows'
import { getQueue, Queues } from '../queues'
import type { JobContext } from '../types'

const logger = createScopedLogger('dataset-document-jobs')

/**
 * Process document through complete pipeline using BullMQ Flow.
 *
 * Pipeline steps:
 * 1. Extract content from file (PDF, DOCX, TXT, etc.)
 * 2. Preprocess/clean content
 * 3. Chunk content into segments
 * 4. Create embedding flow (child jobs for each batch)
 *
 * The document is only marked as INDEXED after all embeddings complete successfully
 * via the finalizeDocumentJob handler.
 *
 * @param ctx - Job context or legacy Job object
 * @returns WorkerJobResult with success status and segment count
 *
 * Used by: document-processing-worker.ts (queue: 'process-document')
 */
export const processDocumentJob = async (
  ctx: JobContext<DocumentProcessingJobData> | Job<DocumentProcessingJobData>
) => {
  // Handle both legacy Job and new JobContext patterns
  const isJobContext = 'data' in ctx && 'throwIfCancelled' in ctx
  const job = isJobContext
    ? (ctx as JobContext<DocumentProcessingJobData>).job
    : (ctx as Job<DocumentProcessingJobData>)
  const data = job.data
  const signal = isJobContext ? (ctx as JobContext<DocumentProcessingJobData>).signal : undefined

  const { documentId, datasetId, organizationId } = data

  logger.info('Starting document processing job (flow-based)', {
    documentId,
    datasetId,
    organizationId,
    jobId: job.id,
  })

  try {
    // Create reporter for SSE events
    const reporter = new RedisDocumentExecutionReporter(documentId, datasetId)

    // Use flow-based processing: extracts content, chunks, then creates embedding flow
    // Document status will be updated by the finalize job after all embeddings complete
    const result = await DocumentProcessor.processDocumentWithFlow(data, reporter, signal)

    logger.info('Document processing job completed (flow created)', {
      documentId,
      success: result.success,
      flowCreated: result.data?.flowCreated,
      segmentCount: result.data?.segmentCount,
      jobId: job.id,
    })

    return result
  } catch (error) {
    logger.error('Document processing job failed', {
      error: error instanceof Error ? error.message : error,
      documentId,
      datasetId,
      organizationId,
      jobId: job.id,
    })

    // Update document status to failed
    const docModel = new DocumentModel(organizationId)
    await docModel.update(documentId, { status: 'FAILED' as any })

    throw error
  }
}

/**
 * Generate embeddings for document segments (legacy handler).
 *
 * This is the non-flow embedding job handler, used for standalone embedding
 * generation outside of the document processing flow.
 *
 * @param ctx - Job context or legacy Job object
 * @returns WorkerJobResult with success status
 *
 * Used by: dataset-embedding-worker.ts (queue: 'generate-batch-embeddings')
 */
export const generateEmbeddingJob = async (
  ctx: JobContext<EmbeddingGenerationJobData> | Job<EmbeddingGenerationJobData>
) => {
  // Handle both legacy Job and new JobContext patterns
  const isJobContext = 'data' in ctx && 'throwIfCancelled' in ctx
  const job = isJobContext
    ? (ctx as JobContext<EmbeddingGenerationJobData>).job
    : (ctx as Job<EmbeddingGenerationJobData>)
  const data = job.data

  const { segmentIds, organizationId, datasetId } = data

  logger.info('Starting embedding generation job', {
    segmentCount: segmentIds.length,
    datasetId,
    organizationId,
    jobId: job.id,
  })

  try {
    const result = await EmbeddingProcessor.processBatchEmbeddings(data)

    logger.info('Embedding generation job completed', {
      segmentCount: segmentIds.length,
      success: result.success,
      jobId: job.id,
    })

    return result
  } catch (error) {
    logger.error('Embedding generation job failed', {
      error: error instanceof Error ? error.message : error,
      segmentCount: segmentIds.length,
      datasetId,
      organizationId,
      jobId: job.id,
    })

    throw error
  }
}

/**
 * Generate embeddings for a batch of segments (flow child job).
 *
 * This handler is used as a child job in the document processing flow.
 * Multiple instances run in parallel, each processing a batch of segments.
 * Results are aggregated by the parent finalizeDocumentJob.
 *
 * @param ctx - Job context with flow-specific data
 * @returns Batch result with success status and segments processed count
 *
 * Used by: dataset-embedding-worker.ts (flow job: DocumentFlowJobs.GENERATE_EMBEDDINGS)
 */
export const generateEmbeddingsFlowJob = async (
  ctx: JobContext<FlowEmbeddingGenerationJobData>
) => {
  const { data, throwIfCancelled, updateProgress, jobId } = ctx
  const {
    documentId,
    datasetId,
    segmentIds,
    batchIndex = 0,
    totalBatches = 1,
    totalSegments = segmentIds.length,
    batchSize = 20,
  } = data

  logger.info('Starting flow embedding generation', {
    jobId,
    documentId,
    batchIndex,
    totalBatches,
    segmentCount: segmentIds.length,
  })

  // Create reporter for SSE events if we have documentId
  const reporter = documentId ? new RedisDocumentExecutionReporter(documentId, datasetId) : null

  try {
    throwIfCancelled()

    // Emit progress event
    if (reporter) {
      const overallProgress = Math.round(((batchIndex + 0.5) / totalBatches) * 100)
      await reporter.emit(DocumentEventType.EMBEDDING_PROGRESS, {
        currentBatch: batchIndex + 1,
        totalBatches,
        currentSegment: batchIndex * batchSize + 1,
        totalSegments,
        progress: overallProgress,
      })
    }

    // Process embeddings
    const result = await EmbeddingProcessor.processBatchEmbeddings(data)

    throwIfCancelled()

    // Update progress
    const batchProgress = Math.round(((batchIndex + 1) / totalBatches) * 100)
    await updateProgress(batchProgress)

    // Emit completion progress
    if (reporter) {
      await reporter.emit(DocumentEventType.EMBEDDING_PROGRESS, {
        currentBatch: batchIndex + 1,
        totalBatches,
        currentSegment: Math.min((batchIndex + 1) * batchSize, totalSegments),
        totalSegments,
        progress: batchProgress,
      })
    }

    logger.info('Flow embedding batch completed', {
      jobId,
      documentId,
      batchIndex,
      segmentsProcessed: segmentIds.length,
    })

    // Return data for parent to aggregate
    return {
      success: result.success,
      batchIndex,
      segmentsProcessed: segmentIds.length,
      ...result.data,
    }
  } catch (error) {
    logger.error('Flow embedding generation failed', {
      jobId,
      documentId,
      batchIndex,
      error: error instanceof Error ? error.message : error,
    })
    throw error
  }
}

/**
 * Finalize document after all embeddings complete (flow parent job).
 *
 * This job runs AFTER all child embedding jobs (generateEmbeddingsFlowJob) finish.
 * It aggregates results from all children, updates the document status to INDEXED,
 * and sets the final totalChunks, processingTime, and processedAt fields.
 *
 * @param ctx - Job context with access to child job results via getChildrenValues()
 * @returns Finalization result with total segments processed and processing time
 *
 * Used by: document-processing-worker.ts (flow job: DocumentFlowJobs.FINALIZE_DOCUMENT)
 */
export const finalizeDocumentJob = async (ctx: JobContext<FinalizeDocumentJobData>) => {
  const { data, getChildrenValues } = ctx
  const { documentId, datasetId, organizationId, totalSegments, startedAt, workflowResume } = data

  logger.info('Finalizing document processing', {
    documentId,
    datasetId,
    hasWorkflowResume: !!workflowResume,
  })

  // Create reporter for final SSE events
  const reporter = new RedisDocumentExecutionReporter(documentId, datasetId)
  const documentService = new DocumentService(db)

  try {
    // Get results from all child embedding jobs
    const childResults = await getChildrenValues()

    // Aggregate results
    const totalProcessed = Object.values(childResults).reduce(
      (sum: number, result: any) => sum + (result?.segmentsProcessed || 0),
      0
    )

    const allSuccessful = Object.values(childResults).every(
      (result: any) => result?.success === true
    )

    const processingTime = Date.now() - startedAt

    if (!allSuccessful) {
      // Some batches failed
      const failedBatches = Object.entries(childResults)
        .filter(([, result]: [string, any]) => !result?.success)
        .map(([key]) => key)

      logger.error('Some embedding batches failed', {
        documentId,
        failedBatches,
      })

      // Mark document as failed
      await documentService.update(documentId, organizationId, {
        status: DocumentStatus.FAILED,
        metadata: {
          failedAt: new Date().toISOString(),
          error: `Embedding failed for batches: ${failedBatches.join(', ')}`,
          processingTime,
        },
      })

      await reporter.emit(DocumentEventType.PROCESSING_FAILED, {
        error: 'Some embedding batches failed',
        failedBatches,
        processingTimeMs: processingTime,
      })

      // Resume workflow with error if waiting
      if (workflowResume) {
        logger.warn('Document processing failed, resuming workflow with error', {
          documentId,
          workflowRunId: workflowResume.workflowRunId,
          failedBatches,
        })

        const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)

        await workflowDelayQueue.add(
          'resumeWorkflowJob',
          {
            workflowRunId: workflowResume.workflowRunId,
            resumeFromNodeId: workflowResume.resumeFromNodeId,
            nodeOutput: {
              embeddingStatus: 'failed',
              documentId,
              error: `Embedding failed for batches: ${failedBatches.join(', ')}`,
              failedBatches,
              processingTimeMs: processingTime,
              ...workflowResume.originalNodeOutput,
            },
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
        )
      }

      return { success: false, failedBatches }
    }

    // All successful - emit completion events
    await reporter.emit(DocumentEventType.EMBEDDING_COMPLETED, {
      totalSegments,
      processingTimeMs: processingTime,
    })

    // Mark document as indexed
    await documentService.update(documentId, organizationId, {
      status: DocumentStatus.INDEXED,
      totalChunks: totalProcessed,
      processingTime,
      processedAt: new Date(),
      metadata: {
        processingCompletedAt: new Date().toISOString(),
        segmentCount: totalProcessed,
        processingTime,
      },
    })

    await reporter.emit(DocumentEventType.PROCESSING_COMPLETED, {
      segmentCount: totalProcessed,
      totalProcessingTimeMs: processingTime,
    })

    logger.info('Document processing finalized', {
      documentId,
      totalSegments: totalProcessed,
      processingTime,
    })

    // Resume workflow if this was a paused workflow waiting for embeddings
    if (workflowResume) {
      logger.info('Document processing complete, resuming workflow', {
        documentId,
        workflowRunId: workflowResume.workflowRunId,
        resumeFromNodeId: workflowResume.resumeFromNodeId,
      })

      const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)

      await workflowDelayQueue.add(
        'resumeWorkflowJob',
        {
          workflowRunId: workflowResume.workflowRunId,
          resumeFromNodeId: workflowResume.resumeFromNodeId,
          // Include embedding completion data as node output
          nodeOutput: {
            embeddingStatus: 'completed',
            documentId,
            segmentsEmbedded: totalProcessed,
            processingTimeMs: processingTime,
            completedAt: new Date().toISOString(),
            // Merge with original output if provided
            ...workflowResume.originalNodeOutput,
          },
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        }
      )

      logger.info('Workflow resume job scheduled', {
        workflowRunId: workflowResume.workflowRunId,
        documentId,
      })
    }

    return {
      success: true,
      segmentsProcessed: totalProcessed,
      processingTimeMs: processingTime,
    }
  } catch (error) {
    logger.error('Document finalization failed', {
      documentId,
      error: error instanceof Error ? error.message : error,
    })

    await reporter.emit(DocumentEventType.PROCESSING_FAILED, {
      error: error instanceof Error ? error.message : 'Finalization failed',
    })

    throw error
  }
}

/**
 * Batch operation on documents/segments.
 *
 * Handles bulk operations on multiple documents or segments:
 * - delete: Remove documents or segments from the database
 * - reindex: Queue documents for reprocessing
 *
 * @param ctx - Job context or legacy Job object
 * @returns Result with operation type and count of processed items
 *
 * Used by:
 * - document-processing-worker.ts (queue: 'batch-operation')
 * - dataset-embedding-worker.ts (queue: 'batch-operation')
 */
export const batchOperationJob = async (
  ctx: JobContext<BatchOperationJobData> | Job<BatchOperationJobData>
) => {
  // Handle both legacy Job and new JobContext patterns
  const isJobContext = 'data' in ctx && 'throwIfCancelled' in ctx
  const job = isJobContext
    ? (ctx as JobContext<BatchOperationJobData>).job
    : (ctx as Job<BatchOperationJobData>)
  const data = job.data

  const { operation, targetIds, targetType, datasetId, organizationId } = data

  logger.info('Starting batch operation job', {
    operation,
    targetCount: targetIds.length,
    targetType,
    datasetId,
    organizationId,
    jobId: job.id,
  })

  try {
    let result

    switch (operation) {
      case 'delete':
        if (targetType === 'documents') {
          {
            const docModel = new DocumentModel(organizationId)
            await docModel.deleteMany(targetIds)
            result = { success: true }
          }
        } else if (targetType === 'segments') {
          {
            const segModel = new DocumentSegmentModel(organizationId)
            await segModel.deleteMany(targetIds)
            result = { success: true }
          }
        }
        break

      case 'reindex':
        // Queue reprocessing for documents
        for (const targetId of targetIds) {
          await DocumentProcessingQueue.queueDocumentProcessing(
            targetId,
            datasetId,
            organizationId,
            data.userId
          )
        }
        result = { processed: targetIds.length }
        break

      default:
        throw new Error(`Unsupported batch operation: ${operation}`)
    }

    logger.info('Batch operation job completed', {
      operation,
      targetCount: targetIds.length,
      result,
      jobId: job.id,
    })

    return {
      success: true,
      operation,
      targetCount: targetIds.length,
      result,
    }
  } catch (error) {
    logger.error('Batch operation job failed', {
      error: error instanceof Error ? error.message : error,
      operation,
      targetCount: targetIds.length,
      jobId: job.id,
    })

    throw error
  }
}
