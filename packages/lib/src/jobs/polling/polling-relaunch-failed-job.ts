// packages/lib/src/jobs/polling/polling-relaunch-failed-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq, inArray } from 'drizzle-orm'
import { resolveEffectiveSyncMode } from '../../providers/sync-mode-resolver'

const logger = createScopedLogger('job:polling-relaunch-failed')

const UNRECOVERABLE_AUTH_STATUSES = ['INVALID_GRANT', 'REVOKED_ACCESS', 'INSUFFICIENT_SCOPE']

export interface PollingRelaunchFailedJobData {
  maxRelaunches?: number
}

/**
 * Auto-recovery job that resets FAILED polling integrations.
 * Runs on schedule (default: every 30 min).
 */
export const pollingRelaunchFailedJob = async (job: Job<PollingRelaunchFailedJobData>) => {
  const now = new Date()

  logger.info('Starting polling relaunch failed job')

  // Find failed integrations that are eligible for relaunch
  const failedIntegrations = await db
    .select({
      id: schema.Integration.id,
      provider: schema.Integration.provider,
      syncMode: schema.Integration.syncMode,
      authStatus: schema.Integration.authStatus,
      throttleRetryAfter: schema.Integration.throttleRetryAfter,
    })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.enabled, true),
        eq(schema.Integration.syncStage, 'FAILED'),
        inArray(schema.Integration.provider, ['google', 'outlook'])
      )
    )

  let relaunchedCount = 0

  for (const integration of failedIntegrations) {
    // Only relaunch polling-mode integrations
    const effectiveMode = resolveEffectiveSyncMode({
      syncMode: integration.syncMode,
      provider: integration.provider,
    })

    if (effectiveMode !== 'polling') continue

    // Skip unrecoverable auth errors
    if (UNRECOVERABLE_AUTH_STATUSES.includes(integration.authStatus ?? '')) continue

    // Skip integrations still in backoff
    if (integration.throttleRetryAfter && integration.throttleRetryAfter > now) continue

    // Reset to MESSAGE_LIST_FETCH_PENDING
    await db
      .update(schema.Integration)
      .set({
        syncStage: 'MESSAGE_LIST_FETCH_PENDING',
        syncStatus: 'NOT_SYNCED',
        syncStageStartedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.Integration.id, integration.id))

    relaunchedCount++

    logger.info('Relaunched failed integration', {
      integrationId: integration.id,
      provider: integration.provider,
    })
  }

  logger.info('Polling relaunch failed job completed', {
    totalFailed: failedIntegrations.length,
    relaunched: relaunchedCount,
  })

  return { success: true, relaunched: relaunchedCount }
}
