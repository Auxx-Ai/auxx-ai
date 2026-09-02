// apps/worker/src/workers/worker-definitions/purchase-intake-worker.ts

import { purchaseIntakeJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:purchase-intake')

/**
 * ⚠️ The key is the name `enqueuePurchaseIntake` adds under
 * (`PURCHASE_INTAKE_JOB_NAME`). Nothing in the type system connects the two: a
 * mismatch compiles and fails at runtime with `Job function not found`.
 */
const purchaseIntakeJobMappings = {
  purchaseIntakeJob,
}

/**
 * Starts the BullMQ worker for the quote-intake queue
 * (plans/money/tasks/38-purchase-order-from-a-document.md §3.3).
 *
 * Low concurrency: one job is a single multimodal LLM read of a whole document,
 * 10 to 40 seconds, and the person who uploaded is watching a dialog. Three at
 * a time keeps a burst of uploads moving without letting them crowd the org's
 * model quota.
 */
export function startPurchaseIntakeWorker() {
  logger.info(`Starting worker for queue: ${Queues.purchaseIntakeQueue}`)

  return createWorker(Queues.purchaseIntakeQueue, purchaseIntakeJobMappings, {
    concurrency: 3,
  })
}
