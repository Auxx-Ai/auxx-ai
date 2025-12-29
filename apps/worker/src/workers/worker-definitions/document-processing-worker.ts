// apps/worker/src/workers/worker-definitions/document-processing-worker.ts

import * as jobs from '@auxx/lib/jobs/definitions'
import { createWorker } from '../utils/createWorker'
import { Queues } from '@auxx/lib/jobs/queues/types'
import { DocumentFlowJobs } from '@auxx/lib/jobs/flows'

const jobMappings = {
  'process-document': jobs.processDocumentJob,
  'batch-operation': jobs.batchOperationJob,
  // Flow jobs
  [DocumentFlowJobs.FINALIZE_DOCUMENT]: jobs.finalizeDocumentJob,
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
