// packages/lib/src/jobs/maintenance/payout-sync-job.ts

import { createScopedLogger } from '@auxx/logger'
import { sweepPayouts } from '../../money/payouts/sweep'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('payout-sync-job')

/**
 * Daily payout sync for every org with a live Stripe connection (HANDOFF §11.5
 * item 1).
 *
 * `postPayoutEntry` shipped with no caller, so `1200 Card Clearing` was debited
 * gross at every card sale and never credited: the account grew without bound
 * and the processor's fee was never expensed. `payout.paid` in `applyStripeEvent`
 * is the fast door; this is the guarantee behind it, because a webhook can be
 * unsubscribed, dropped, or arrive while the worker is down, and a payout that
 * is never ingested leaves clearing overstated with nothing to say so.
 *
 * Scheduled nightly via `upsertJobScheduler` — see `apps/worker/src/workers/index.ts`.
 * Idempotent: `syncPayouts` keys on the gateway payout id, so a payout already
 * carrying a posting is skipped rather than posted twice.
 */
export async function payoutSyncJob(ctx: JobContext): Promise<void> {
  logger.info('Running payout sync sweep', { jobId: ctx.jobId })
  const summary = await sweepPayouts()
  logger.info('Payout sync sweep finished', { jobId: ctx.jobId, ...summary })
}
