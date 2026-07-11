// packages/lib/src/jobs/maintenance/recurring-visits-job.ts

import { createScopedLogger } from '@auxx/logger'
import { sweepRecurringVisits } from '../../dispatch/recurring'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('recurring-visits-job')

/**
 * Daily sweep for the dispatch recurring engine
 * (plans/dispatch/06-recurring-engine.md §4.4/§5.3): extends the materialization horizon for
 * every `active` recurring engagement that's fallen behind, and auto-ends engagements whose
 * pattern (`until`/`count`) has run its course. Scheduled nightly via `upsertJobScheduler` —
 * see `apps/worker/src/workers/index.ts`.
 */
export async function recurringVisitsJob(ctx: JobContext): Promise<void> {
  logger.info('Running recurring visits sweep', { jobId: ctx.jobId })
  await sweepRecurringVisits()
  logger.info('Recurring visits sweep finished', { jobId: ctx.jobId })
}
