// packages/lib/src/record-rules/run-retention-job.ts
// Nightly RecordRuleRun retention. Sync + system-rule firings multiply run rows
// (every BOM recalc, every synced-field transition logs one), so age-prune anything
// older than the retention window. Batched deletes (LIMIT per pass) keep the lock short.
// Backed by `RecordRuleRun_firedAt_idx`. Global (all orgs), age-based.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { JobContext } from '../jobs/types'

const logger = createScopedLogger('record-rule-run-retention')

export const RECORD_RULE_RUN_RETENTION_JOB_NAME = 'recordRuleRunRetentionJob'

/** Keep RecordRuleRun rows for this many days. */
const RUN_RETENTION_DAYS = 60

/** Rows deleted per pass — bounds the lock window on a large backlog. */
const RUN_RETENTION_BATCH = 5000

interface RunRetentionJobData {
  /** Override the retention window in days (default {@link RUN_RETENTION_DAYS}). */
  retentionDays?: number
}

/**
 * Delete RecordRuleRun rows older than the retention window, in bounded batches so a
 * long backlog never holds one long lock. Runs until a pass deletes fewer than the batch
 * size (backlog drained).
 */
export async function recordRuleRunRetentionJob(
  ctx: JobContext<RunRetentionJobData | undefined>
): Promise<void> {
  const retentionDays = ctx.data?.retentionDays ?? RUN_RETENTION_DAYS

  let totalDeleted = 0
  let deleted = 0
  do {
    const result = await database.execute(sql`
      DELETE FROM "RecordRuleRun"
      WHERE id IN (
        SELECT id FROM "RecordRuleRun"
        WHERE "firedAt" < now() - (${retentionDays} * interval '1 day')
        LIMIT ${RUN_RETENTION_BATCH}
      )
    `)
    deleted = result.rowCount ?? 0
    totalDeleted += deleted
  } while (deleted === RUN_RETENTION_BATCH)

  if (totalDeleted > 0) {
    logger.info('Pruned old record-rule runs', { totalDeleted, retentionDays })
  }
}
