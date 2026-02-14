// File: packages/lib/src/jobs/messages/sync-single-integration-messages-job.ts

import { type Database, database as db, schema } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { type IntegrationProviderType, MessageService } from '../../email/message-service'
import { publisher } from '../../events/publisher'
import type { MessageSyncProcessingEvent } from '../../events/types'

const logger = createScopedLogger('job:sync-single-integration-messages')

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
export type SyncSingleIntegrationMessagesJobData = {
  syncJobId: string // Link back to the parent SyncJob run (used for logging/monitor)
  organizationId: string
  userId: string
  integrationId: string
  integrationType: IntegrationProviderType
  since?: string
}

export const syncSingleIntegrationMessagesJob = async (
  job: Job<SyncSingleIntegrationMessagesJobData>
) => {
  const {
    syncJobId,
    organizationId,
    userId,
    integrationId,
    integrationType,
    since: sinceString,
  } = job.data // Use syncJobId
  const since = sinceString ? new Date(sinceString) : undefined

  logger.info(`Starting syncSingleIntegrationMessagesJob`, {
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
      return // Exit without throwing error
    }

    const messageService = new MessageService(organizationId)

    // Call the method in MessageService to sync this specific integration
    // syncMessages method doesn't need the syncJobId, just integration details and since
    await messageService.syncMessages(integrationType, integrationId, since)

    logger.info(`Completed syncSingleIntegrationMessagesJob successfully`, {
      bullmqJobId: job.id,
      syncJobId,
      integrationId,
    })

    // Note: Granular updates to completed/failed counts on the parent SyncJob are handled by the monitor job,
    // or could be done here by emitting a new event (more complex).
    // await db.syncJob.update({ ... }); // If you chose to update counts here
  } catch (error: any) {
    // Check if cancellation error
    if (error.message?.includes('Cancelled by user')) {
      logger.info(`Job ${job.id} cancelled during execution`, { syncJobId })
      return // Don't mark as failed, already marked as cancelled
    }

    logger.error(`SyncSingleIntegrationMessagesJob failed for integration ${integrationId}`, {
      bullmqJobId: job.id,
      syncJobId, // Log parent syncJobId
      integrationId,
      integrationType,
      error: error,
    })

    // Note: Updating failed counts on the parent SyncJob is handled by the monitor job,
    // or could be done here by emitting a new event.
    // await db.syncJob.update({ ... }); // If you chose to update counts here

    // Re-throw the error for BullMQ retry/failure handling for this specific integration job
    throw error
  }
}
