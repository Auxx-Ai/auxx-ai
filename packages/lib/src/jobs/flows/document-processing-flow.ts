// packages/lib/src/jobs/flows/document-processing-flow.ts

import { addFlow, type FlowJobDefinition } from '../queues/flow-producer'
import { Queues } from '../queues/types'
import { createScopedLogger } from '@auxx/logger'
import type { EmbeddingGenerationJobData } from '../../datasets/types'

const logger = createScopedLogger('document-flow')

/**
 * Job names for the document processing flow
 */
export const DocumentFlowJobs = {
  // Parent job that waits for all embeddings
  PROCESS_DOCUMENT: 'process-document-flow',

  // Child job for each embedding batch
  GENERATE_EMBEDDINGS: 'generate-embeddings-batch',

  // Finalization job (runs after all embeddings complete)
  FINALIZE_DOCUMENT: 'finalize-document',
} as const

/**
 * Optional workflow resume information for paused workflows
 * Used when waitForEmbeddings is enabled on the Dataset workflow node
 */
export interface WorkflowResumeInfo {
  /** The workflow run ID to resume */
  workflowRunId: string

  /** The node ID to resume from (the Dataset node) */
  resumeFromNodeId: string

  /** Document ID for verification */
  documentId: string

  /** Original node output to merge with completion data */
  originalNodeOutput?: Record<string, any>
}

/**
 * Data for the finalization job
 */
export interface FinalizeDocumentJobData {
  documentId: string
  datasetId: string
  organizationId: string
  totalSegments: number
  startedAt: number

  /** Optional: Resume workflow after embeddings complete */
  workflowResume?: WorkflowResumeInfo
}

/**
 * Extended embedding job data with flow-specific fields
 */
export interface FlowEmbeddingGenerationJobData extends EmbeddingGenerationJobData {
  /** Document ID (for flow-based progress tracking) */
  documentId?: string

  /** Batch index in the flow (0-based) */
  batchIndex?: number

  /** Total number of batches in the flow */
  totalBatches?: number

  /** Total segments across all batches */
  totalSegments?: number
}

/**
 * Create a document processing flow with embedding children
 *
 * Flow structure:
 * - finalize-document (parent, waits for children)
 *   └── generate-embeddings-batch (children, parallel)
 *       ├── batch 1 (segments 0-19)
 *       ├── batch 2 (segments 20-39)
 *       └── batch N (remaining segments)
 *
 * The finalize job won't run until ALL embedding batches complete.
 */
export async function createDocumentProcessingFlow(params: {
  documentId: string
  datasetId: string
  organizationId: string
  userId?: string
  segments: Array<{
    segmentId: string
    content: string
  }>
  batchSize?: number

  /** Optional: Workflow resume info for paused workflows waiting for embeddings */
  workflowResume?: WorkflowResumeInfo
}) {
  const {
    documentId,
    datasetId,
    organizationId,
    userId,
    segments,
    batchSize = 20,
    workflowResume,
  } = params

  if (segments.length === 0) {
    logger.warn('No segments to process, skipping flow creation', { documentId })
    return null
  }

  // Create embedding batch children
  const embeddingChildren: FlowJobDefinition<FlowEmbeddingGenerationJobData>[] = []

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize)
    const batchIndex = Math.floor(i / batchSize)

    embeddingChildren.push({
      name: DocumentFlowJobs.GENERATE_EMBEDDINGS,
      queue: Queues.embeddingQueue,
      data: {
        organizationId,
        datasetId,
        userId,
        documentId, // Include for progress tracking
        segmentIds: batch.map((s) => s.segmentId),
        batchIndex, // For progress calculation
        totalBatches: Math.ceil(segments.length / batchSize),
        totalSegments: segments.length,
        batchSize,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 2000,
          exponentialBackoff: true,
        },
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    })
  }

  // Create the parent finalization job
  const flow: FlowJobDefinition<FinalizeDocumentJobData> = {
    name: DocumentFlowJobs.FINALIZE_DOCUMENT,
    queue: Queues.documentProcessingQueue,
    data: {
      documentId,
      datasetId,
      organizationId,
      totalSegments: segments.length,
      startedAt: Date.now(),
      workflowResume, // Pass workflow resume info to finalize job
    },
    opts: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
    children: embeddingChildren,
  }

  logger.info('Creating document processing flow', {
    documentId,
    datasetId,
    totalSegments: segments.length,
    batchCount: embeddingChildren.length,
  })

  const result = await addFlow(flow)

  logger.info('Document processing flow created', {
    documentId,
    parentJobId: result.job.id,
    childJobIds: result.children?.map((c) => c.job.id),
  })

  return result
}
