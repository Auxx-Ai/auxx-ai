// packages/lib/src/jobs/money/fulfillment-posting-job.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { runFulfillmentPosting } from '../../money/fulfillment-posting/run'
import type { JobContext } from '../types'

const logger = createScopedLogger('jobs:money:fulfillment-posting')

/** Payload for {@link fulfillmentPostingJob}. One organization, nothing else. */
export interface FulfillmentPostingJobData {
  organizationId: string
}

/**
 * The `auto` lane's worker job: post every unposted shipment in one
 * organization, one entry per ship day (49 §2.4).
 *
 * A thin wrapper around {@link runFulfillmentPosting}, the same shape a retired QuickBooks
 * invoice-mirror job used to take around its orchestrator (the mirror was retired 2026-09-10,
 * accounting brief 14's DECIDED block). Every decision - the cutoff, the locked period, the
 * debit fork, the exclusions - is the runner's, so this lane and the dialog cannot disagree
 * about what a shipment posts to.
 *
 * 🛑 The range is the WHOLE history (`2000-01-01` to tomorrow), not the sync's
 * own window, and that is deliberate. The read returns shipments with no LIVE
 * posting stamped, so a bounded range would permanently strand anything a
 * previous run excluded or failed on - a reversed posting, an order whose
 * gateways were ambiguous until somebody fixed them, a day that was locked when
 * it was first seen. Sweeping the backlog every time is what makes the automatic
 * lane self-healing, and it costs one indexed read on a set that is empty in the
 * steady state.
 *
 * ⚠️ `to` is derived in UTC and is an upper bound only. The range is half-open
 * on `shippedAt`, which is already a calendar day in the book timezone, so a
 * loose bound cannot pull in anything that is not there; a shipment dated later
 * than UTC-tomorrow (possible only in a UTC+13/+14 book) waits for the next run.
 *
 * **Never throws.** `runFulfillmentPosting` reports every per-group failure in
 * its summary rather than raising, so a job that reaches the end has succeeded
 * even when some groups did not.
 */
export const fulfillmentPostingJob = async (ctx: JobContext<FulfillmentPostingJobData>) => {
  const { organizationId } = ctx.data

  const summary = await runFulfillmentPosting(db, {
    organizationId,
    // Nobody asked. The dialog passes the person who pressed the button; this
    // lane has no actor, and the `null` is what tells the poster so.
    actorUserId: null,
    range: { from: '2000-01-01', to: tomorrow() },
    grouping: 'day',
  })

  logger.info('Automatic fulfillment posting run finished', {
    organizationId,
    posted: summary.posted.length,
    skipped: summary.skipped.length,
    failed: summary.failed.length,
    excluded: summary.exclusions.length,
    shipments: summary.posted.reduce((total, group) => total + group.shipments, 0),
  })

  return summary
}

/** `YYYY-MM-DD`, one day from now in UTC. The half-open upper bound. */
function tomorrow(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
