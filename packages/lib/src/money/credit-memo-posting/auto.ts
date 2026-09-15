// packages/lib/src/money/credit-memo-posting/auto.ts
//
// The `auto` lane: after a connector sync has written channel credit memos, put
// one job on the queue that posts them (accounting brief 28 §3.1).
//
// This file is deliberately the whole of the automatic side. It reads ONE
// setting and enqueues ONE job, and everything that decides what actually gets
// posted - the range, the grouping, the cutoff, the locked period, the
// settlement account, the exclusions, the issuing of drafts - lives in `plan.ts`
// and `run.ts`, where the manual dialog reaches it too. `auto` and `manual` are
// therefore the same run with a different trigger, which is the only way the
// preview a person reviews can be trusted to describe what the automatic lane
// does. `money/fulfillment-posting/auto.ts` is this file for shipments, and the
// two are kept the same shape on purpose.
//
// The one thing the lane does NOT read is `accounting.creditMemoGrouping`. That
// setting is what the dialog opens on (it defaults to `month`, brief 28 §10
// decision 6); the job it enqueues always posts per DAY. A group key claims its
// period once and every memo that arrives for an already-posted period takes
// the next attempt (`run.ts`), so a lane on `month` would mint an
// attempt-suffixed entry for the current month on every sync that carried a
// memo, for the whole month. A day closes with the calendar, so a second
// attempt on a day is the exception. See `jobs/money/credit-memo-posting-job.ts`.
//
// NEVER THROWS. Its one caller is the finalize integrity pass at the end of a
// connector sync. A throw there aborts the pass chain and, with it, the sync's
// own bookkeeping - to skip a posting that the very next sync, or the dialog,
// would pick up anyway. There is nothing here worth failing a sync for.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getQueue, Queues } from '../../jobs/queues'
import { getOrganizationSetting } from '../../settings/settings-service'
import { CREDIT_MEMO_POSTING_SETTING_KEY } from './types'

const logger = createScopedLogger('money:credit-memo-posting:auto')

/**
 * The BullMQ job name the worker maps to the runner.
 *
 * Declared here, beside the only enqueue, and imported by the worker's job map
 * rather than retyped there - the `FULFILLMENT_POSTING_JOB_NAME` shape. Two
 * copies of a job name fail at runtime with "Job function not found", which is
 * a log line in a worker rather than a red test.
 */
export const CREDIT_MEMO_POSTING_JOB_NAME = 'postCreditMemos'

/**
 * The job id every enqueue for one organization uses.
 *
 * Hyphens, never colons. BullMQ rejects a custom `jobId` containing `:` unless
 * it splits into exactly three parts, so a two-part `credit-memo-posting:<org>`
 * would throw `Custom Id cannot contain :` on every enqueue - swallowed by the
 * catch below, which is the worst possible place to learn about it.
 */
export function creditMemoPostingJobId(organizationId: string): string {
  return `credit-memo-posting-${organizationId}`
}

/**
 * Enqueue a credit memo posting run for one organization, if it asked for one.
 *
 * Called at the end of a connector sync, after channel memos have been written.
 * Does nothing at all when `accounting.creditMemoPosting` is `manual`, which is
 * the default: the dialog's preview is the review step, and a mode that posted
 * anyway would make the setting a lie.
 *
 * The per-organization `jobId` is the point, not an optimisation. A sync can
 * finish several times in a minute (a webhook burst, a retried poll, a person
 * pressing Sync), and each finish would otherwise queue a full run over the same
 * backlog. BullMQ refuses a duplicate `jobId` while a job with that id is still
 * queued, so the second, third and fourth finishes collapse into the one run
 * that has not started yet - which is exactly right, because the run reads the
 * backlog when it starts rather than when it was queued. Once a run HAS started
 * the id is free again, so a sync that lands mid-run still gets its own pass.
 *
 * Call this after the sync's writes have committed. The job resolves the
 * backlog on its own connection and cannot see uncommitted rows, so an enqueue
 * from inside the writing transaction can produce a run that finds nothing.
 *
 * **Never throws.** A failure to read the setting or reach Redis is logged and
 * swallowed; the next sync, or the dialog, posts the same backlog.
 *
 * @param db The database handle the caller is already using.
 * @param organizationId The organization whose backlog to post.
 */
export async function autoPostCreditMemosAfterSync(
  db: Database,
  organizationId: string
): Promise<void> {
  try {
    const mode = await getOrganizationSetting({
      organizationId,
      key: CREDIT_MEMO_POSTING_SETTING_KEY,
      db,
    })
    if (mode !== 'auto') return

    await getQueue(Queues.creditMemoPostingQueue).add(
      CREDIT_MEMO_POSTING_JOB_NAME,
      { organizationId },
      { jobId: creditMemoPostingJobId(organizationId) }
    )
  } catch (error) {
    logger.error('Failed to enqueue the automatic credit memo posting run', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
