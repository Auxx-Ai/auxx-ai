// apps/worker/src/workers/worker-definitions/export-batch-worker.ts

import {
  EXPORT_BATCH_JOB_NAME,
  EXPORT_BATCHES_JOB_NAME,
  exportBatchesJob,
  exportBatchJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

/**
 * Export batch worker: one batch sent to the organization's pinned books per job.
 * Single Send and single Retry land here; a release rides the plural worker below.
 *
 * 🛑 Deliberately NOT concurrency 1, unlike the two bulk posting workers beside
 * it. Their cap is a correctness cap - they race for a period key. Batches do
 * not: each one targets a single provider object, `sendExportBatch` reads the
 * object back before it records anything, and `ExportBatch` carries a lease so
 * two attempts at the same batch cannot both send.
 *
 * Kept at 3 anyway, because the far side is one company's rate-limited API and a
 * released backlog arriving at once should not be what discovers that limit.
 */
export function startExportBatchWorker() {
  return createWorker(
    Queues.exportBatchQueue,
    { [EXPORT_BATCH_JOB_NAME]: exportBatchJob },
    {
      concurrency: 3,
    }
  )
}

/**
 * Export batches worker: one released set per job, sent in one or two batch calls
 * (plan 93 D4). Concurrency 1 because one job already carries a set; it is global,
 * not per org - plain BullMQ has no groups, and the leases keep two orgs' sets apart anyway.
 */
export function startExportBatchesWorker() {
  return createWorker(
    Queues.exportBatchesQueue,
    { [EXPORT_BATCHES_JOB_NAME]: exportBatchesJob },
    {
      concurrency: 1,
    }
  )
}
