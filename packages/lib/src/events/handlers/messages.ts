// File: packages/lib/src/events/handlers/messages.ts

import { database, schema } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import type { SYNC_STATUS as SyncStatus } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type {
  EventHandler,
  MessageSyncCompleteEvent,
  MessageSyncFailedEvent,
  MessageSyncPendingEvent,
  MessageSyncProcessingEvent,
} from '../types'

const logger = createScopedLogger('event-handlers:message-sync')

// Helper to update the SyncJob status
const updateSyncJobStatus = async (
  syncJobId: string,
  organizationId: string, // Added organizationId for extra safety in where clause
  status: SyncStatus,
  updates: {
    endTime?: Date
    error?: string | null
  } = {} // Use error: string | null
) => {
  logger.info(`Attempting to update SyncJob ${syncJobId} status to ${status}`, { organizationId })
  try {
    const [updated] = await database
      .update(schema.SyncJob)
      .set({
        status,
        endTime:
          status === SYNC_STATUS.COMPLETED || status === SYNC_STATUS.FAILED
            ? new Date()
            : updates.endTime,
        error: updates.error ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
      )
      .returning()
    if (!updated) throw new Error(`SyncJob ${syncJobId} not found`)
    logger.info(`Successfully updated SyncJob ${syncJobId} status to ${status}.`, {
      currentStatus: updated.status,
    })
  } catch (error) {
    logger.error(`Failed to update SyncJob ${syncJobId} to status ${status}`, {
      error,
      organizationId,
    })
    // Log the error but do not re-throw to avoid causing issues in the event processing queue.
  }
}
/**
 * Handler for messages:sync:pending event.
 * Updates the sync job status to PENDING in the database.
 * (The API typically creates the job in PENDING, this handler confirms)
 */
export const handleMessageSyncPending: EventHandler<MessageSyncPendingEvent> = async ({
  data: event,
}) => {
  logger.info(`Handling messages:sync:pending event. Status in event: ${event.data.status}`, {
    eventPayload: event.data,
  })
  await updateSyncJobStatus(event.data.syncJobId, event.data.organizationId, SYNC_STATUS.PENDING)
  // Note: The orchestrator job will transition it to IN_PROGRESS when it starts processing.
}
/**
 * Handler for messages:sync:processing event.
 * Updates the sync job status to IN_PROGRESS in the database.
 * (The orchestrator job publishes this event when it starts fetching integrations)
 */
export const handleMessageSyncProcessing: EventHandler<MessageSyncProcessingEvent> = async ({
  data: event,
}) => {
  logger.info(`Handling messages:sync:processing event. Status in event: ${event.data.status}`, {
    eventPayload: event.data,
  })
  await updateSyncJobStatus(
    event.data.syncJobId,
    event.data.organizationId,
    SYNC_STATUS.IN_PROGRESS
  )
}
/**
 * Handler for messages:sync:complete event.
 * Updates the sync job status to COMPLETED in the database.
 * (The monitor job publishes this when all child jobs are complete/succeed)
 */
export const handleMessageSyncComplete: EventHandler<MessageSyncCompleteEvent> = async ({
  data: event,
}) => {
  logger.info(`Handling messages:sync:complete event. Status in event: ${event.data.status}`, {
    eventPayload: event.data,
  })
  await updateSyncJobStatus(event.data.syncJobId, event.data.organizationId, SYNC_STATUS.COMPLETED)
}
/**
 * Handler for messages:sync:failed event.
 * Updates the sync job status to FAILED in the database.
 * (The orchestrator job or monitor job publishes this on failure)
 */
export const handleMessageSyncFailed: EventHandler<MessageSyncFailedEvent> = async ({
  data: event,
}) => {
  logger.info(`Handling messages:sync:failed event. Status in event: ${event.data.status}`, {
    eventPayload: event.data,
    errorDetails: event.data.errorDetails,
  })
  await updateSyncJobStatus(event.data.syncJobId, event.data.organizationId, SYNC_STATUS.FAILED, {
    error: event.data.errorDetails,
  })
}
// Note: Granular updates to completedIntegrationJobs/failedIntegrationJobs counts
// can be done by the monitor job (simpler), or by adding new events like
// 'message:sync:integration:complete' and handlers that increment counts on the SyncJob.
// We'll implement the monitor job updating counts directly, so no new handlers needed here for that.
