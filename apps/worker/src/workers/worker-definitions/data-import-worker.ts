// apps/worker/src/workers/worker-definitions/data-import-worker.ts

import { Queues } from '@auxx/lib/queues/types'
import { generatePlanJob, executePlanJob, resolveValuesJob } from '@auxx/lib/jobs'
import { createWorker } from '../utils/createWorker'

/** Job mappings for data import worker */
const jobMappings = {
  generatePlanJob,
  executePlanJob,
  resolveValuesJob,
}

/**
 * Start the data import worker.
 * Handles plan generation and execution jobs.
 */
export function startDataImportWorker() {
  return createWorker(Queues.dataImportQueue, jobMappings, {
    concurrency: 2, // Allow some parallelism
  })
}

/**
 * How to add jobs to the queue:
 *
 * // Generate a plan for an import job
 * dataImportQueue.add('generatePlanJob', {
 *   jobId: 'import-job-id',
 *   organizationId: 'org-id',
 * })
 *
 * // Execute a plan
 * dataImportQueue.add('executePlanJob', {
 *   jobId: 'import-job-id',
 *   planId: 'plan-id',
 *   organizationId: 'org-id',
 *   userId: 'user-id',
 * })
 */
