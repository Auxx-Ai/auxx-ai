// packages/lib/src/jobs/maintenance/mail-counts-reconcile-job.ts

import { createScopedLogger } from '@auxx/logger'
import { computeAndSeedMailCounts } from '../../threads/mail-counts'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:mail-counts-reconcile')

export interface MailCountsReconcileJobData {
  organizationId: string
  userId: string
}

/**
 * On-demand full recount of one user's sidebar counters. Enqueued (deduped by
 * jobId) from stale `getCounts` reads, interactive mutations (acting-user fast
 * reconcile), and slow-path bulk operations. Overwrites the counter hash from
 * Postgres and pings the user's room so open tabs refetch.
 */
export const mailCountsReconcileJob = async (ctx: JobContext<MailCountsReconcileJobData>) => {
  const { organizationId, userId } = ctx.job.data

  await computeAndSeedMailCounts(organizationId, userId)

  const { getRealtimeService, publishCountsChanged } = await import('../../realtime')
  await publishCountsChanged(getRealtimeService(), userId)

  logger.debug('Mail counts reconciled', { organizationId, userId })
  return { success: true }
}
