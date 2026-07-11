// packages/lib/src/jobs/maintenance/invoice-drafts-job.ts

import { createScopedLogger } from '@auxx/logger'
import { sweepInvoiceDrafts } from '../../money/auto-invoice'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('invoice-drafts-job')

/**
 * Daily sweep for `custom_schedule` invoice drafts (money MI2 build spec §G): materializes
 * every `invoice_drafts` `RecurrenceRule` whose horizon has fallen behind. Scheduled nightly
 * via `upsertJobScheduler`, 30 minutes after the dispatch recurring engine's visit sweep (06
 * §5.3) so a same-day visit materialization can't race the billing pass — see
 * `apps/worker/src/workers/index.ts`.
 */
export async function invoiceDraftsJob(ctx: JobContext): Promise<void> {
  logger.info('Running invoice drafts sweep', { jobId: ctx.jobId })
  await sweepInvoiceDrafts()
  logger.info('Invoice drafts sweep finished', { jobId: ctx.jobId })
}
