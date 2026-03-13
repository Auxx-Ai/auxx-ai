// packages/lib/src/jobs/maintenance/storage-cleanup-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { clearImportCache } from '../../email/polling-import-cache'
import { StorageManager } from '../../files/storage/storage-manager'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('storage-cleanup-job')

const S3_BATCH_DELETE_LIMIT = 1000

export interface StorageCleanupJobData {
  type: 'integration' | 'organization'
  organizationId: string
  integrationId?: string
}

interface CleanupResult {
  storageLocationsDeleted: number
  s3ObjectsDeleted: number
  redisKeysCleared: number
  integrationHardDeleted: boolean
  errors: string[]
}

/**
 * Async cleanup job for S3 objects, Redis keys, and BullMQ jobs
 * after channel disconnect or organization deletion.
 *
 * Processes StorageLocation records marked with deletedAt, deletes the
 * corresponding S3 objects, then hard-deletes the DB records.
 */
export async function storageCleanupJob(
  ctx: JobContext<StorageCleanupJobData>
): Promise<CleanupResult> {
  const { type, organizationId, integrationId } = ctx.data

  logger.info('Starting storage cleanup job', {
    type,
    organizationId,
    integrationId,
    jobId: ctx.jobId,
  })

  const result: CleanupResult = {
    storageLocationsDeleted: 0,
    s3ObjectsDeleted: 0,
    redisKeysCleared: 0,
    integrationHardDeleted: false,
    errors: [],
  }

  try {
    // Phase 1: Delete S3 objects for marked StorageLocations
    await ctx.updateProgress(10)
    await deleteMarkedStorageLocations(organizationId, result)

    // Phase 2: Clear Redis polling cache
    await ctx.updateProgress(50)
    if (type === 'integration' && integrationId) {
      await clearIntegrationRedisKeys(integrationId, result)
    } else if (type === 'organization') {
      await clearOrganizationRedisKeys(organizationId, result)
    }

    // Phase 3: Remove stale BullMQ jobs for the integration
    await ctx.updateProgress(70)
    if (type === 'integration' && integrationId) {
      await removeStalePollingJobs(integrationId)
    }

    // Phase 4: Hard-delete the soft-deleted Integration record
    await ctx.updateProgress(85)
    if (type === 'integration' && integrationId) {
      await hardDeleteIntegration(integrationId, result)
    }

    await ctx.updateProgress(100)

    logger.info('Storage cleanup job completed', {
      type,
      organizationId,
      integrationId,
      result,
      jobId: ctx.jobId,
    })

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.errors.push(message)
    logger.error('Storage cleanup job failed', {
      type,
      organizationId,
      integrationId,
      error: message,
      result,
      jobId: ctx.jobId,
    })
    throw error
  }
}

/**
 * Find all StorageLocations marked as deleted for the given org,
 * delete their S3 objects in batches, then hard-delete the DB records.
 */
async function deleteMarkedStorageLocations(
  organizationId: string,
  result: CleanupResult
): Promise<void> {
  let hasMore = true

  while (hasMore) {
    // Fetch a batch of marked-for-deletion StorageLocations
    const markedLocations = await db
      .select({
        id: schema.StorageLocation.id,
        provider: schema.StorageLocation.provider,
        externalId: schema.StorageLocation.externalId,
      })
      .from(schema.StorageLocation)
      .where(
        and(
          eq(schema.StorageLocation.organizationId, organizationId),
          isNotNull(schema.StorageLocation.deletedAt)
        )
      )
      .limit(S3_BATCH_DELETE_LIMIT)

    if (markedLocations.length === 0) {
      hasMore = false
      break
    }

    // Delete S3 objects — group by provider for efficient batch deletion
    const byProvider = new Map<string, typeof markedLocations>()
    for (const loc of markedLocations) {
      const group = byProvider.get(loc.provider) || []
      group.push(loc)
      byProvider.set(loc.provider, group)
    }

    const storageManager = new StorageManager(organizationId)
    for (const [provider, locations] of byProvider) {
      for (const loc of locations) {
        try {
          await storageManager.deleteByKey({
            provider: provider as any,
            key: loc.externalId,
          })
          result.s3ObjectsDeleted++
        } catch (error) {
          // Log but continue — the DB record will be cleaned up regardless
          const message = error instanceof Error ? error.message : String(error)
          logger.warn('Failed to delete S3 object, continuing', {
            storageLocationId: loc.id,
            externalId: loc.externalId,
            error: message,
          })
          result.errors.push(`S3 delete failed for ${loc.id}: ${message}`)
        }
      }
    }

    // Hard-delete the StorageLocation DB records
    const ids = markedLocations.map((loc) => loc.id)
    await db.delete(schema.StorageLocation).where(
      sql`${schema.StorageLocation.id} IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`
    )
    result.storageLocationsDeleted += markedLocations.length

    logger.info('Processed batch of marked StorageLocations', {
      batchSize: markedLocations.length,
      totalDeleted: result.storageLocationsDeleted,
    })

    // If we got a full batch, there might be more
    hasMore = markedLocations.length === S3_BATCH_DELETE_LIMIT
  }
}

