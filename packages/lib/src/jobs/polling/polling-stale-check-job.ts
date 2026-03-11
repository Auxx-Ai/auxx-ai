// packages/lib/src/jobs/polling/polling-stale-check-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import { clearImportCache } from '../../email/polling-import-cache'
import type { ImapFolderCheckpoint } from '../../providers/imap/types'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'

const logger = createScopedLogger('job:polling-stale-check')

const DEFAULT_STALE_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes

export interface PollingStaleCheckJobData {
  staleThresholdMs?: number
}

/**
 * Self-healing job that resets integrations stuck in an active stage.
 * Runs on schedule (default: every 15 min).
 *
 * For IMAP integrations with checkpoints, resumes from checkpoint state
 * instead of clearing all work.
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
      organizationId: schema.Integration.organizationId,
      provider: schema.Integration.provider,
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
    return { success: true, resetCount: 0, resumedCount: 0 }
  }

  let resetCount = 0
  let resumedCount = 0

  for (const integration of staleIntegrations) {
    const stuckDurationMs = now.getTime() - (integration.syncStageStartedAt?.getTime() ?? 0)

    // IMAP: attempt checkpoint-based resumption
    if (integration.provider === 'imap') {
      const resumed = await resumeImapFromCheckpoints(
        integration.id,
        integration.organizationId,
        now
      )

      if (resumed) {
        resumedCount++
        logger.info('Resumed stale IMAP integration from checkpoints', {
          integrationId: integration.id,
          stuckDurationMs,
        })
        continue
      }
    }

    // Non-IMAP or no checkpoints: standard reset
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

  logger.info('Polling stale check completed', { resetCount, resumedCount })
  return { success: true, resetCount, resumedCount }
}

/**
 * Resume an IMAP integration from its folder checkpoints.
 * Returns true if resumption was possible.
 */
async function resumeImapFromCheckpoints(
  integrationId: string,
  organizationId: string,
  now: Date
): Promise<boolean> {
  const labels = await db
    .select({
      id: schema.Label.id,
      labelId: schema.Label.labelId,
      syncCheckpoint: schema.Label.syncCheckpoint,
    })
    .from(schema.Label)
    .where(and(eq(schema.Label.integrationId, integrationId), eq(schema.Label.enabled, true)))

  const labelsWithCheckpoints = labels.filter((l) => l.syncCheckpoint !== null)

  if (labelsWithCheckpoints.length === 0) {
    return false
  }

  const pollingSyncQueue = getQueue(Queues.pollingSyncQueue)
  let resumedAny = false

  for (const label of labelsWithCheckpoints) {
    if (!label.syncCheckpoint) continue

    const checkpoint: ImapFolderCheckpoint = JSON.parse(label.syncCheckpoint)

    // Skip completed checkpoints
    if (checkpoint.phase === 'done') continue

    if (
      checkpoint.phase === 'importing' &&
      checkpoint.activeWindowStart !== undefined &&
      checkpoint.activeWindowEnd !== undefined
    ) {
      // Active window was in progress but jobs may have disappeared.
      // Replay the active window by re-scanning and re-enqueuing batches.
      // Reset batch counts so the window is fully replayed.
      checkpoint.activeWindowCompletedBatches = 0
      checkpoint.activeWindowFailedBatches = 0
      checkpoint.phase = 'listing'
      checkpoint.activeWindowStart = undefined
      checkpoint.activeWindowEnd = undefined
      checkpoint.activeWindowBatchCount = undefined

      // Don't advance nextUidStart — replay from where we were
      await db
        .update(schema.Label)
        .set({ syncCheckpoint: JSON.stringify(checkpoint), updatedAt: now })
        .where(eq(schema.Label.id, label.id))

      resumedAny = true

      logger.info('Reset active window for replay', {
        labelId: label.id,
        folderPath: label.labelId,
        nextUidStart: checkpoint.nextUidStart,
      })
    } else if (checkpoint.phase === 'listing') {
      // Was in listing phase — just re-enqueue list fetch
      resumedAny = true
    }
  }

  if (resumedAny) {
    // Re-enqueue list fetch job to continue from checkpoints
    await pollingSyncQueue.add(
      'messageListFetchJob',
      { integrationId, organizationId, provider: 'imap' },
      {
        jobId: `poll-list-fetch-${integrationId}-resume-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      }
    )

    // Reset integration stage to allow scanner to pick it up
    await db
      .update(schema.Integration)
      .set({
        syncStage: 'MESSAGE_LIST_FETCH_PENDING',
        syncStageStartedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.Integration.id, integrationId))
  }

  return resumedAny
}
