// apps/worker/src/boot/run-pending-migrations.ts

import { getAppVersion } from '@auxx/config/client'
import { database } from '@auxx/database'
import { runPendingDataMigrations } from '@auxx/lib/data-migrations'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('data-migrations-boot')

/**
 * Apply pending data migrations IN THIS PROCESS, deliberately not via the queue.
 *
 * A rolling deploy runs two builds against one Redis, and BullMQ has no notion of
 * which build should handle a message. Worse, the boot enqueue used to sit inside
 * `setupSchedules()` — which runs before `startWorkers()` attaches any consumer and
 * before the healthcheck binds, so the outgoing container had not even been signalled
 * to drain and was the ONLY possible consumer. It was not a race the new container
 * could lose; it was one it could never enter.
 *
 * On 2026-09-11 the outgoing 0.1.234 worker answered 0.1.235's boot, found nothing
 * pending against its own older registry, reported `applied: []` as SUCCESS, and
 * `removeOnComplete` erased the job. Thirteen migrations stayed pending until a human
 * noticed.
 *
 * Calling the runner here makes the code that applies the migrations and the code that
 * ships them the same artifact, so the question cannot be decided by timing at all.
 * `runPendingDataMigrations` takes a Postgres advisory lock, so replicas and the
 * superadmin panel still dedupe against each other.
 *
 * Fire-and-forget on purpose: boot must not block on a long backfill, or a slow
 * migration trips Railway's healthcheck timeout and fails the deploy. The hourly
 * `dataMigrationsJob` scheduler is the safety net for a process that dies mid-run.
 */
export function runPendingMigrationsInProcess(): void {
  // `build` is the whole diagnosis when this goes wrong. A run that applies nothing is
  // indistinguishable from a correct no-op unless the log says which build produced it.
  const build = getAppVersion()
  logger.info('Applying pending data migrations in-process', { build })

  void runPendingDataMigrations(database)
    .then((summary) => {
      logger.info('Boot data-migrations run finished', { summary, build })
    })
    .catch((error: unknown) => {
      // Nothing awaits this promise, so without the catch a failure is invisible —
      // and an unhandled rejection would take the worker down with it.
      logger.error('Boot data-migrations run failed', {
        error: error instanceof Error ? error.message : String(error),
        build,
      })
    })
}
