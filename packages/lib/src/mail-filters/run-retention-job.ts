// packages/lib/src/mail-filters/run-retention-job.ts
// Nightly MailFilterRun retention. One row per (filter, message) firing, so a
// busy inbox with a handful of filters logs thousands of rows a week —
// age-prune anything older than the retention window. Batched deletes (LIMIT per
// pass) keep the lock short. Backed by `MailFilterRun_firedAt_idx`. Global (all
// orgs), age-based. Shape copied from `record-rules/run-retention-job.ts`.
//
// ⚠️ Undo stays available for the LIFE OF THE RUN ROW (§6.5), so this job is
// what bounds it: a firing older than the window can no longer be reversed from
// the thread badge or the run history. Lengthening the window lengthens the undo
// horizon and vice versa — they are the same number.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { JobContext } from '../jobs/types'

const logger = createScopedLogger('mail-filter-run-retention')

export const MAIL_FILTER_RUN_RETENTION_JOB_NAME = 'mailFilterRunRetentionJob'

/** Keep MailFilterRun rows — and therefore Undo — for this many days. */
const RUN_RETENTION_DAYS = 60

/** Rows deleted per pass — bounds the lock window on a large backlog. */
const RUN_RETENTION_BATCH = 5000

interface RunRetentionJobData {
  /** Override the retention window in days (default {@link RUN_RETENTION_DAYS}). */
  retentionDays?: number
}

/**
 * Delete MailFilterRun rows older than the retention window, in bounded batches
 * so a long backlog never holds one long lock. Runs until a pass deletes fewer
 * than the batch size (backlog drained).
 */
export async function mailFilterRunRetentionJob(
  ctx: JobContext<RunRetentionJobData | undefined>
): Promise<void> {
  const retentionDays = ctx.data?.retentionDays ?? RUN_RETENTION_DAYS

  let totalDeleted = 0
  let deleted = 0
  do {
    const result = await database.execute(sql`
      DELETE FROM "MailFilterRun"
      WHERE id IN (
        SELECT id FROM "MailFilterRun"
        WHERE "firedAt" < now() - (${retentionDays} * interval '1 day')
        LIMIT ${RUN_RETENTION_BATCH}
      )
    `)
    deleted = result.rowCount ?? 0
    totalDeleted += deleted
  } while (deleted === RUN_RETENTION_BATCH)

  if (totalDeleted > 0) {
    logger.info('Pruned old mail-filter runs', { totalDeleted, retentionDays })
  }
}
