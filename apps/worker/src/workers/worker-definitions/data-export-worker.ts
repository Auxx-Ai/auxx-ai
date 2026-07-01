// apps/worker/src/workers/worker-definitions/data-export-worker.ts

import { exportRecordsJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

/** Job mappings for the data export worker. */
const jobMappings = {
  exportRecordsJob,
}

/**
 * Start the data export worker.
 * Handles background CSV export of entity records.
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
 */
