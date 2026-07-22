// apps/worker/src/workers/worker-definitions/quickbooks-invoice-sync-worker.ts

import { syncQuickbooksInvoiceJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  syncQuickbooksInvoice: syncQuickbooksInvoiceJob,
}

/**
 * QuickBooks invoice sync worker (plans/dispatch/37e-quickbooks-invoice-sync.md §3, P3).
 * Concurrency capped at 2 — each job drives a chain of outbound QBO API calls
 * (customer/item upsert + invoice create/update), so it doesn't need thumbnail-worker levels
 * of parallelism.
 */
export function startQuickbooksInvoiceSyncWorker() {
  return createWorker(Queues.quickbooksInvoiceSyncQueue, jobMappings, {
    concurrency: 2,
  })
}
