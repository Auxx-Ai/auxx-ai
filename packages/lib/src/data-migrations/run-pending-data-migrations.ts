// packages/lib/src/data-migrations/run-pending-data-migrations.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { DATA_MIGRATION_LOCK_KEY, withAdvisoryLock } from './advisory-lock'
import { describeMigrationError } from './describe-migration-error'
import { planDataMigrations } from './plan'
import { ALL_DATA_MIGRATIONS } from './registry'
import type { RunSummary } from './types'

const logger = createScopedLogger('data-migrations')

/** Record a migration outcome in the ledger (insert, or update an existing row). */
async function recordOutcome(
  db: Database,
  id: string,
  status: 'applied' | 'failed',
  error: string | null,
  durationMs: number
): Promise<void> {
  const now = new Date()
  await db
    .insert(schema.DataMigration)
    .values({ id, status, error, durationMs, appliedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.DataMigration.id,
      set: { status, error, durationMs, appliedAt: now, updatedAt: now },
    })
}

/**
 * Run all pending data migrations in id order under an advisory lock.
 *
 * - Lock held elsewhere → `{ skipped: 'lock-held' }` (no work done).
 * - Pending = registry minus `applied` rows. A `failed` row blocks itself and
 *   everything after it (fail-stop) until a deliberate re-run clears it.
 * - Each migration is recorded `applied` (with duration) or `failed` (with error);
 *   the run stops at the first failure.
 */
export async function runPendingDataMigrations(
  db: Database
): Promise<RunSummary | { skipped: 'lock-held' }> {
  const outcome = await withAdvisoryLock(db, DATA_MIGRATION_LOCK_KEY, async () => {
    const ledger = await db
      .select({ id: schema.DataMigration.id, status: schema.DataMigration.status })
      .from(schema.DataMigration)

    const plan = planDataMigrations(ALL_DATA_MIGRATIONS, ledger)
    const summary: RunSummary = { applied: [], skipped: plan.skipped }

    for (const migration of plan.toAttempt) {
      const start = Date.now()
      try {
        await migration.run(db)
        const durationMs = Date.now() - start
        await recordOutcome(db, migration.id, 'applied', null, durationMs)
        summary.applied.push(migration.id)
        logger.info(`Data migration ${migration.id} applied`, { durationMs })
      } catch (error) {
        // `error.message` alone is undiagnosable: Drizzle wraps the pg error, so the
        // message is just `Failed query: …` and the SQLSTATE code, constraint, table
        // and column live on `.cause`. Walk the chain and store the useful fields.
        const { summary: errorSummary, pg } = describeMigrationError(error)
        const durationMs = Date.now() - start
        await recordOutcome(db, migration.id, 'failed', errorSummary, durationMs)
        summary.failed = migration.id
        logger.error(`Data migration ${migration.id} failed`, {
          error: errorSummary,
          durationMs,
          ...pg,
        })
        break // fail-stop: later migrations may depend on this one
      }
    }

    // A pre-existing `failed` row halts the run without re-running it.
    if (!summary.failed && plan.haltedBy) summary.failed = plan.haltedBy

    return summary
  })

  if (outcome === 'lock-held') {
    logger.info('Data migrations run skipped — advisory lock held elsewhere')
    return { skipped: 'lock-held' }
  }

  logger.info('Data migrations run complete', outcome)
  return outcome
}
