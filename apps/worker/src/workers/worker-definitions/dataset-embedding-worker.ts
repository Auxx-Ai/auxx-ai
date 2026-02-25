// apps/worker/src/workers/worker-definitions/dataset-embedding-worker.ts

import {
  batchOperationJob,
  DocumentFlowJobs,
  generateEmbeddingJob,
  generateEmbeddingsFlowJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  'generate-batch-embeddings': generateEmbeddingJob,
  'batch-operation': batchOperationJob,
  // Flow jobs
  [DocumentFlowJobs.GENERATE_EMBEDDINGS]: generateEmbeddingsFlowJob,
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
