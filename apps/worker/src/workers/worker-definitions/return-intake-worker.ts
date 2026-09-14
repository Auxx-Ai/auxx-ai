// apps/worker/src/workers/worker-definitions/return-intake-worker.ts

import { returnIntakeJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:return-intake')

/**
 * ⚠️ The key is the name `enqueueReturnIntake` adds under
 * (`RETURN_INTAKE_JOB_NAME`). Nothing in the type system connects the two: a
 * mismatch compiles and fails at runtime with `Job function not found`.
 */
const returnIntakeJobMappings = {
  returnIntakeJob,
}

/**
 * Starts the BullMQ worker for the return-label intake queue
 * (plans/money/tasks/57-return-intake-wizard.md §3).
 *
 * Low concurrency: one job is up to twenty single-image LLM reads, one per
 * label, and the person who photographed them is watching a dialog. Three at a
 * time keeps two docks moving without letting either crowd the org's model
 * quota.
 */
export function startReturnIntakeWorker() {
  logger.info(`Starting worker for queue: ${Queues.returnIntakeQueue}`)

  return createWorker(Queues.returnIntakeQueue, returnIntakeJobMappings, {
    concurrency: 3,
  })
}
