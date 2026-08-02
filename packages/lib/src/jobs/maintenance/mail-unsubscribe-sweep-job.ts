// packages/lib/src/jobs/maintenance/mail-unsubscribe-sweep-job.ts
// Daily "did they honor it?" sweep over MailUnsubscribe (§6.4). Scheduled at
// 05:40 alongside the other maintenance slots (03:00, 03:45, 04:10, 04:25).
//
// Counts the mail from an unsubscribed `subjectKey` that arrived AFTER
// `requestedAt`, maintaining `lastSeenAfterAt` / `messagesSeenAfter` so the UI
// can say *"Stripe ignored your unsubscribe — 6 more since. Filter it?"*, and
// flips `status` to `'ignored'` once a sender is past the 14-day deadline and
// still mailing.
//
// Thin BullMQ glue, the `mail-counts-reconcile-job.ts` shape: the whole
// measurement lives in `@auxx/lib/mail-unsubscribe`'s `sweepMailUnsubscribes`,
// which takes `db` and is therefore testable without a queue.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  type SweepMailUnsubscribesStats,
  sweepMailUnsubscribes,
} from '../../mail-unsubscribe/sweep'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:mail-unsubscribe-sweep')

export const MAIL_UNSUBSCRIBE_SWEEP_JOB_NAME = 'mailUnsubscribeSweepJob'

export interface MailUnsubscribeSweepJobData {
  /** ISO override for the deadline clock — diagnostics and replays only. */
  now?: string
}

/**
 * Sweep every open unsubscribe request. Global (all orgs), age-based.
 *
 * The row set is tiny by construction — at most one per (inbox, list), enforced
 * by `MailUnsubscribe`'s unique index — so one indexed count per row is the
 * whole cost, and no aggregate table is needed (S8).
 */
export async function mailUnsubscribeSweepJob(
  ctx: JobContext<MailUnsubscribeSweepJobData | undefined>
): Promise<SweepMailUnsubscribesStats> {
  const stats = await sweepMailUnsubscribes(database, {
    now: ctx.data?.now ? new Date(ctx.data.now) : undefined,
    isCancelled: () => ctx.isCancelled?.() ?? false,
  })

  if (stats.updated > 0) {
    logger.info('Mail-unsubscribe sweep complete', stats)
  }

  return stats
}
