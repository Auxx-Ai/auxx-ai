// packages/lib/src/jobs/maintenance/recurring-journals-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sweepRecurringJournals } from '../../accounting/journals/recurring'
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
 */
export async function recurringJournalsJob(ctx: JobContext): Promise<void> {
  logger.info('Running recurring journals sweep', { jobId: ctx.jobId })
  const summary = await sweepRecurringJournals(database)
  logger.info('Recurring journals sweep finished', {
    jobId: ctx.jobId,
    rulesEvaluated: summary.rulesEvaluated,
    entriesGenerated: summary.entriesGenerated,
    entriesPosted: summary.entriesPosted,
    failed: summary.failed,
  })
}
