// packages/lib/src/jobs/polling/message-list-fetch-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { MessageStorageService } from '../../email/email-storage'
import { FolderDiscoveryService } from '../../email/labels/folder-discovery-service'
import {
  addToImportCache,
  getImportCacheSize,
  recoverProcessingBatch,
} from '../../email/polling-import-cache'
import type { ImapImportBatchJobData } from '../../providers/imap/types'
import { ProviderRegistryService } from '../../providers/provider-registry-service'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'

const logger = createScopedLogger('job:message-list-fetch')

/** Max backoff for sync throttle: 1 hour */
const MAX_THROTTLE_BACKOFF_MS = 3_600_000
/** Base backoff for sync throttle: 30 seconds */
const BASE_THROTTLE_BACKOFF_MS = 30_000

export interface MessageListFetchJobData {
  integrationId: string
  organizationId: string
  provider: string
  isWindowedScanContinuation?: boolean
}

/**
 * Phase 1: Discover message IDs from the provider.
 * Sets syncStage to MESSAGE_LIST_FETCH during execution,
 * then transitions to MESSAGES_IMPORT_PENDING or back to IDLE.
 *
 * For IMAP full sync: uses windowed UID scanning with checkpoints and
 * enqueues self-contained import batches instead of Redis cache.
 */
