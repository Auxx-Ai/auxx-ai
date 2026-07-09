// apps/worker/src/workers/worker-definitions/learned-extraction-worker.ts

import { learnedExtractionJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:learned-extraction')

const learnedExtractionJobMappings = {
  learnedExtractionJob,
}

/**
 * Starts a BullMQ worker for the learned-KB extraction queue. Processes
 * per-thread extraction jobs enqueued by `ThreadMutationService` when a
 * thread transitions to ARCHIVED. Low concurrency — each job is one LLM run.
 */
export function startLearnedExtractionWorker() {
  logger.info(`Starting worker for queue: ${Queues.learnedExtractionQueue}`)

  return createWorker(Queues.learnedExtractionQueue, learnedExtractionJobMappings, {
    concurrency: 3,
  })
}
