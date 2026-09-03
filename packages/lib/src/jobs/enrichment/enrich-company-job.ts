// packages/lib/src/jobs/enrichment/enrich-company-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { EnrichCompanyJobData } from '../../companies'
import { enrichCompany } from '../../companies'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('enrich-company-job')

/**
 * Enrich one company from its website.
 *
 * ⚠️ NEVER THROWS. `enrichCompany` represents every failure as a terminal status on the
 * record, so a throw here would only earn the job a BullMQ retry — and a retried website
 * fetch is precisely the repeat traffic the guards exist to prevent. The catch is the
 * belt to that braces.
 */
export async function enrichCompanyJob(ctx: JobContext<EnrichCompanyJobData>): Promise<void> {
  const { organizationId, companyInstanceId, reason } = ctx.data

  try {
    const result = await enrichCompany({ organizationId, companyInstanceId, reason })
    logger.debug('Enrichment job finished', {
      jobId: ctx.jobId,
      organizationId,
      companyId: companyInstanceId,
      reason,
      ...result,
    })
  } catch (error) {
    logger.error('Enrichment job threw', {
      jobId: ctx.jobId,
      organizationId,
      companyId: companyInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
