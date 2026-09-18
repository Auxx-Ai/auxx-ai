// packages/lib/src/jobs/maintenance/payout-sync-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { recoverPayoutReconciliationPage } from '../../accounting/money/payouts/reconcile-records'
import { sweepPayouts } from '../../accounting/money/payouts/sweep'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('payout-sync-job')

/**
 * Recover persisted financial records in bounded pages, then run legacy payout sources
 * whose processor accounts have not moved to the shared financial record path.
 * Scheduled nightly; each recovery page saves its cursor for job retries.
 */
export async function payoutSyncJob(ctx: JobContext): Promise<void> {
  logger.info('Running payout sync sweep', { jobId: ctx.jobId })
  let cursor =
    typeof ctx.data?.reconciliationCursor === 'string' ? ctx.data.reconciliationCursor : undefined
  let changed = 0
  do {
    ctx.throwIfCancelled()
    const page = await recoverPayoutReconciliationPage(database, cursor)
    changed += page.changed
    cursor = page.nextCursor ?? undefined
    await ctx.job.updateData({ ...ctx.job.data, reconciliationCursor: cursor ?? null })
  } while (cursor)
  logger.info('Persisted payout reconciliation recovered', { jobId: ctx.jobId, changed })
  const summary = await sweepPayouts()
  logger.info('Payout sync sweep finished', { jobId: ctx.jobId, ...summary })
}
