// apps/worker/src/workers/worker-definitions/data-export-worker.ts

import { exportRecordsJob, printRecordsJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

/** Job mappings for the data export worker. */
const jobMappings = {
  exportRecordsJob,
  printRecordsJob,
}

/**
 * Start the data export worker.
 * Handles background CSV export and PDF print runs of entity records (same `ExportJob`
 * table, dispatched by job name — plans/printing/01-unified-print.md §D).
 */
export function startDataExportWorker() {
  return createWorker(Queues.dataExportQueue, jobMappings, {
    concurrency: 2,
  })
}

/**
 * How to add jobs to the queue:
 *
 * dataExportQueue.add('exportRecordsJob', {
 *   exportJobId: 'export-job-id',
 *   organizationId: 'org-id',
 * })
 *
 * dataExportQueue.add('printRecordsJob', {
 *   exportJobId: 'print-job-id',
 *   organizationId: 'org-id',
 * })
 */
