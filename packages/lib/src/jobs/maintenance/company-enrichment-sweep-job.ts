// packages/lib/src/jobs/maintenance/company-enrichment-sweep-job.ts

import { createScopedLogger } from '@auxx/logger'
import { sweepCompaniesNeedingEnrichment } from '../../companies/enrichment/sweep'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('company-enrichment-sweep-job')

/**
 * Daily gap-filling sweep for company enrichment.
 *
 * Every other enrichment door is event-driven (record created, `company_domain` changed,
 * `company_website` changed, a manual click), so three populations have no path back:
 * companies created before enrichment had that door, companies the per-org window limiter
 * dropped during a large import, and companies stranded on `pending` by a worker that died
 * mid-fetch. This is their only path.
 *
 * Scheduled nightly via `upsertJobScheduler` — see `apps/worker/src/workers/index.ts`.
 * Idempotent: it selects only non-terminal records, and every record it enqueues reaches a
 * terminal status (including `skipped` for the ones with no domain and no website), so a
 * re-run after a failure re-selects strictly less.
 */
export async function companyEnrichmentSweepJob(ctx: JobContext): Promise<void> {
  logger.info('Running company enrichment sweep', { jobId: ctx.jobId })
  const summary = await sweepCompaniesNeedingEnrichment()
  logger.info('Company enrichment sweep finished', { jobId: ctx.jobId, ...summary })
}
