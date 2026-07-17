// packages/lib/src/signals/rollup-sweep-job.ts
// Nightly `EntitySignalRollup` `*Count30d` decay sweep (plans/signals/01-signal-store.md
// "Rollups" — "*Count30d columns refreshed by a nightly sweep job (decay); inline path only
// increments"). `recordSignal()`/`recordSignals()` (`rollup.ts`) only ever increment a
// count30d column inline — this job is what brings a count back down once its 30-day window
// empties, and is also what a backfill write (which intentionally skips the increment for an
// old `occurredAt`) needs to converge on the correct number. Modeled on
// `record-rules/run-retention-job.ts`.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { JobContext } from '../jobs/types'
import { SIGNAL_KIND_LIST, SIGNAL_KINDS, type SignalKind, type SignalKindMeta } from './types'

const logger = createScopedLogger('signal-rollup-sweep')

export const SIGNAL_ROLLUP_SWEEP_JOB_NAME = 'signalRollupSweepJob'

/** Rollup families that carry a `*Count30d` column — the other families (`reply`,
 * `unsubscribe`, `bounce`, `resubscribe`, `none`) only ever move a `last*At` column, which the
 * inline upsert already keeps correct with no decay to apply. */
const COUNT_FAMILIES: {
  family: Extract<SignalKindMeta['rollup'], 'open' | 'click' | 'visit'>
  countColumn: string
  lastColumn: string
}[] = [
  { family: 'open', countColumn: 'openCount30d', lastColumn: 'lastOpenedAt' },
  { family: 'click', countColumn: 'clickCount30d', lastColumn: 'lastClickedAt' },
  { family: 'visit', countColumn: 'visitCount30d', lastColumn: 'lastVisitAt' },
]

function kindsForFamily(family: SignalKindMeta['rollup']): SignalKind[] {
  return SIGNAL_KIND_LIST.filter((kind) => SIGNAL_KINDS[kind].rollup === family)
}

/**
 * Recompute `openCount30d` / `clickCount30d` / `visitCount30d` from `EntitySignal` for every
 * rollup row that's either currently nonzero or has a matching `last*At` inside the 30-day
 * window — a correlated-subquery `UPDATE` per family, so a row that ages out of the window
 * gets reset to 0 (the inline increment path never decrements, so this sweep is the only
 * thing that ever brings a count back down). Bot-flagged signals never count, matching the
 * inline path.
 */
export async function signalRollupSweepJob(ctx: JobContext): Promise<void> {
  logger.info('Running signal rollup sweep', { jobId: ctx.jobId })
  const summary: Record<string, number> = {}

  for (const { family, countColumn, lastColumn } of COUNT_FAMILIES) {
    const kinds = kindsForFamily(family)
    if (kinds.length === 0) {
      summary[family] = 0
      continue
    }

    const kindsList = sql.join(
      kinds.map((kind) => sql`${kind}`),
      sql`, `
    )
    const countCol = sql.raw(`"${countColumn}"`)
    const lastCol = sql.raw(`"${lastColumn}"`)

    const result = await database.execute(sql`
      UPDATE "EntitySignalRollup" r
      SET ${countCol} = COALESCE((
        SELECT count(*)::int FROM "EntitySignal" s
        WHERE s."organizationId" = r."organizationId"
          AND s."contactEntityInstanceId" = r."entityInstanceId"
          AND s."kind" IN (${kindsList})
          AND s."isBot" = false
          AND s."occurredAt" >= now() - interval '30 days'
      ), 0),
      "updatedAt" = now()
      WHERE r.${countCol} > 0
         OR (r.${lastCol} IS NOT NULL AND r.${lastCol} >= now() - interval '30 days')
    `)
    summary[family] = result.rowCount ?? 0
  }

  logger.info('Rollup sweep completed', { jobId: ctx.jobId, ...summary })
}
