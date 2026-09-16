// apps/worker/src/workers/worker-definitions/accounting-delivery-worker.ts

import { ACCOUNTING_DELIVERY_JOB_NAME, accountingDeliveryJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  [ACCOUNTING_DELIVERY_JOB_NAME]: accountingDeliveryJob,
}

/**
 * External accounting delivery worker: one accepted journal pushed to the
 * organization's pinned books per job.
 *
 * 🛑 Deliberately NOT concurrency 1, unlike the two bulk posting workers beside
 * it. Their cap is a correctness cap - they race for a period key. Deliveries
 * do not: each one targets a single journal, `delivery.ts` reads the remote back
 * before it creates, and `AccountingDeliveryOperation` carries a lease so two
 * attempts at the same posting cannot both send.
 *
 * Kept at 3 anyway, because the far side is one company's rate-limited API and a
 * 28-group backlog arriving at once should not be what discovers that limit.
 */
export function startAccountingDeliveryWorker() {
  return createWorker(Queues.accountingDeliveryQueue, jobMappings, {
    concurrency: 3,
  })
}