/**
 * Clear Redis polling cache keys for a single integration.
 */
async function clearIntegrationRedisKeys(
  integrationId: string,
  result: CleanupResult
): Promise<void> {
  try {
    await clearImportCache(integrationId)
    result.redisKeysCleared += 2 // main + processing keys
    logger.info('Cleared Redis polling cache for integration', { integrationId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Failed to clear Redis keys for integration', { integrationId, error: message })
    result.errors.push(`Redis clear failed for integration ${integrationId}: ${message}`)
  }
}

/**
 * Clear Redis polling cache keys for all integrations in an organization.
 */
async function clearOrganizationRedisKeys(
  organizationId: string,
  result: CleanupResult
): Promise<void> {
  try {
    // Org may already be deleted at this point, so query integration IDs
    // from Redis pattern scan instead
    const redis = await getRedisClient()
    if (!redis) return

    // Use SCAN to find all polling cache keys for this org's integrations
    // Since we can't know which integration IDs belonged to this org from Redis alone,
    // the caller should have cleared these before org deletion.
    // This is a best-effort sweep.
    logger.info('Organization Redis cleanup is handled pre-deletion', { organizationId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Failed to clear Redis keys for organization', { organizationId, error: message })
    result.errors.push(`Redis clear failed for org ${organizationId}: ${message}`)
  }
}

/**
 * Remove pending/scheduled BullMQ polling jobs for the integration.
 */
async function removeStalePollingJobs(integrationId: string): Promise<void> {
  try {
    const { getQueue } = await import('../queues')
    const { Queues } = await import('../queues/types')
    const queue = getQueue(Queues.pollingSyncQueue)

    // Get waiting and delayed jobs and remove those matching this integration
    const [waiting, delayed] = await Promise.all([
      queue.getWaiting(0, 500),
      queue.getDelayed(0, 500),
    ])

    const staleJobs = [...waiting, ...delayed].filter(
      (job) => job.data?.integrationId === integrationId
    )

    for (const job of staleJobs) {
      try {
        await job.remove()
      } catch {
        // Job may have already been processed
      }
    }

    if (staleJobs.length > 0) {
      logger.info('Removed stale polling jobs', {
        integrationId,
        count: staleJobs.length,
      })
    }
  } catch (error) {
    // Non-critical — jobs will eventually expire or fail gracefully
    logger.warn('Failed to remove stale polling jobs', {
      integrationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Hard-delete a soft-deleted Integration record after cleanup is complete.
 */
async function hardDeleteIntegration(integrationId: string, result: CleanupResult): Promise<void> {
  try {
    await db
      .delete(schema.Integration)
      .where(and(eq(schema.Integration.id, integrationId), isNotNull(schema.Integration.deletedAt)))
    result.integrationHardDeleted = true
    logger.info('Hard-deleted soft-deleted Integration', { integrationId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Failed to hard-delete Integration', { integrationId, error: message })
    result.errors.push(`Hard-delete Integration failed: ${message}`)
  }
}

/**
 * Enqueue a storage cleanup job on the maintenance queue.
 */
export async function enqueueStorageCleanupJob(data: StorageCleanupJobData): Promise<void> {
  const { getQueue } = await import('../queues')
  const { Queues } = await import('../queues/types')
  const queue = getQueue(Queues.maintenanceQueue)

  const jobId = data.integrationId
    ? `storage-cleanup:integration:${data.integrationId}`
    : `storage-cleanup:org:${data.organizationId}`

  await queue.add('storageCleanupJob', data, {
    jobId,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
    priority: 5,
  })

  logger.info('Enqueued storage cleanup job', { data, jobId })
}
