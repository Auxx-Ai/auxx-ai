// packages/lib/src/jobs/polling/messages-import-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import { getImportCacheSize, popFromImportCache } from '../../email/polling-import-cache'
import {
  DEFAULT_IMPORT_BATCH_SIZE,
  PROVIDER_IMPORT_BATCH_SIZE,
} from '../../providers/integration-provider.interface'
import { ProviderRegistryService } from '../../providers/provider-registry-service'

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
 * Pops a batch, imports via provider, and transitions stage.
 */
export const messagesImportJob = async (job: Job<MessagesImportJobData>) => {
  const { integrationId, organizationId, provider } = job.data
  const batchSize =
    job.data.batchSize ?? PROVIDER_IMPORT_BATCH_SIZE[provider] ?? DEFAULT_IMPORT_BATCH_SIZE
  const now = new Date()

  logger.info('Starting messages import', { integrationId, organizationId, batchSize })

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

    // Pop batch from Redis cache
    const externalIds = await popFromImportCache(integrationId, batchSize)

    if (externalIds.length === 0) {
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

    const result = await providerInstance.importMessages(externalIds)

    logger.info('Import batch completed', {
      integrationId,
      imported: result.imported,
      failed: result.failed,
      batchSize: externalIds.length,
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
    }

    throw error
  }
}
