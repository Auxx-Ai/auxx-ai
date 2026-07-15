// packages/lib/src/jobs/maintenance/sequence-enrollment-sweep-job.ts

import { createScopedLogger } from '@auxx/logger'
import { runSequenceEnrollmentSweep } from '../../sequences/sweep'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('sequence-enrollment-sweep-job')

/**
 * Hourly enrollment sweep (plans/dispatch/19-client-notifications.md §4.3, decision #13):
 * for every enabled `visit:scheduled` sequence, enrolls scheduled visits (one-off AND
 * recurring) whose `startTime` falls within the sequence's computed lookahead window —
 * any-run-ever dedup inside `enrollSubjectInSequence` makes re-running this job a no-op for
 * visits already swept.
 */
export async function sequenceEnrollmentSweepJob(ctx: JobContext): Promise<void> {
  logger.info('Running sequence enrollment sweep', { jobId: ctx.jobId })
  await runSequenceEnrollmentSweep()
  logger.info('Sequence enrollment sweep finished', { jobId: ctx.jobId })
}
