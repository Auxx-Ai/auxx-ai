// apps/worker/src/workers/worker-definitions/document-processing-worker.ts

import {
  batchOperationJob,
  DocumentFlowJobs,
  finalizeDocumentJob,
  processDocumentJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  'process-document': processDocumentJob,
  'batch-operation': batchOperationJob,
  // Flow jobs
  [DocumentFlowJobs.FINALIZE_DOCUMENT]: finalizeDocumentJob,
}

/**
 * Start the document processing worker
 * Handles document extraction, chunking, and flow finalization
 */
export function startDocumentProcessingWorker() {
  return createWorker(Queues.documentProcessingQueue, jobMappings, {
    concurrency: 5, // Process 5 documents concurrently
    stalledInterval: 30 * 1000, // 30 seconds
    maxStalledCount: 1,
    enableCancellation: true,
  })
}
