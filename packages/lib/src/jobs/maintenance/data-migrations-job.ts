// packages/lib/src/jobs/maintenance/data-migrations-job.ts

import { getAppVersion } from '@auxx/config/client'
import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RunSummary } from '../../data-migrations'
import { runPendingDataMigrations } from '../../data-migrations'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('data-migrations-job')

/** Fixed jobId so concurrent enqueues coalesce while one run is queued/active. */
const DATA_MIGRATIONS_JOB_ID = 'data-migrations-run'

/**
 * Maintenance job that applies all pending data migrations. Two callers: the hourly
 * scheduler registered in `setupSchedules`, and the superadmin panel. Exactly-once is
 * enforced by the advisory lock + ledger inside the runner, not by the queue.
 * `attempts: 1` — a failed migration is recorded and re-run is a deliberate action,
 * never an auto-retry.
 *
 * ⚠️ This is the SAFETY NET, not the primary trigger. A queue is the wrong delivery
 * mechanism for "apply the migrations this build ships": during a rolling deploy two
 * builds consume one Redis, and the outgoing one will happily run this against its own
 * older registry and report `applied: []` as success. The primary trigger is the
 * in-process call in `apps/worker/src/server.ts` for exactly that reason.
 */
export async function dataMigrationsJob(
  ctx: JobContext
): Promise<RunSummary | { skipped: 'lock-held' }> {
  // `build` is the whole diagnosis when this goes wrong. A run that applies nothing
  // is indistinguishable from a correct no-op UNLESS you can see which build produced
  // it: on 2026-09-11 the outgoing 0.1.234 container answered for 0.1.235's boot and
  // reported `applied: []` as success, and nothing in the logs said so.
  const build = getAppVersion()
  logger.info('Running pending data migrations', { jobId: ctx.jobId, build })
  const summary = await runPendingDataMigrations(db)
  logger.info('Data migrations job finished', { summary, jobId: ctx.jobId, build })
  return summary
}

/**
 * Enqueue a data-migrations run on the maintenance queue, for the superadmin panel.
 *
 * The fixed jobId coalesces repeat clicks during a queued/active run, and
 * `removeOnComplete`/`removeOnFail` drop the job the moment it settles so the next
 * click can enqueue again. Those two settings are a pair: BullMQ treats `add` with an
 * existing jobId as a no-op, so RETAINING a completed job under this fixed id would
 * make the panel button work exactly once and then silently do nothing forever.
 *
 * That is also why the audit trail lives in the log line (which names the build that
 * ran it) and in the `DataMigration` ledger, not in a retained job.
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