export const messageListFetchJob = async (jobOrCtx: Job<MessageListFetchJobData>) => {
  // createJobHandler passes a JobContext; extract the real BullMQ Job
  const job: Job<MessageListFetchJobData> = (jobOrCtx as any).job ?? jobOrCtx
  const signal = (jobOrCtx as any).signal as AbortSignal | undefined

  const { integrationId, organizationId, provider } = job.data
  const now = new Date()

  logger.info('Starting message list fetch', { integrationId, organizationId, provider })

  try {
    // Set stage to MESSAGE_LIST_FETCH
    await db
      .update(schema.Integration)
      .set({
        syncStage: 'MESSAGE_LIST_FETCH',
        syncStatus: 'SYNCING',
        syncStageStartedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.Integration.id, integrationId))

    // Initialize provider
    const registry = new ProviderRegistryService(organizationId)
    const providerInstance = await registry.getProvider(integrationId)

    // Check if provider supports two-phase sync
    if (providerInstance.supportsTwoPhaseSync?.()) {
      // --- Label sync (skip on windowed scan continuations — folders already discovered) ---
      if (!job.data.isWindowedScanContinuation && providerInstance.discoverLabels) {
        const discoveredLabels = await providerInstance.discoverLabels()
        const folderDiscovery = new FolderDiscoveryService()
        await folderDiscovery.discoverAndUpsert({
          integrationId,
          organizationId,
          provider,
          discoveredFolders: discoveredLabels,
        })
      }

      // --- IMAP windowed full sync ---
      if (provider === 'imap') {
        await handleImapListFetch(providerInstance, integrationId, organizationId, now)
        return
      }

      // --- Standard two-phase sync (Gmail, Outlook) ---
      const results = await providerInstance.fetchMessageIds!()
      let totalMessageIds = 0
      const storageService = new MessageStorageService(organizationId)

      for (const result of results) {
        // Process deletions immediately (updates thread metadata, removes empty threads)
        if (result.deletedMessageIds.length > 0) {
          const deletedCount = await storageService.deleteMessagesByExternalIds(
            integrationId,
            result.deletedMessageIds
          )
          logger.info('Processed message deletions', {
            integrationId,
            requested: result.deletedMessageIds.length,
            deleted: deletedCount,
          })
        }

        // Cache message IDs for import phase
        if (result.messageIds.length > 0) {
          await addToImportCache(integrationId, result.messageIds)
          totalMessageIds += result.messageIds.length
        }

        // Update cursor
        if (result.labelId) {
          // Per-label cursor (Outlook/IMAP) — update Label.providerCursor
          await db
            .update(schema.Label)
            .set({ providerCursor: result.nextCursor, updatedAt: now })
            .where(eq(schema.Label.id, result.labelId))
        } else {
          // Integration-level cursor (Gmail) — update Integration.lastHistoryId
          if (result.nextCursor && result.nextCursor !== '0') {
            await db
              .update(schema.Integration)
              .set({ lastHistoryId: result.nextCursor, updatedAt: now })
              .where(eq(schema.Integration.id, integrationId))
          }
        }
      }

      // Transition stage
      if (totalMessageIds > 0) {
        await db
          .update(schema.Integration)
          .set({
            syncStage: 'MESSAGES_IMPORT_PENDING',
            lastSyncedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.Integration.id, integrationId))

        logger.info('Message list fetch complete, transitioning to import', {
          integrationId,
          totalMessageIds,
        })
      } else {
        await db
          .update(schema.Integration)
          .set({
            syncStage: 'IDLE',
            syncStatus: 'ACTIVE',
            syncStageStartedAt: null,
            lastSyncedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.Integration.id, integrationId))

        logger.info('Message list fetch complete, no new messages', { integrationId })
      }
    } else {
      // Fallback: single-phase sync via syncMessages()
      await providerInstance.syncMessages()

      await db
        .update(schema.Integration)
        .set({
          syncStage: 'IDLE',
          syncStatus: 'ACTIVE',
          syncStageStartedAt: null,
          throttleFailureCount: 0,
          throttleRetryAfter: null,
          lastSyncedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.Integration.id, integrationId))

      logger.info('Single-phase sync completed (fallback)', { integrationId })
    }
  } catch (error: any) {
    logger.error('Message list fetch failed', {
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
        .where(and(eq(schema.Integration.id, integrationId), isNull(schema.Integration.deletedAt)))
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
 * Handle IMAP list fetch with windowed full sync and incremental sync.
 * - Incremental sync (labels with committed cursors): uses standard two-phase via Redis cache.
 * - Full sync (labels without cursors): uses windowed UID scanning with checkpoints.
 */
async function handleImapListFetch(
  providerInstance: any,
  integrationId: string,
  organizationId: string,
  now: Date
): Promise<void> {
  const { ImapGetMessageListService } = await import('../../providers/imap/imap-get-message-list')
  const messageListService = new ImapGetMessageListService()

  const storageService = new MessageStorageService(organizationId)
  let totalIncrementalIds = 0
  let totalFullSyncBatches = 0

  // 1. Handle incremental sync for labels with cursors
  const incrementalResults = await providerInstance.fetchMessageIds!()

  for (const result of incrementalResults) {
    if (result.deletedMessageIds.length > 0) {
      await storageService.deleteMessagesByExternalIds(integrationId, result.deletedMessageIds)
    }

    if (result.messageIds.length > 0) {
      await addToImportCache(integrationId, result.messageIds)
      totalIncrementalIds += result.messageIds.length
    }

    // Safe to commit cursor for incremental sync immediately
    if (result.labelId) {
      await db
        .update(schema.Label)
        .set({ providerCursor: result.nextCursor, updatedAt: now })
        .where(eq(schema.Label.id, result.labelId))
    }
  }

  // 2. Handle windowed full sync for labels without cursors
  const windowedResults = await messageListService.getWindowedFullSyncResults({
    credentials: providerInstance.getCredentials(),
    integrationId,
    organizationId,
  })

  const pollingSyncQueue = getQueue(Queues.pollingSyncQueue)

  for (const windowResult of windowedResults) {
    // Persist the checkpoint before enqueuing import jobs
    await db
      .update(schema.Label)
      .set({
        syncCheckpoint: JSON.stringify(windowResult.checkpoint),
        updatedAt: now,
      })
      .where(eq(schema.Label.id, windowResult.labelId))

    // Enqueue self-contained import batch jobs
    for (const batch of windowResult.batches) {
      const batchJobData: ImapImportBatchJobData = {
        runId: windowResult.checkpoint.runId,
        integrationId,
        organizationId,
        provider: 'imap',
        labelId: windowResult.labelId,
        folderPath: windowResult.folderPath,
        externalIds: batch,
      }

      await pollingSyncQueue.add('imapImportBatchJob', batchJobData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      })

      totalFullSyncBatches++
    }
  }

  // 3. Determine transition
  const hasFullSyncWork = windowedResults.some((r) => r.batches.length > 0)
  const hasFullSyncPending = windowedResults.some((r) => !r.folderScanComplete)

  if (totalIncrementalIds > 0 || hasFullSyncWork) {
    await db
      .update(schema.Integration)
      .set({
        syncStage: 'MESSAGES_IMPORT_PENDING',
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.Integration.id, integrationId))

    logger.info('IMAP list fetch complete, transitioning to import', {
      integrationId,
      totalIncrementalIds,
      totalFullSyncBatches,
      foldersWithPendingWindows: windowedResults.filter((r) => !r.folderScanComplete).length,
    })
  } else if (hasFullSyncPending) {
    // All windows were empty but there are more windows to scan — re-enqueue list fetch
    await pollingSyncQueue.add(
      'messageListFetchJob',
      { integrationId, organizationId, provider: 'imap', isWindowedScanContinuation: true },
      {
        jobId: `poll-list-fetch-${integrationId}-${Date.now()}`,
        delay: 1000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      }
    )

    logger.info('IMAP list fetch found empty windows, re-enqueuing for next window', {
      integrationId,
    })
  } else {
    // All folders fully scanned and no work — check if all checkpoints are done
    const allDone = windowedResults.every((r) => r.folderScanComplete && r.batches.length === 0)

    if (allDone && totalIncrementalIds === 0) {
      // Commit cursors for completed full-sync folders
      for (const windowResult of windowedResults) {
        if (windowResult.checkpoint.phase === 'done') {
          await commitFolderCursor(windowResult.labelId, windowResult.checkpoint, now)
        }
      }

      await db
        .update(schema.Integration)
        .set({
          syncStage: 'IDLE',
          syncStatus: 'ACTIVE',
          syncStageStartedAt: null,
          lastSyncedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.Integration.id, integrationId))

      logger.info('IMAP list fetch complete, all folders synced, transitioning to IDLE', {
        integrationId,
      })
    }
  }
}

/**
 * Commit the providerCursor for a folder after successful full sync completion.
 * Only called when all batches imported with zero failures.
 */
export async function commitFolderCursor(
  labelId: string,
  checkpoint: { candidateCursor: string; failedMessageCount: number },
  now: Date
): Promise<void> {
  if (checkpoint.failedMessageCount > 0) {
    logger.warn('Cannot commit folder cursor — failed messages remain', {
      labelId,
      failedMessageCount: checkpoint.failedMessageCount,
    })
    return
  }

  const [uidValidityStr, highestUidStr] = checkpoint.candidateCursor.split(':')
  const cursorJson = JSON.stringify({
    uidValidity: Number(uidValidityStr),
    highestUid: Number(highestUidStr),
  })

  await db
    .update(schema.Label)
    .set({
      providerCursor: cursorJson,
      syncCheckpoint: null,
      updatedAt: now,
    })
    .where(eq(schema.Label.id, labelId))

  logger.info('Committed folder cursor after full sync', {
    labelId,
    cursor: cursorJson,
  })
}
