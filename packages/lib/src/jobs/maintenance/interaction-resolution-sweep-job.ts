// packages/lib/src/jobs/maintenance/interaction-resolution-sweep-job.ts

import { createScopedLogger } from '@auxx/logger'
import { sweepInteractionResolution } from '../../interactions/sweep'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('interaction-resolution-sweep-job')

/**
 * Nightly gap filler for contact/company interaction resolution.
 *
 * Both live callers are event-driven — pass 5 of the sync finalize integrity passes for bulk
 * runs, a field-change hook for interactive writes — so this exists for what they drop: a
 * run whose manifest membership truncated, a hook whose fire-and-forget promise died with
 * its process, and records created in the window before either caller shipped.
 *
 * Windowed to the last 30 days on purpose (see `interactions/sweep.ts`): "no interaction
 * stamps" is not a converging candidate set, because a contact who has never written to us
 * never gets one. Historical recovery is the backfill script's job
 * (`apps/worker/scripts/resolve-interactions-backfill.ts`), which passes `allTime`.
 *
 * Scheduled nightly via `upsertJobScheduler` — see `apps/worker/src/workers/index.ts`.
 * Idempotent: every phase is guarded (`IS NULL` on the links, monotonic on the stamps), so a
 * re-run after a failure writes strictly less.
 */
export async function interactionResolutionSweepJob(ctx: JobContext): Promise<void> {
  logger.info('Running interaction resolution sweep', { jobId: ctx.jobId })
  const summary = await sweepInteractionResolution()
  logger.info('Interaction resolution sweep finished', { jobId: ctx.jobId, ...summary })
}
