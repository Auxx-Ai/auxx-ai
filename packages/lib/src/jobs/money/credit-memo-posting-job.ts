// packages/lib/src/jobs/money/credit-memo-posting-job.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { runCreditMemoPosting } from '../../money/credit-memo-posting/run'
import type { JobContext } from '../types'

const logger = createScopedLogger('jobs:money:credit-memo-posting')

/** Payload for {@link creditMemoPostingJob}. One organization, nothing else. */
export interface CreditMemoPostingJobData {
  organizationId: string
}

/**
 * The `auto` lane's worker job: post every unposted credit memo in one
 * organization, one entry per issue day (accounting brief 28 §3.1).
 *
 * A thin wrapper around {@link runCreditMemoPosting}, the shape
 * `fulfillment-posting-job.ts` takes around its runner. Every decision - the
 * cutoff, the locked period, the settlement account, the exclusions - is the
 * runner's, so this lane and the dialog cannot disagree about what a memo posts
 * to.
 *
 * The range is the WHOLE history (`2000-01-01` to tomorrow), not the sync's own
 * window, and that is deliberate. The read returns memos with no LIVE posting
 * stamped, so a bounded range would permanently strand anything a previous run
 * excluded or failed on - a reversed posting, a memo whose contact was missing
 * until somebody fixed it, a day that was locked when it was first seen.
 * Sweeping the backlog every time is what makes the automatic lane
 * self-healing, and it costs one indexed read on a set that is empty in the
 * steady state.
 *
 * `issueDrafts` is TRUE here, and this is the one place the two auto lanes
 * differ in substance. Channel memos are ingested as `draft`
 * (`CreditMemoPostingPlanInput.issueDrafts`'s own comment: every one of
 * DemoOrg1's 1,061 was), so a lane that only posted issued memos would preview
 * an empty plan over the whole backlog after every sync and post nothing - the
 * setting would be a lie. Choosing `auto` for channel memos IS choosing to
 * issue them without a person looking, which is why `manual` is the default
 * and the settings row says so. A channel memo keeps its own refund date
 * (`resolveIssue` refuses one with neither `input.issuedAt` nor a stored
 * `issuedAt` rather than dating it with the clock), so issuing a January
 * backlog in September still groups it into January. A `void` memo is never
 * resurrected by this flag.
 *
 * `to` is derived in UTC and is an upper bound only. The range is half-open on
 * `issuedAt`, which is already a calendar day in the book timezone, so a loose
 * bound cannot pull in anything that is not there.
 *
 * `grouping` is `day`, deliberately, and NOT `accounting.creditMemoGrouping`.
 * That setting is what the dialog opens on and defaults to `month` (brief 28
 * §10 decision 6). A group key claims its period once, and every memo that
 * arrives for an already-posted period is posted under the next attempt
 * (`run.ts`'s attempt count). A month stays open for weeks, so a lane on
 * `month` would mint an attempt-suffixed entry for the current month on every
 * sync that carried a memo; a day closes with the calendar, so on `day` a
 * second attempt is the exception (a memo that arrived one sync late) rather
 * than the rule.
 *
 * **Never throws.** `runCreditMemoPosting` reports every per-group failure in
 * its summary rather than raising, so a job that reaches the end has succeeded
 * even when some groups did not.
 */
export const creditMemoPostingJob = async (ctx: JobContext<CreditMemoPostingJobData>) => {
  const { organizationId } = ctx.data

  const summary = await runCreditMemoPosting(db, {
    organizationId,
    // Nobody asked. The dialog passes the person who pressed the button; this
    // lane has no actor, and the `null` is what tells the poster so.
    actorUserId: null,
    range: { from: '2000-01-01', to: tomorrow() },
    grouping: 'day',
    issueDrafts: true,
  })

  logger.info('Automatic credit memo posting run finished', {
    organizationId,
    posted: summary.posted.length,
    skipped: summary.skipped.length,
    failed: summary.failed.length,
    excluded: summary.exclusions.length,
    issued: summary.issued.count,
    unissuable: summary.issued.failed.length,
    memos: summary.posted.reduce((total, group) => total + group.memos, 0),
  })

  return summary
}

/** `YYYY-MM-DD`, one day from now in UTC. The half-open upper bound. */
function tomorrow(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
