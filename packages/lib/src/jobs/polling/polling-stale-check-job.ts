// packages/lib/src/jobs/polling/polling-stale-check-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import { clearImportCache } from '../../email/polling-import-cache'

const logger = createScopedLogger('job:polling-stale-check')

const DEFAULT_STALE_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes

export interface PollingStaleCheckJobData {
  staleThresholdMs?: number
}

/**
 * Self-healing job that resets integrations stuck in an active stage.
 * Runs on schedule (default: every 15 min).
 */
export const pollingStaleCheckJob = async (job: Job<PollingStaleCheckJobData>) => {
  const { staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS } = job.data
  const now = new Date()
  const staleThreshold = new Date(now.getTime() - staleThresholdMs)

  logger.info('Starting polling stale check', {
    staleThresholdMs,
    staleThreshold: staleThreshold.toISOString(),
  })

  // Find integrations stuck in active stages
  const staleIntegrations = await db
    .select({
      id: schema.Integration.id,
      syncStage: schema.Integration.syncStage,
      syncStageStartedAt: schema.Integration.syncStageStartedAt,
    })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.enabled, true),
        inArray(schema.Integration.syncStage, ['MESSAGE_LIST_FETCH', 'MESSAGES_IMPORT']),
        isNotNull(schema.Integration.syncStageStartedAt),
        lt(schema.Integration.syncStageStartedAt, staleThreshold)
      )
    )

  if (staleIntegrations.length === 0) {
    logger.info('No stale integrations found')
    return { success: true, resetCount: 0 }
  }

  let resetCount = 0

  for (const integration of staleIntegrations) {
    const stuckDurationMs = now.getTime() - (integration.syncStageStartedAt?.getTime() ?? 0)

    logger.warn('Resetting stale integration', {
      integrationId: integration.id,
      syncStage: integration.syncStage,
      stuckDurationMs,
      stuckMinutes: Math.round(stuckDurationMs / 60000),
    })

    // Clear Redis import cache (may contain partial/stale data)
    await clearImportCache(integration.id)

    // Reset to MESSAGE_LIST_FETCH_PENDING (re-enter pipeline from the top)
    await db
      .update(schema.Integration)
      .set({
        syncStage: 'MESSAGE_LIST_FETCH_PENDING',
        syncStageStartedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.Integration.id, integration.id))

    resetCount++
  }

  logger.info('Polling stale check completed', { resetCount })
  return { success: true, resetCount }
}
