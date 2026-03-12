// packages/lib/src/jobs/polling/messages-import-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq, inArray } from 'drizzle-orm'
import {
  acknowledgeImportBatch,
  claimImportBatch,
  getImportCacheSize,
  recoverProcessingBatch,
} from '../../email/polling-import-cache'
import type { ImapFolderCheckpoint, ImapImportBatchJobData } from '../../providers/imap/types'
import {
  DEFAULT_IMPORT_BATCH_SIZE,
  PROVIDER_IMPORT_BATCH_SIZE,
} from '../../providers/integration-provider.interface'
import { ProviderRegistryService } from '../../providers/provider-registry-service'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'

const logger = createScopedLogger('job:messages-import')

/** Max backoff for sync throttle: 1 hour */
const MAX_THROTTLE_BACKOFF_MS = 3_600_000
/** Base backoff for sync throttle: 30 seconds */
const BASE_THROTTLE_BACKOFF_MS = 30_000

export interface MessagesImportJobData {
  integrationId: string
  organizationId: string
  provider: string
  batchSize?: number
}

/**
 * Phase 2: Fetch message content by external IDs from Redis cache.
 * Claims a batch (two-phase), imports via provider, then acknowledges.
 */
export const messagesImportJob = async (job: Job<MessagesImportJobData>) => {
  const { integrationId, organizationId, provider } = job.data
  const batchSize =
    job.data.batchSize ?? PROVIDER_IMPORT_BATCH_SIZE[provider] ?? DEFAULT_IMPORT_BATCH_SIZE
  const now = new Date()

  // Extract signal from JobContext (passed via createJobHandler)
  const signal = (job as any).signal as AbortSignal | undefined

  logger.info('Starting messages import', { integrationId, organizationId, batchSize })

  let claimedIds: string[] = []

  try {
    // Set stage to MESSAGES_IMPORT
    await db
      .update(schema.Integration)
      .set({
        syncStage: 'MESSAGES_IMPORT',
        syncStageStartedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.Integration.id, integrationId))

    // Claim batch from Redis cache (two-phase: main → processing set)
    claimedIds = await claimImportBatch(integrationId, batchSize)

    if (claimedIds.length === 0) {
      // No IDs remaining — done
      await db
        .update(schema.Integration)
        .set({
          syncStage: 'IDLE',
          syncStatus: 'ACTIVE',
          syncStageStartedAt: null,
          throttleFailureCount: 0,
          throttleRetryAfter: null,
          lastSyncedAt: now,
          lastSuccessfulSync: now,
          updatedAt: now,
        })
        .where(eq(schema.Integration.id, integrationId))

      logger.info('No IDs remaining in import cache, transitioning to IDLE', { integrationId })
      return
    }

    // Initialize provider and import
    const registry = new ProviderRegistryService(organizationId)
    const providerInstance = await registry.getProvider(integrationId)

    if (!providerInstance.importMessages) {
      logger.error('Provider does not support importMessages', { integrationId, provider })
      throw new Error(`Provider ${provider} does not support importMessages`)
    }

    const result = await providerInstance.importMessages(claimedIds)

    // Acknowledge successful import — remove from processing set
    await acknowledgeImportBatch(integrationId, claimedIds)

    logger.info('Import batch completed', {
      integrationId,
      imported: result.imported,
      failed: result.failed,
      batchSize: claimedIds.length,
    })

    // Check remaining cache size
    const remaining = await getImportCacheSize(integrationId)

    if (remaining > 0) {
      // More IDs to import — transition back to MESSAGES_IMPORT_PENDING
      await db
        .update(schema.Integration)
        .set({
          syncStage: 'MESSAGES_IMPORT_PENDING',
          lastSyncedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.Integration.id, integrationId))

      logger.info('More IDs in cache, transitioning to MESSAGES_IMPORT_PENDING', {
        integrationId,
        remaining,
      })
    } else {
      // All done
      await db
        .update(schema.Integration)
        .set({
          syncStage: 'IDLE',
          syncStatus: 'ACTIVE',
          syncStageStartedAt: null,
          throttleFailureCount: 0,
          throttleRetryAfter: null,
          lastSyncedAt: now,
          lastSuccessfulSync: now,
          updatedAt: now,
        })
        .where(eq(schema.Integration.id, integrationId))

      logger.info('All IDs imported, transitioning to IDLE', { integrationId })
    }
  } catch (error: any) {
    logger.error('Messages import failed', {
      integrationId,
      error: error.message,
    })

    // Apply throttle on final attempt
    const maxAttempts = job.opts.attempts ?? 1
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts

    if (isFinalAttempt) {
      const [integration] = await db
        .select({ throttleFailureCount: schema.Integration.throttleFailureCount })
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      const newCount = (integration?.throttleFailureCount ?? 0) + 1
      const backoffMs = Math.min(
        BASE_THROTTLE_BACKOFF_MS * 2 ** (newCount - 1),
        MAX_THROTTLE_BACKOFF_MS
      )

      await db
        .update(schema.Integration)
        .set({
          syncStage: 'FAILED',
          syncStatus: 'FAILED',
          syncStageStartedAt: null,
          throttleFailureCount: newCount,
          throttleRetryAfter: new Date(Date.now() + backoffMs),
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integrationId))
    } else {
      // Non-final attempt: reset stale timer so BullMQ retries get a fresh window
      await db
        .update(schema.Integration)
        .set({ syncStageStartedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.Integration.id, integrationId))
    }

    throw error
  } finally {
    // Phase 2: Signal-based recovery for lock loss / cancellation
    if (signal?.aborted) {
      const recovered = await recoverProcessingBatch(integrationId)
      if (recovered > 0) {
        logger.warn('Recovered processing batch after cancellation', {
          integrationId,
          recoveredCount: recovered,
        })
      }

      const cacheSize = await getImportCacheSize(integrationId)
      const resetStage = cacheSize > 0 ? 'MESSAGES_IMPORT_PENDING' : 'MESSAGE_LIST_FETCH_PENDING'

      await db
        .update(schema.Integration)
        .set({ syncStage: resetStage, syncStageStartedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.Integration.id, integrationId),
            inArray(schema.Integration.syncStage, ['MESSAGE_LIST_FETCH', 'MESSAGES_IMPORT'])
          )
        )

      logger.info('Reset integration after signal abort', {
        integrationId,
        resetStage,
        cacheSize,
      })
    }
  }
}

