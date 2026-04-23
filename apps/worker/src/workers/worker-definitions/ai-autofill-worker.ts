// apps/worker/src/workers/worker-definitions/ai-autofill-worker.ts

import { aiAutofillJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:ai-autofill')

const aiAutofillJobMappings = {
  aiAutofillJob,
}

/**
 * Starts a BullMQ worker for the AI autofill queue. Processes per-field
 * generation jobs enqueued by `shortCircuitAiGenerate`.
 */
export function startAiAutofillWorker() {
  logger.info(`Starting worker for queue: ${Queues.aiAutofillQueue}`)

  return createWorker(Queues.aiAutofillQueue, aiAutofillJobMappings, {
    concurrency: 5,
  })
}
