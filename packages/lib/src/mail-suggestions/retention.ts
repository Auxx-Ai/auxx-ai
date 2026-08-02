// packages/lib/src/mail-suggestions/retention.ts
// Retention for MailSuggestion (§5.4). Batched deletes (LIMIT per pass) keep the
// lock short; backed by `MailSuggestion_createdAt_idx`. Global (all orgs),
// age-based. Shape copied from `record-rules/run-retention-job.ts`.
//
// ⚠️ ONLY `status = 'new'` ROWS ARE SWEPT.
//
// `dismissed` rows ARE the suppression list (invariant 7) — deleting one
// resurrects its card on the very next weekly sweep, which is the failure this
// feature is least able to afford: a user who dismissed a suggestion and sees it
// again next Monday has learned that dismissing does nothing. `accepted` rows
// are the record that we proposed a filter that now exists, and the miner reads
// both statuses to decide what never to propose again. An "expire everything
// older than 90 days" sweep would quietly re-enable every suggestion the org has
// ever refused.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { ok, type Result } from 'neverthrow'

const logger = createScopedLogger('mail-suggestions-retention')

/**
 * Keep UNDECIDED cards for this many days.
 *
 * The same number as the mining window on purpose: a card whose evidence window
 * has fully rolled over is describing mail the miner no longer looks at, and the
 * weekly sweep would have refreshed it if the group still qualified.
 */
export const SUGGESTION_RETENTION_DAYS = 90

/** Rows deleted per pass — bounds the lock window on a large backlog. */
const RETENTION_BATCH = 5000

/**
 * Delete undecided suggestions older than the retention window, in bounded
 * batches so a long backlog never holds one long lock. Runs until a pass deletes
 * fewer than the batch size (backlog drained).
 */
export async function sweepStaleMailSuggestions(
  db: Database,
  opts: { retentionDays?: number } = {}
): Promise<Result<number, Error>> {
  const retentionDays = opts.retentionDays ?? SUGGESTION_RETENTION_DAYS

  let totalDeleted = 0
  let deleted = 0
  do {
    const result = await db.execute(sql`
      DELETE FROM "MailSuggestion"
      WHERE id IN (
        SELECT id FROM "MailSuggestion"
        WHERE "status" = 'new'
          AND "createdAt" < now() - (${retentionDays} * interval '1 day')
        LIMIT ${RETENTION_BATCH}
      )
    `)
    deleted = result.rowCount ?? 0
    totalDeleted += deleted
  } while (deleted === RETENTION_BATCH)

  if (totalDeleted > 0) {
    logger.info('Pruned stale mail suggestions', { totalDeleted, retentionDays })
  }
  return ok(totalDeleted)
}