/**
 * IMAP-specific import batch job: imports explicit externalIds from job payload
 * (not from Redis cache). Updates the folder checkpoint on completion.
 * When all batches for the active window complete, triggers the next list fetch.
 */
export const imapImportBatchJob = async (job: Job<ImapImportBatchJobData>) => {
  const { runId, integrationId, organizationId, labelId, folderPath, externalIds } = job.data
  const now = new Date()

  logger.info('Starting IMAP import batch', {
    integrationId,
    labelId,
    folderPath,
    runId,
    batchSize: externalIds.length,
  })

  try {
    // Initialize provider and import
    const registry = new ProviderRegistryService(organizationId)
    const providerInstance = await registry.getProvider(integrationId)

    if (!providerInstance.importMessages) {
      throw new Error('IMAP provider does not support importMessages')
    }

    const result = await providerInstance.importMessages(externalIds)

    logger.info('IMAP import batch completed', {
      integrationId,
      labelId,
      folderPath,
      imported: result.imported,
      failed: result.failed,
    })

    // Update checkpoint atomically
    const [label] = await db
      .select({
        syncCheckpoint: schema.Label.syncCheckpoint,
      })
      .from(schema.Label)
      .where(eq(schema.Label.id, labelId))
      .limit(1)

    if (!label?.syncCheckpoint) {
      logger.warn('No checkpoint found for label, batch orphaned', { labelId, runId })
      return
    }

    const checkpoint: ImapFolderCheckpoint = JSON.parse(label.syncCheckpoint)

    // Validate runId — ignore batches from stale runs
    if (checkpoint.runId !== runId) {
      logger.warn('Batch runId mismatch, ignoring stale batch', {
        labelId,
        batchRunId: runId,
        checkpointRunId: checkpoint.runId,
      })
      return
    }

    // Update batch counts
    checkpoint.importedMessageCount += result.imported
    checkpoint.failedMessageCount += result.failed
    checkpoint.activeWindowCompletedBatches = (checkpoint.activeWindowCompletedBatches ?? 0) + 1

    if (result.failed > 0) {
      checkpoint.activeWindowFailedBatches = (checkpoint.activeWindowFailedBatches ?? 0) + 1
    }

    const totalWindowBatches = checkpoint.activeWindowBatchCount ?? 0
    const completedWindowBatches = checkpoint.activeWindowCompletedBatches ?? 0
    const windowDrained = completedWindowBatches >= totalWindowBatches

    if (windowDrained) {
      const windowEnd = checkpoint.activeWindowEnd ?? 0
      const folderScanComplete = windowEnd >= checkpoint.snapshotHighestUid

      if (folderScanComplete && checkpoint.failedMessageCount === 0) {
        // All UIDs scanned, all batches imported successfully — commit cursor
        checkpoint.phase = 'done'
        checkpoint.activeWindowStart = undefined
        checkpoint.activeWindowEnd = undefined
        checkpoint.activeWindowBatchCount = undefined
        checkpoint.activeWindowCompletedBatches = undefined
        checkpoint.activeWindowFailedBatches = undefined

        // Commit cursor and clear checkpoint
        const { commitFolderCursor } = await import('./message-list-fetch-job')
        await commitFolderCursor(labelId, checkpoint, now)

        logger.info('IMAP folder full sync complete, cursor committed', {
          labelId,
          folderPath,
          runId,
          importedMessageCount: checkpoint.importedMessageCount,
        })
      } else if (folderScanComplete && checkpoint.failedMessageCount > 0) {
        // Scan complete but has failures — leave checkpoint for retry
        checkpoint.phase = 'importing'
        checkpoint.lastError = `${checkpoint.failedMessageCount} messages failed to import`
        checkpoint.activeWindowStart = undefined
        checkpoint.activeWindowEnd = undefined
        checkpoint.activeWindowBatchCount = undefined
        checkpoint.activeWindowCompletedBatches = undefined
        checkpoint.activeWindowFailedBatches = undefined

        await db
          .update(schema.Label)
          .set({ syncCheckpoint: JSON.stringify(checkpoint), updatedAt: now })
          .where(eq(schema.Label.id, labelId))

        logger.warn('IMAP folder scan complete but has failures, cursor NOT committed', {
          labelId,
          folderPath,
          failedMessageCount: checkpoint.failedMessageCount,
        })
      } else {
        // More windows to scan — advance nextUidStart and trigger next list job
        checkpoint.phase = 'listing'
        checkpoint.nextUidStart = (checkpoint.activeWindowEnd ?? 0) + 1
        checkpoint.activeWindowStart = undefined
        checkpoint.activeWindowEnd = undefined
        checkpoint.activeWindowBatchCount = undefined
        checkpoint.activeWindowCompletedBatches = undefined
        checkpoint.activeWindowFailedBatches = undefined

        await db
          .update(schema.Label)
          .set({ syncCheckpoint: JSON.stringify(checkpoint), updatedAt: now })
          .where(eq(schema.Label.id, labelId))

        // Re-enqueue list fetch for next window
        const pollingSyncQueue = getQueue(Queues.pollingSyncQueue)
        await pollingSyncQueue.add(
          'messageListFetchJob',
          { integrationId, organizationId, provider: 'imap' },
          {
            jobId: `poll-list-fetch-${integrationId}-${Date.now()}`,
            delay: 1000,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60000 },
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 100 },
          }
        )

        logger.info('IMAP window drained, enqueued next list fetch', {
          labelId,
          folderPath,
          nextUidStart: checkpoint.nextUidStart,
        })
      }
    } else {
      // Window not fully drained yet — just persist updated counts
      await db
        .update(schema.Label)
        .set({ syncCheckpoint: JSON.stringify(checkpoint), updatedAt: now })
        .where(eq(schema.Label.id, labelId))
    }

    // Check if all IMAP full-sync folders are done and transition integration to IDLE
    await maybeTransitionImapToIdle(integrationId, now)
  } catch (error: any) {
    logger.error('IMAP import batch failed', {
      integrationId,
      labelId,
      folderPath,
      runId,
      error: error.message,
    })

    // Phase 5: Apply throttle on final attempt for IMAP batch jobs
    const maxAttempts = job.opts.attempts ?? 1
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts

    if (isFinalAttempt) {
      const [integration] = await db
        .select({ throttleFailureCount: schema.Integration.throttleFailureCount })
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      const newCount = (integration?.throttleFailureCount ?? 0) + 1
      const backoffMs = Math.min(
        BASE_THROTTLE_BACKOFF_MS * 2 ** (newCount - 1),
        MAX_THROTTLE_BACKOFF_MS
      )

      await db
        .update(schema.Integration)
        .set({
          syncStage: 'FAILED',
          syncStatus: 'FAILED',
          syncStageStartedAt: null,
          throttleFailureCount: newCount,
          throttleRetryAfter: new Date(Date.now() + backoffMs),
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integrationId))

      logger.warn('IMAP batch final attempt failed, throttling integration', {
        integrationId,
        labelId,
        newCount,
        backoffMs,
      })
    }

    throw error
  }
}

