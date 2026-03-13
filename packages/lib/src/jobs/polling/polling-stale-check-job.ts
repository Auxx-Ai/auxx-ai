// packages/lib/src/jobs/polling/polling-stale-check-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
import { getImportCacheSize, recoverProcessingBatch } from '../../email/polling-import-cache'
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
 *
 * For Gmail/Outlook: preserves the Redis import cache so recovered jobs
 * can resume importing rather than re-listing with an already-advanced cursor.
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
        lt(schema.Integration.syncStageStartedAt, staleThreshold),
        isNull(schema.Integration.deletedAt)
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

    // Recover any in-flight processing batch back to main cache
    const recovered = await recoverProcessingBatch(integration.id)
    if (recovered > 0) {
      logger.info('Recovered processing batch during stale check', {
        integrationId: integration.id,
        recoveredCount: recovered,
      })
    }

    // Check cache size to decide reset target
    const cacheSize = await getImportCacheSize(integration.id)

    // If cache has IDs, reset to MESSAGES_IMPORT_PENDING so they get imported
    // (cursor is already advanced, re-listing would miss these IDs)
    // If cache is empty, reset to MESSAGE_LIST_FETCH_PENDING to re-enter pipeline
    const resetStage = cacheSize > 0 ? 'MESSAGES_IMPORT_PENDING' : 'MESSAGE_LIST_FETCH_PENDING'

    logger.warn('Resetting stale integration', {
      integrationId: integration.id,
      syncStage: integration.syncStage,
      stuckDurationMs,
      stuckMinutes: Math.round(stuckDurationMs / 60000),
      cacheSize,
      resetStage,
    })

    await db
      .update(schema.Integration)
      .set({
        syncStage: resetStage,
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
    // Recover any in-flight processing batch
    const recovered = await recoverProcessingBatch(integrationId)
    if (recovered > 0) {
      logger.info('Recovered processing batch during IMAP resume', {
        integrationId,
        recoveredCount: recovered,
      })
    }

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
