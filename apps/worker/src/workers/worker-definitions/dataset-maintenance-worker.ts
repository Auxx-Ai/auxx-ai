// apps/worker/src/workers/worker-definitions/dataset-maintenance-worker.ts

import * as jobs from '@auxx/lib/jobs/definitions'
import { Queues } from '@auxx/lib/jobs/queues/types'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  'cleanup-dataset': jobs.cleanupDatasetJob,
  'reindex-dataset': jobs.reindexDatasetJob,
  'cleanup-orphaned-data': jobs.cleanupOrphanedDataJob,
}

export function startDatasetMaintenanceWorker() {
  return createWorker(Queues.datasetMaintenanceQueue, jobMappings, {
    concurrency: 2, // Limited concurrency for maintenance tasks
    stalledInterval: 60 * 1000, // 1 minute
    maxStalledCount: 1,
  })
}