/**
 * Check if all IMAP folders have completed full sync (no active checkpoints).
 * If so, transition the integration back to IDLE.
 */
async function maybeTransitionImapToIdle(integrationId: string, now: Date): Promise<void> {
  const labels = await db
    .select({ syncCheckpoint: schema.Label.syncCheckpoint })
    .from(schema.Label)
    .where(and(eq(schema.Label.integrationId, integrationId), eq(schema.Label.enabled, true)))

  const hasActiveCheckpoints = labels.some((l) => {
    if (!l.syncCheckpoint) return false
    const cp: ImapFolderCheckpoint = JSON.parse(l.syncCheckpoint)
    return cp.phase !== 'done'
  })

  if (!hasActiveCheckpoints) {
    // Check if there's still incremental work in the Redis cache
    const remaining = await getImportCacheSize(integrationId)

    if (remaining > 0) {
      // Still have incremental imports — let messagesImportJob handle transition
      return
    }

    await db
      .update(schema.Integration)
      .set({
        syncStage: 'IDLE',
        syncStatus: 'ACTIVE',
        syncStageStartedAt: null,
        throttleFailureCount: 0,
        throttleRetryAfter: null,
        lastSyncedAt: now,
        lastSuccessfulSync: now,
        updatedAt: now,
      })
      .where(eq(schema.Integration.id, integrationId))

    logger.info('All IMAP folders synced, transitioning to IDLE', { integrationId })
  }
}
