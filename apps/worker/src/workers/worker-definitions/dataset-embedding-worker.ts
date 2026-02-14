// apps/worker/src/workers/worker-definitions/dataset-embedding-worker.ts

import * as jobs from '@auxx/lib/jobs/definitions'
import { DocumentFlowJobs } from '@auxx/lib/jobs/flows'
import { Queues } from '@auxx/lib/jobs/queues/types'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  'generate-batch-embeddings': jobs.generateEmbeddingJob,
  'batch-operation': jobs.batchOperationJob,
  // Flow jobs
  [DocumentFlowJobs.GENERATE_EMBEDDINGS]: jobs.generateEmbeddingsFlowJob,
}

/**
 * Start the dataset embedding worker
 * Handles embedding generation for document segments
 */
export function startDatasetEmbeddingWorker() {
  return createWorker(Queues.embeddingQueue, jobMappings, {
    concurrency: 3, // Moderate concurrency for embedding generation
    stalledInterval: 120 * 1000, // 2 minutes - embeddings can take time
    maxStalledCount: 1,
    enableCancellation: true,
  })
}
