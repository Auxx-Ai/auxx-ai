// packages/lib/src/jobs/maintenance/recurring-journals-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sweepRecurringJournals } from '../../postings/recurring-journals'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('recurring-journals-job')

/**
 * Daily sweep for recurring journal templates
 * (`plans/accounting/tasks/21-the-books-stand-alone.md` §1.2): copies every
 * `journal_entries` `RecurrenceRule` whose cursor has fallen behind into the
 * DRAFT entries it owes, oldest first.
 *
 * Scheduled nightly via `upsertJobScheduler` at 03:45 UTC - fifteen minutes
 * after the invoice-draft sweep and forty-five after the visit one, so the
 * three recurrence consumers do not contend, and late enough that the day it
 * generates for is over in every zone west of UTC. See
 * `apps/worker/src/workers/index.ts`.
 *
 * 🛑 It generates DRAFTS and posts nothing (MK's decision A). The summary's
 * `held` list is the one thing worth reading in a log: those are entries the
 * books are owed and cannot have, because the month they belong to is closed.
 * The sweep does not decide - the cursor holds the occurrence, and somebody
 * with `ledgerControl` reopens the month or accepts that the entry is late.
 */
export async function recurringJournalsJob(ctx: JobContext): Promise<void> {
  logger.info('Running recurring journals sweep', { jobId: ctx.jobId })
  const summary = await sweepRecurringJournals(database)
  logger.info('Recurring journals sweep finished', {
    jobId: ctx.jobId,
    rulesEvaluated: summary.rulesEvaluated,
    entriesGenerated: summary.entriesGenerated,
    heldByClosedPeriod: summary.held.length,
    failed: summary.failed,
  })
}
