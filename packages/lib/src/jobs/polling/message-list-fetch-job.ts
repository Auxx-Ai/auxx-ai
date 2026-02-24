// packages/lib/src/jobs/polling/message-list-fetch-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { MessageStorageService } from '../../email/email-storage'
import { addToImportCache } from '../../email/polling-import-cache'
import { ProviderRegistryService } from '../../providers/provider-registry-service'

const logger = createScopedLogger('job:message-list-fetch')

/** Max backoff for sync throttle: 1 hour */
const MAX_THROTTLE_BACKOFF_MS = 3_600_000
/** Base backoff for sync throttle: 30 seconds */
const BASE_THROTTLE_BACKOFF_MS = 30_000

export interface MessageListFetchJobData {
  integrationId: string
  organizationId: string
  provider: string
}

/**
 * Phase 1: Discover message IDs from the provider.
 * Sets syncStage to MESSAGE_LIST_FETCH during execution,
 * then transitions to MESSAGES_IMPORT_PENDING or back to IDLE.
 */
export const messageListFetchJob = async (job: Job<MessageListFetchJobData>) => {
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
      // --- Label sync ---
      if (providerInstance.discoverLabels) {
        const discoveredLabels = await providerInstance.discoverLabels()

        if (discoveredLabels.length > 0) {
          // Upsert labels
          for (const label of discoveredLabels) {
            const existing = await db
              .select()
              .from(schema.Label)
              .where(
                and(
                  eq(schema.Label.labelId, label.externalId),
                  eq(schema.Label.integrationId, integrationId),
                  eq(schema.Label.organizationId, organizationId)
                )
              )
              .limit(1)

            if (existing.length > 0) {
              // Update existing label
              await db
                .update(schema.Label)
                .set({
                  name: label.name,
                  isSentBox: label.isSentBox,
                  parentLabelId: null, // Will be resolved after all labels are upserted
                  pendingAction: null, // Clear any pending removal
                  updatedAt: now,
                })
                .where(eq(schema.Label.id, existing[0].id))
            } else {
              await db.insert(schema.Label).values({
                labelId: label.externalId,
                name: label.name,
                integrationId,
                integrationType: provider.toUpperCase(),
                organizationId,
                type: 'system',
                enabled: true,
                isVisible: true,
                isSentBox: label.isSentBox,
                updatedAt: now,
              })
            }
          }

          // Mark labels not in discovered set as PENDING_REMOVAL
          const discoveredExternalIds = discoveredLabels.map((l) => l.externalId)
          const allLabels = await db
            .select()
            .from(schema.Label)
            .where(
              and(
                eq(schema.Label.integrationId, integrationId),
                eq(schema.Label.organizationId, organizationId)
              )
            )

          for (const label of allLabels) {
            if (!discoveredExternalIds.includes(label.labelId)) {
              await db
                .update(schema.Label)
                .set({ pendingAction: 'PENDING_REMOVAL', updatedAt: now })
                .where(eq(schema.Label.id, label.id))
            }
          }
        }
      }

      // --- Fetch message IDs ---
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
    }

    throw error
  }
}
