// packages/lib/src/jobs/maintenance/org-seed-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'

const logger = createScopedLogger('org-seed')

/** OrgSeedScenario names the scenarios orgSeedJob can dispatch. */
export type OrgSeedScenario = 'demo' | 'example'

/** OrgSeedJobData is the unified payload for demo + example seeding. */
export interface OrgSeedJobData {
  organizationId: string
  userId: string
  userEmail?: string
  scenario: OrgSeedScenario
}

/**
 * Stub handler — the real implementation lives in the worker where @auxx/seed is available.
 * See: apps/worker/src/workers/worker-definitions/maintenance-worker.ts
 */
export const orgSeedJob = async (job: Job<OrgSeedJobData>) => {
  logger.warn('orgSeedJob stub called — must be overridden by the worker', {
    organizationId: job.data.organizationId,
    scenario: job.data.scenario,
  })
  throw new Error('orgSeedJob must be overridden by the worker')
}
