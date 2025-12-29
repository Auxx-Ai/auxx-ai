// File: packages/lib/src/jobs/messages/sync-all-messages-job.ts
import type { Job } from 'bullmq'
import { database as db, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { getQueue, Queues } from '../queues'
import { publisher } from '../../events/publisher'
import {
  MessageSyncProcessingEvent,
  MessageSyncCompleteEvent, // Need this for 0 integrations case
  MessageSyncFailedEvent,
} from '../../events/types'
import { IntegrationProviderType } from '../../email/message-service'
import { type SyncSingleIntegrationMessagesJobData } from './sync-single-integration-messages-job'
import { MonitorMessageSyncJobData } from './monitor-message-sync-job'

const logger = createScopedLogger('job:message-sync-orchestrator')

// Define the job data type - the ID is the SyncJob ID
export type StartMessageSyncJobData = {
  syncJobId: string // The ID of the SyncJob record
  organizationId: string
  userId: string
  since?: string
}

export const MONITOR_INITIAL_DELAY_MS = 10000 // Schedule monitor job 10 seconds after enqueueing children

export const startMessageSyncJob = async (job: Job<StartMessageSyncJobData>) => {
  const { syncJobId, organizationId, userId, since: sinceString } = job.data // Use syncJobId
  const since = sinceString ? new Date(sinceString) : undefined

  logger.info(`Starting startMessageSyncJob (Orchestrator) for sync job ${syncJobId}`, {
    jobId: job.id,
    organizationId,
    userId,
    since,
  })

  const messageSyncQueue = getQueue(Queues.messageSyncQueue)

  try {
    // Fetch the SyncJob record - important to verify it exists and is linked to the org
    const [syncJob] = await db
      .select({ status: schema.SyncJob.status })
      .from(schema.SyncJob)
      .where(
        and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
      )
      .limit(1)

    if (!syncJob) {
      logger.error(
        `Sync job ${syncJobId} not found for organization ${organizationId}. Cannot start orchestration.`,
        { jobId: job.id }
      )
      throw new Error(`Sync job ${syncJobId} not found.`) // Re-throw to fail the orchestrator job
    }

    // Optional: Check if the job is already processing/complete/failed?
    // If the worker restarts, it might re-process an active job.
    // Checking the status here and potentially returning early can prevent duplicate work
    // if the orchestration step itself is idempotent. For simplicity, we'll update
    // to IN_PROGRESS regardless, assuming the DB update is idempotent.

    // 1. Update SyncJob status to IN_PROGRESS and publish processing event
    await db
      .update(schema.SyncJob)
      .set({ status: 'IN_PROGRESS' })
      .where(
        and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
      )
    await publisher.publishLater({
      type: 'messages:sync:processing',
      data: { syncJobId, organizationId, userId }, // Use syncJobId
    } as MessageSyncProcessingEvent)

    // 2. Fetch all enabled integrations for the organization
    const enabledIntegrations = await db
      .select({
        id: schema.Integration.id,
        provider: schema.Integration.provider,
        metadata: schema.Integration.metadata,
      })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.organizationId, organizationId),
          eq(schema.Integration.enabled, true),
          inArray(schema.Integration.provider, [
            'google',
            'outlook',
            'facebook',
            'instagram',
            'openphone',
          ])
        )
      )

    if (enabledIntegrations.length === 0) {
      logger.warn(
        `No enabled integrations found for organization ${organizationId}. Marking sync job ${syncJobId} as complete (no work to do).`,
        { jobId: job.id }
      )
      // No integrations to sync, mark as complete immediately
      await db
        .update(schema.SyncJob)
        .set({
          status: 'COMPLETED',
          endTime: new Date(),
          totalRecords: 0,
          processedRecords: 0,
          failedRecords: 0,
        })
        .where(
          and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
        )
      await publisher.publishLater({
        type: 'messages:sync:complete',
        data: { syncJobId, organizationId, userId }, // Use syncJobId
      } as MessageSyncCompleteEvent) // Cast correctly

      logger.info(
        `startMessageSyncJob (Orchestrator) completed for sync job ${syncJobId} (no integrations).`
      )
      return // Stop here
    }

    logger.info(
      `Found ${enabledIntegrations.length} enabled integrations. Enqueueing individual sync jobs.`,
      { jobId: job.id, syncJobId, organizationId }
    )

    // 3. Enqueue a single integration sync job for each enabled integration
    const integrationJobIds: string[] = []
    const jobPromises = enabledIntegrations.map(async (integration) => {
      const jobData: SyncSingleIntegrationMessagesJobData = {
        syncJobId: syncJobId, // Pass the parent SyncJob ID
        organizationId,
        userId,
        integrationId: integration.id,
        integrationType: integration.provider as IntegrationProviderType,
        since: sinceString,
      }

      // Generate a unique job ID for the single integration sync job using parent ID and integration ID
      const singleJobId = `sync-int-${syncJobId}-${integration.id}`

      // Add the single integration sync job to the queue
      const newJob = await messageSyncQueue.add(
        'syncSingleIntegrationMessagesJob', // Job name
        jobData,
        {
          jobId: singleJobId, // Use specific ID
          removeOnComplete: true, // Remove completed jobs
          removeOnFail: false, // KEEP failed jobs so the monitor can see them
          attempts: 3, // Retry individual sync jobs
          backoff: { type: 'exponential', delay: 1000 },
        }
      )
      integrationJobIds.push(newJob.id!) // Store the BullMQ job ID
      logger.debug(`Enqueued sync job for integration ${integration.id}`, {
        bullmqJobId: newJob.id,
        syncJobId,
      })
      return newJob // Return the job promise
    })

    // Wait for all enqueue operations to finish
    await Promise.all(jobPromises)
    logger.info(`All ${integrationJobIds.length} individual sync jobs enqueued.`, {
      jobId: job.id,
      syncJobId,
    })

    // 4. Update the SyncJob record with the list of child job IDs and total count
    await db
      .update(schema.SyncJob)
      .set({
        integrationSyncJobIds: integrationJobIds,
        totalRecords: integrationJobIds.length,
        processedRecords: 0,
        failedRecords: 0,
      })
      .where(
        and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
      )
    logger.info(
      `Sync job ${syncJobId} updated with ${integrationJobIds.length} child job IDs and total count.`,
      { jobId: job.id }
    )

    // 5. Schedule the monitor job
    const monitorJobData: MonitorMessageSyncJobData = {
      syncRunId: syncJobId,
      organizationId,
      userId,
    } // Pass syncJobId
    const monitorJobId = `monitor-sync-${syncJobId}` // Consistent ID for the monitor job

    await messageSyncQueue.add(
      'monitorMessageSyncJob', // Monitor job name
      monitorJobData,
      {
        delay: MONITOR_INITIAL_DELAY_MS, // Schedule check after a short delay
        jobId: monitorJobId, // Assign a specific ID for replaceability
        removeOnComplete: true, // Remove monitor job on success
        removeOnFail: false, // Keep failed monitor job for inspection
        attempts: 5, // Retries for monitor itself
        backoff: { type: 'exponential', delay: 5000 },
      }
    )
    logger.info(
      `Monitor job ${monitorJobId} scheduled for sync job ${syncJobId} with ${MONITOR_INITIAL_DELAY_MS}ms delay.`,
      { jobId: job.id }
    )

    logger.info(
      `startMessageSyncJob (Orchestrator) completed for sync job ${syncJobId}. Monitoring is now handled by job ${monitorJobId}.`
    )
  } catch (error: any) {
    // Error occurs during orchestration (fetching integrations, enqueuing jobs)
    logger.error(`Error in startMessageSyncJob (Orchestrator) for sync job ${syncJobId}`, {
      jobId: job.id,
      error,
      organizationId,
      userId,
    })

    const errorDetails =
      error instanceof Error ? error.message : 'Unknown error during sync orchestration'

    // Update SyncJob status to FAILED (Orchestration Failed)
    try {
      await db
        .update(schema.SyncJob)
        .set({
          status: 'FAILED',
          endTime: new Date(),
          error: `Orchestration failed: ${errorDetails}`,
        })
        .where(
          and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
        )
    } catch (dbError) {
      logger.error(
        `Failed to update SyncJob ${syncJobId} status to FAILED after orchestration error`,
        { dbError, organizationId }
      )
    }

    // Publish failed event
    await publisher.publishLater({
      type: 'messages:sync:failed',
      data: {
        syncJobId,
        organizationId,
        userId,
        errorDetails: `Orchestration failed: ${errorDetails}`,
      }, // Use syncJobId
    } as MessageSyncFailedEvent)

    // Re-throw to allow BullMQ retry of the orchestrator job
    throw error
  }
}
