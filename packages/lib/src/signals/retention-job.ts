// packages/lib/src/signals/retention-job.ts
// Nightly `EntitySignal` retention (plans/signals/01-signal-store.md "Retention").
// High-volume kinds (`HIGH_VOLUME_SIGNAL_KINDS` — one row per open/page-view) are pruned after
// 180 days; rollups persist (the sweep job already decays their counts as rows age out of the
// 30-day window well before this 180-day prune runs). Low-volume kinds (`message:sent`, etc.)
// are kept indefinitely — `message:sent` doubles as dispatch's duplicate-send guard and must
// never be pruned inside any window a send-dedup check looks at. Modeled on
// `record-rules/run-retention-job.ts`.
//
// `EntitySignalLink.signalId` FKs `EntitySignal.id` with `onDelete: 'cascade'`
// (packages/database/src/db/schema/entity-signal.ts) — deleting a signal here cascades its
// link rows automatically, no separate delete needed.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { JobContext } from '../jobs/types'
import { HIGH_VOLUME_SIGNAL_KINDS } from './types'

const logger = createScopedLogger('signal-retention')

export const SIGNAL_RETENTION_JOB_NAME = 'signalRetentionJob'

/** Keep high-volume EntitySignal rows for this many days. */
const SIGNAL_RETENTION_DAYS = 180

/** Rows deleted per pass — bounds the lock window on a large backlog. */
const SIGNAL_RETENTION_BATCH = 5000

interface SignalRetentionJobData {
  /** Override the retention window in days (default {@link SIGNAL_RETENTION_DAYS}). */
  retentionDays?: number
}

/**
 * Delete high-volume `EntitySignal` rows older than the retention window, in bounded batches
 * so a long backlog never holds one long lock. Runs until a pass deletes fewer than the batch
 * size (backlog drained).
 */
export async function signalRetentionJob(
  ctx: JobContext<SignalRetentionJobData | undefined>
): Promise<void> {
  const retentionDays = ctx.data?.retentionDays ?? SIGNAL_RETENTION_DAYS
  const kinds = HIGH_VOLUME_SIGNAL_KINDS
  if (kinds.length === 0) return

  const kindsList = sql.join(
    kinds.map((kind) => sql`${kind}`),
    sql`, `
  )

  let totalDeleted = 0
  let deleted = 0
  do {
    const result = await database.execute(sql`
      DELETE FROM "EntitySignal"
      WHERE id IN (
        SELECT id FROM "EntitySignal"
        WHERE "kind" IN (${kindsList})
          AND "occurredAt" < now() - (${retentionDays} * interval '1 day')
        LIMIT ${SIGNAL_RETENTION_BATCH}
      )
    `)
    deleted = result.rowCount ?? 0
    totalDeleted += deleted
  } while (deleted === SIGNAL_RETENTION_BATCH)

  if (totalDeleted > 0) {
    logger.info('Pruned old signals', { totalDeleted, retentionDays, kinds })
  }
}
