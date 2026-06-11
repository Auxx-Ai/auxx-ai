// packages/lib/src/jobs/maintenance/data-migrations-job.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RunSummary } from '../../data-migrations'
import { runPendingDataMigrations } from '../../data-migrations'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('data-migrations-job')

/** Fixed jobId so concurrent enqueues coalesce while one run is queued/active. */
const DATA_MIGRATIONS_JOB_ID = 'data-migrations-run'

/**
 * Maintenance job that applies all pending data migrations. Enqueued at worker boot
 * and from the superadmin panel; exactly-once is enforced by the advisory lock + ledger
 * inside the runner, not by the queue. `attempts: 1` — a failed migration is recorded
 * and re-run is a deliberate action, never an auto-retry.
 */
export async function dataMigrationsJob(
  ctx: JobContext
): Promise<RunSummary | { skipped: 'lock-held' }> {
  logger.info('Running pending data migrations', { jobId: ctx.jobId })
  const summary = await runPendingDataMigrations(db)
  logger.info('Data migrations job finished', { summary, jobId: ctx.jobId })
  return summary
}

/**
 * Enqueue a data-migrations run on the maintenance queue. `removeOnComplete`/`removeOnFail`
 * drop the job as soon as it settles so a fresh run can always be enqueued later, while
 * the fixed jobId coalesces repeat enqueues during a queued/active run.
 */
export async function enqueueDataMigrationsRun(): Promise<void> {
  const { getQueue } = await import('../queues')
  const { Queues } = await import('../queues/types')
  const queue = getQueue(Queues.maintenanceQueue)

  await queue.add(
    'dataMigrationsJob',
    {},
    {
      jobId: DATA_MIGRATIONS_JOB_ID,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
      priority: 5,
    }
  )

  logger.info('Enqueued data migrations run')
}
