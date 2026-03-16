// packages/lib/src/jobs/messages/sync-single-channel-messages-job.ts

import { type Database, database as db, schema } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { type ChannelProviderType, MessageService } from '../../email/message-service'
import { publisher } from '../../events/publisher'
import type { MessageSyncProcessingEvent } from '../../events/types'

/** Max backoff for sync throttle: 1 hour */
const MAX_THROTTLE_BACKOFF_MS = 3_600_000
/** Base backoff for sync throttle: 30 seconds */
const BASE_THROTTLE_BACKOFF_MS = 30_000

const logger = createScopedLogger('job:sync-single-channel-messages')

/**
 * Check if sync job has been cancelled
 */
async function checkIfCancelled(
  db: Database,
  syncJobId: string,
  organizationId: string
): Promise<boolean> {
  const [syncJob] = await db
    .select({ status: schema.SyncJob.status, error: schema.SyncJob.error })
    .from(schema.SyncJob)
    .where(and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId)))
    .limit(1)

  return syncJob?.status === SYNC_STATUS.FAILED && syncJob?.error === 'CANCELLED_BY_USER'
}

// Define the job data type
export type SyncSingleChannelMessagesJobData = {
  syncJobId: string // Link back to the parent SyncJob run (used for logging/monitor)
  organizationId: string
  userId: string
  integrationId: string
  integrationType: ChannelProviderType
  since?: string
}

export const syncSingleChannelMessagesJob = async (
  jobOrCtx: Job<SyncSingleChannelMessagesJobData>
) => {
  // createJobHandler passes a JobContext; extract the real BullMQ Job
  const job: Job<SyncSingleChannelMessagesJobData> = (jobOrCtx as any).job ?? jobOrCtx
  const {
    syncJobId,
    organizationId,
    userId,
    integrationId,
    integrationType,
    since: sinceString,
  } = job.data
  const since = sinceString ? new Date(sinceString) : undefined

  logger.info(`Starting syncSingleChannelMessagesJob`, {
    jobName: job.name,
    bullmqJobId: job.id,
    syncJobId,
    organizationId,
    userId,
    integrationId,
    integrationType,
    since,
  }) // Log parent syncJobId

  try {
    // Update SyncJob status to IN_PROGRESS before starting the sync
    await db
      .update(schema.SyncJob)
      .set({ status: 'IN_PROGRESS', startTime: new Date() })
      .where(
        and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
      )

    // Set integration sync state to SYNCING
    await db
      .update(schema.Integration)
      .set({
        syncStatus: 'SYNCING',
        syncStage: 'MESSAGE_LIST_FETCH',
        syncStageStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.Integration.id, integrationId))

    // Publish processing event
    await publisher.publishLater({
      type: 'messages:sync:processing',
      data: { syncJobId, organizationId, userId },
    } as MessageSyncProcessingEvent)

    logger.info(`Updated sync job ${syncJobId} status to IN_PROGRESS`, {
      bullmqJobId: job.id,
      integrationId,
    })

    // Check if job was cancelled before starting heavy work
    const isCancelled = await checkIfCancelled(db, syncJobId, organizationId)
    if (isCancelled) {
      logger.info(`Job ${job.id} was cancelled, exiting gracefully`, { syncJobId })
      // Reset integration sync state on cancellation
      await db
        .update(schema.Integration)
        .set({
          syncStatus: 'FAILED',
          syncStage: 'IDLE',
          syncStageStartedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integrationId))
      return
    }

    const messageService = new MessageService(organizationId)
    await messageService.syncMessages(integrationType, integrationId, since)

    // On success: set integration to ACTIVE and reset throttle
    await db
      .update(schema.Integration)
      .set({
        syncStatus: 'ACTIVE',
        syncStage: 'IDLE',
        syncStageStartedAt: null,
        throttleFailureCount: 0,
        throttleRetryAfter: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.Integration.id, integrationId))

    // Mark parent SyncJob as COMPLETED
    await db
      .update(schema.SyncJob)
      .set({
        status: SYNC_STATUS.COMPLETED,
        endTime: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
      )

    logger.info(`Completed syncSingleChannelMessagesJob successfully`, {
      bullmqJobId: job.id,
      syncJobId,
      integrationId,
    })
  } catch (error: any) {
    // Check if cancellation error
    if (error.message?.includes('Cancelled by user')) {
      logger.info(`Job ${job.id} cancelled during execution`, { syncJobId })
      await db
        .update(schema.Integration)
        .set({
          syncStatus: 'FAILED',
          syncStage: 'IDLE',
          syncStageStartedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integrationId))
      return
    }

    logger.error(`SyncSingleChannelMessagesJob failed for channel ${integrationId}`, {
      bullmqJobId: job.id,
      syncJobId,
      integrationId,
      integrationType,
      error: error,
    })

    // Only apply throttle on the final BullMQ attempt
    const maxAttempts = job.opts.attempts ?? 1
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts

    if (!isFinalAttempt) {
      // Keep integration marked as syncing while BullMQ retries
      await db
        .update(schema.Integration)
        .set({
          syncStatus: 'SYNCING',
          syncStage: 'MESSAGE_LIST_FETCH',
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integrationId))
      throw error
    }

    // Final failure: apply backoff
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
        syncStatus: 'FAILED',
        syncStage: 'FAILED',
        syncStageStartedAt: null,
        throttleFailureCount: newCount,
        throttleRetryAfter: new Date(Date.now() + backoffMs),
        updatedAt: new Date(),
      })
      .where(eq(schema.Integration.id, integrationId))

    // Mark parent SyncJob as FAILED
    await db
      .update(schema.SyncJob)
      .set({
        status: SYNC_STATUS.FAILED,
        endTime: new Date(),
        error: error.message || 'Unknown error',
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
      )

    logger.info(`Applied sync throttle to channel ${integrationId}`, {
      throttleFailureCount: newCount,
      retryAfterMs: backoffMs,
    })

    throw error
  }
}
