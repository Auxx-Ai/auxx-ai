// apps/worker/src/workers/worker-definitions/dataset-maintenance-worker.ts

import { cleanupDatasetJob, cleanupOrphanedDataJob, reindexDatasetJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  'cleanup-dataset': cleanupDatasetJob,
  'reindex-dataset': reindexDatasetJob,
  'cleanup-orphaned-data': cleanupOrphanedDataJob,
}

export function startDatasetMaintenanceWorker() {
  return createWorker(Queues.datasetMaintenanceQueue, jobMappings, {
    concurrency: 2, // Limited concurrency for maintenance tasks
    stalledInterval: 60 * 1000, // 1 minute
    maxStalledCount: 1,
  })
}
