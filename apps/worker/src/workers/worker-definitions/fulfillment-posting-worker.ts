// apps/worker/src/workers/worker-definitions/fulfillment-posting-worker.ts

import { FULFILLMENT_POSTING_JOB_NAME, fulfillmentPostingJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  [FULFILLMENT_POSTING_JOB_NAME]: fulfillmentPostingJob,
}

/**
 * Bulk fulfillment posting worker (plans/money/tasks/49-bulk-fulfillment-posting.md §2.4).
 *
 * 🛑 Concurrency 1, and not as a throttle. One job posts every unposted shipment
 * in an organization as one entry per ship day, and the period key of a day is
 * claimed by attempt number. Two runs side by side would read the same backlog,
 * compute the same attempt, and claim the same key - so the concurrency cap is
 * part of the correctness of the key, not a resource decision. The `auto` lane's
 * per-org `jobId` collapses repeat syncs into the one job still queued; this
 * caps what happens once they start.
 */
export function startFulfillmentPostingWorker() {
  return createWorker(Queues.fulfillmentPostingQueue, jobMappings, {
    concurrency: 1,
  })
}
