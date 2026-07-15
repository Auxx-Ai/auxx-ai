// packages/lib/src/jobs/maintenance/dispatch-digest-job.ts

import { createScopedLogger } from '@auxx/logger'
import { runDispatchDigestSweep } from '../../dispatch/digest'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('dispatch-digest-job')

/**
 * Hourly opt-in daily-schedule-digest sweep (plans/dispatch/19-client-notifications.md §4.9):
 * for each org whose local time just crossed the digest hour (default 06:00), emails every
 * worker with visits that local day and the `notification.dispatch.dailyDigest` pref on.
 * Scheduled hourly via `upsertJobScheduler` — see `apps/worker/src/workers/index.ts`. The
 * per-org/day Redis marker inside `runDispatchDigestSweep` makes re-running this job within
 * the same local day a no-op.
 */
export async function dispatchDigestJob(ctx: JobContext): Promise<void> {
  logger.info('Running dispatch digest sweep', { jobId: ctx.jobId })
  await runDispatchDigestSweep()
  logger.info('Dispatch digest sweep finished', { jobId: ctx.jobId })
}
