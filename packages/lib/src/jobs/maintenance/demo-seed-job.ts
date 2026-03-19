// packages/lib/src/jobs/maintenance/demo-seed-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'

const logger = createScopedLogger('demo-seed')

export interface DemoSeedJobData {
  organizationId: string
  userId: string
  userEmail: string
}

/**
 * Stub handler — the real implementation lives in the worker where @auxx/seed is available.
 * See: apps/worker/src/workers/worker-definitions/maintenance-worker.ts
 */
export const demoSeedJob = async (job: Job<DemoSeedJobData>) => {
  logger.warn('demoSeedJob stub called — must be overridden by the worker', {
    organizationId: job.data.organizationId,
  })
  throw new Error('demoSeedJob must be overridden by the worker')
}
