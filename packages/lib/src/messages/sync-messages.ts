import { type Database, schema } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import type { SYNC_STATUS as SyncStatus } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import { type MessageSyncFailedEvent, type MessageSyncPendingEvent, publisher } from '../events'
import {
  MONITOR_INITIAL_DELAY_MS,
  type MonitorMessageSyncJobData,
  type StartMessageSyncJobData,
  type SyncSingleIntegrationMessagesJobData,
} from '../jobs'
import { getQueue, Queues } from '../jobs/queues'
import type { ChannelProviderType } from '../providers/types'

const logger = createScopedLogger('lib:messages:sync-messages')
type SyncInputProps = {
  integrationId?: string
  since?: Date
}
type SyncOutputProps = {
  syncJobId: string
  status: SyncStatus
  message: string
  alreadyInProgress: boolean
}
export class SyncMessages {
  private db: Database
  private organizationId: string
  private userId: string
  constructor(db: Database, organizationId: string, userId: string) {
    this.db = db
    this.organizationId = organizationId
    this.userId = userId
  }
  async sync(input: SyncInputProps): Promise<SyncOutputProps> {
    const { since, integrationId } = input
    const { organizationId, userId } = this
    logger.info(`Received request to start message sync for organization ${organizationId}`, {
      userId,
      integrationId,
      since,
    })

    // --- Detect and clean up stale jobs ---
    await this.detectAndCleanupStaleJobs()

    // --- 1. Check for an existing active sync job ---
    // We check for *any* message category sync job (single or all) that is pending or in progress.
    const [activeSyncJob] = await this.db
      .select({
        id: schema.SyncJob.id,
        status: schema.SyncJob.status,
        integrationId: schema.SyncJob.integrationId,
      })
      .from(schema.SyncJob)
      .where(
        and(
          eq(schema.SyncJob.organizationId, organizationId),
          eq(schema.SyncJob.integrationCategory, 'message'),
          inArray(schema.SyncJob.status, [SYNC_STATUS.PENDING, SYNC_STATUS.IN_PROGRESS])
        )
      )
      .limit(1)
    // If an active job exists, return its details
    if (activeSyncJob) {
      // Optional: Add more context about the active job if needed
      const activeJobType = activeSyncJob.integrationId
        ? `single (${activeSyncJob.integrationId})`
        : 'all'
      logger.info(
        `Attempted to start new message sync for org ${organizationId}, but an active sync is already in progress.`,
        { userId, existingSyncJobId: activeSyncJob.id, status: activeSyncJob.status, activeJobType }
      )
      return {
        syncJobId: activeSyncJob.id,
        status: activeSyncJob.status,
        message: `A message sync is already in progress (Status: ${activeSyncJob.status}).`,
        alreadyInProgress: true,
      }
    }
    // --- 2. If no active sync, create a new SyncJob record (initial state: PENDING) ---
    // We create the job regardless of whether it's a single or all sync.
    // We set the integrationId if it's a single sync.
    const [syncJob] = await this.db
      .insert(schema.SyncJob)
      .values({
        organizationId,
        // userId: userId, // Uncomment if userId relation exists on SyncJob
        type: integrationId ? 'message_sync:single' : 'message_sync:all', // Differentiate type
        integrationCategory: 'message',
        integrationId: integrationId || null,
        status: SYNC_STATUS.PENDING, // Initial status
        updatedAt: new Date(),
      })
      .returning({
        id: schema.SyncJob.id,
        status: schema.SyncJob.status,
        type: schema.SyncJob.type,
      })
    const syncJobId = syncJob!.id
    logger.info(
      `Created new message sync job ${syncJobId} for organization ${organizationId}. Type: ${syncJob!.type}. Status: PENDING.`,
      { userId, integrationId, since }
    )
    // --- 3. Publish the 'pending' event ---
    // Publish *after* creating the DB record. Handlers are synchronous side-effects.
    await publisher.publishLater({
      type: 'messages:sync:pending',
      data: { syncJobId, organizationId, userId, status: SYNC_STATUS.PENDING },
    } as MessageSyncPendingEvent)
    // --- 4. Enqueue the appropriate BullMQ job based on integrationId presence ---
    const messageSyncQueue = getQueue(Queues.messageSyncQueue)
    if (integrationId) {
      // --- Case: Sync Single Integration ---
      logger.info(
        `Initiating single integration sync for job ${syncJobId}, integration ${integrationId}.`,
        { userId, organizationId }
      )
      // Validate the provided integrationId: check if it exists, is enabled, and belongs to the org
      const [integrationToSync] = await this.db
        .select({
          id: schema.Integration.id,
          provider: schema.Integration.provider,
          metadata: schema.Integration.metadata,
          syncStatus: schema.Integration.syncStatus,
          throttleRetryAfter: schema.Integration.throttleRetryAfter,
        })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, integrationId),
            eq(schema.Integration.organizationId, organizationId),
            eq(schema.Integration.enabled, true),
            isNull(schema.Integration.deletedAt)
          )
        )
        .limit(1)
      if (!integrationToSync) {
        logger.error(
          `Requested integration ${integrationId} not found, not enabled, or does not belong to organization ${organizationId}.`,
          { userId }
        )
        // Update the created SyncJob to FAILED state
        await this.db
          .update(schema.SyncJob)
          .set({
            status: SYNC_STATUS.FAILED,
            endTime: new Date(),
            error: `Integration ${integrationId} not found, not enabled, or unauthorized.`,
            totalRecords: 0,
            processedRecords: 0,
            failedRecords: 0,
            integrationSyncJobIds: [], // No child jobs were enqueued
            updatedAt: new Date(),
          })
          .where(eq(schema.SyncJob.id, syncJobId))
        // Publish the failed event *after* DB update
        await publisher.publishLater({
          type: 'messages:sync:failed',
          data: {
            syncJobId,
            organizationId,
            userId,
            status: SYNC_STATUS.FAILED,
            errorDetails: `Integration ${integrationId} not found, not enabled, or unauthorized.`,
          },
        } as MessageSyncFailedEvent)
        throw new Error(`Integration ${integrationId} not found or enabled for this organization.`)
      }
      // Hard reject if integration is currently syncing
      if (integrationToSync.syncStatus === 'SYNCING') {
        logger.warn(`Integration ${integrationId} is already syncing — rejecting sync request`, {
          organizationId,
        })
        await this.db
          .update(schema.SyncJob)
          .set({
            status: SYNC_STATUS.FAILED,
            endTime: new Date(),
            error: `Integration ${integrationId} is already syncing.`,
            totalRecords: 0,
            processedRecords: 0,
            failedRecords: 0,
            integrationSyncJobIds: [],
            updatedAt: new Date(),
          })
          .where(eq(schema.SyncJob.id, syncJobId))
        throw new Error(`Integration ${integrationId} is already syncing.`)
      }

      // Hard reject if integration is throttled
      if (
        integrationToSync.throttleRetryAfter &&
        integrationToSync.throttleRetryAfter > new Date()
      ) {
        const retryAfter = integrationToSync.throttleRetryAfter.toISOString()
        logger.warn(
          `Integration ${integrationId} is throttled until ${retryAfter} — rejecting sync request`,
          { organizationId }
        )
        await this.db
          .update(schema.SyncJob)
          .set({
            status: SYNC_STATUS.FAILED,
            endTime: new Date(),
            error: `Integration ${integrationId} is throttled. Retry after ${retryAfter}.`,
            totalRecords: 0,
            processedRecords: 0,
            failedRecords: 0,
            integrationSyncJobIds: [],
            updatedAt: new Date(),
          })
          .where(eq(schema.SyncJob.id, syncJobId))
        throw new Error(`Integration ${integrationId} is throttled. Retry after ${retryAfter}.`)
      }

      // Prepare job data for the single sync job
      const singleSyncJobData: SyncSingleIntegrationMessagesJobData = {
        syncJobId: syncJobId, // Pass the parent SyncJob ID
        organizationId,
        userId,
        integrationId: integrationToSync.id,
        integrationType: integrationToSync.provider as ChannelProviderType, // Cast type
        since: since ? since.toISOString() : undefined, // Pass date string
      }
      // Generate a unique BullMQ job ID for this single integration sync job
      const bullmqSingleJobId = `sync-int-${syncJobId}-${integrationId}`
      // Enqueue the single integration sync job
      const enqueuedJob = await messageSyncQueue.add(
        'syncSingleIntegrationMessagesJob', // Job name for single sync handler
        singleSyncJobData,
        {
          jobId: bullmqSingleJobId, // Assign specific BullMQ job ID
          removeOnComplete: false, // Remove completed jobs
          removeOnFail: false, // Keep failed jobs for inspection
          attempts: 3, // Retry attempts for this specific integration sync
          backoff: { type: 'exponential', delay: 1000 },
          timeout: 300000, // 5 minutes - prevents runaway jobs even if lock is maintained
        }
      )
      logger.info(
        `Single integration sync job ${enqueuedJob.id} enqueued for job ${syncJobId}, integration ${integrationId}.`,
        { organizationId }
      )
      // Update the SyncJob record with child job details and counts *before* scheduling monitor
      await this.db
        .update(schema.SyncJob)
        .set({
          integrationSyncJobIds: [enqueuedJob.id!], // Store the BullMQ job ID
          totalRecords: 1, // Only 1 job for a single sync
          processedRecords: 0,
          failedRecords: 0,
          updatedAt: new Date(),
        })
        .where(eq(schema.SyncJob.id, syncJobId))
      logger.debug(`Sync job ${syncJobId} updated with single child job ID and total count 1.`, {
        organizationId,
      })
      // Schedule the monitor job (still needed to update status based on the single child job's completion/failure)
      const monitorJobData: MonitorMessageSyncJobData = {
        syncRunId: syncJobId,
        organizationId,
        userId,
      }
      const monitorJobId = `monitor-sync-${syncJobId}` // Consistent ID
      await messageSyncQueue.add('monitorMessageSyncJob', monitorJobData, {
        delay: MONITOR_INITIAL_DELAY_MS, // Short delay
        jobId: monitorJobId,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 5, // Retries for monitor itself
        backoff: { type: 'exponential', delay: 5000 },
      })
      logger.info(`Monitor job ${monitorJobId} scheduled for single sync job ${syncJobId}.`, {
        organizationId,
      })
    } else {
      // --- Case: Sync All Integrations (Existing Orchestrator Logic) ---
      logger.info(`Initiating all integrations sync for job ${syncJobId}.`, {
        userId,
        organizationId,
      })
      // Prepare job data for the orchestrator job
      const orchestratorJobData: StartMessageSyncJobData = {
        syncJobId,
        organizationId,
        userId,
        since: since ? since.toISOString() : undefined, // Pass date string
      }
      const orchestratorBullmqJobId = `orchestrator-sync-${syncJobId}` // Use specific ID for orchestrator job instance
      // Enqueue the orchestrator job
      await messageSyncQueue.add(
        'startMessageSyncJob', // Job name for orchestrator handler
        orchestratorJobData,
        {
          jobId: orchestratorBullmqJobId,
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }
      )
      logger.info(
        `Orchestrator job ${orchestratorBullmqJobId} enqueued for sync job ${syncJobId}.`,
        { organizationId }
      )
      // Note: The orchestrator job itself will update the SyncJob record with totalIntegrationJobs,
      // integrationSyncJobIds, and schedule the monitor job.
    }
    // --- 5. Return the new sync job ID and initial status ---
    return {
      syncJobId: syncJobId,
      status: syncJob!.status, // Will be PENDING
      message: integrationId
        ? `Sync started for integration ${integrationId}.`
        : 'All message integrations sync started.',
      alreadyInProgress: false,
    }
  }

  /**
   * Cancel an active sync job
   *
   * @throws Error if sync job not found or unauthorized
   */
  async cancel(syncJobId: string): Promise<{
    success: boolean
    message: string
  }> {
    const { organizationId, userId } = this

    logger.info(`Attempting to cancel sync job ${syncJobId}`, {
      organizationId,
      userId,
    })

    // 1. Fetch the sync job and verify ownership
    const [syncJob] = await this.db
      .select({
        id: schema.SyncJob.id,
        status: schema.SyncJob.status,
        integrationSyncJobIds: schema.SyncJob.integrationSyncJobIds,
        organizationId: schema.SyncJob.organizationId,
      })
      .from(schema.SyncJob)
      .where(
        and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
      )
      .limit(1)

    if (!syncJob) {
      throw new Error('Sync job not found or unauthorized')
    }

    // 2. Check if cancellable (not already in terminal state)
    const terminalStates = [SYNC_STATUS.COMPLETED, SYNC_STATUS.FAILED]
    if (terminalStates.includes(syncJob.status as any)) {
      logger.warn(`Cannot cancel sync job ${syncJobId} - already ${syncJob.status}`)
      return {
        success: false,
        message: `Sync already ${syncJob.status.toLowerCase()}`,
      }
    }

    // 3. Update DB status to FAILED with cancellation error
    await this.db
      .update(schema.SyncJob)
      .set({
        status: SYNC_STATUS.FAILED,
        endTime: new Date(),
        error: 'CANCELLED_BY_USER',
        updatedAt: new Date(),
      })
      .where(eq(schema.SyncJob.id, syncJobId))

    logger.info(`Updated sync job ${syncJobId} to CANCELLED in DB`)

    // 4. Attempt to cancel BullMQ jobs (best effort)
    const messageSyncQueue = getQueue(Queues.messageSyncQueue)
    const childJobIds = syncJob.integrationSyncJobIds || []

    const cancellationResults = await Promise.allSettled(
      childJobIds.map(async (jobId) => {
        try {
          const job = await messageSyncQueue.getJob(jobId)
          if (job) {
            const state = await job.getState()
            // Only cancel if not already completed
            if (!['completed', 'failed'].includes(state)) {
              await job.moveToFailed(new Error('Cancelled by user'), '', true)
              logger.info(`Cancelled BullMQ job ${jobId}`)
              return { jobId, cancelled: true }
            }
          }
          return { jobId, cancelled: false, reason: 'Already completed or not found' }
        } catch (error) {
          logger.error(`Failed to cancel BullMQ job ${jobId}`, { error })
          return { jobId, cancelled: false, error }
        }
      })
    )

    const cancelledCount = cancellationResults.filter(
      (r) => r.status === 'fulfilled' && r.value.cancelled
    ).length

    logger.info(
      `Cancelled ${cancelledCount}/${childJobIds.length} BullMQ jobs for sync ${syncJobId}`
    )

    // 5. Publish cancellation event
    await publisher.publishLater({
      type: 'messages:sync:failed',
      data: {
        syncJobId,
        organizationId,
        userId,
        status: SYNC_STATUS.FAILED,
        errorDetails: 'Cancelled by user',
      },
    } as MessageSyncFailedEvent)

    return {
      success: true,
      message: 'Sync cancelled successfully',
    }
  }

  /**
   * Detect sync jobs stuck in PENDING/IN_PROGRESS for too long
   * Auto-fail them to allow new syncs to proceed
   */
  private async detectAndCleanupStaleJobs(): Promise<void> {
    const { organizationId } = this

    // Define staleness threshold (10 minutes)
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000)

    logger.debug(`Checking for stale sync jobs older than ${staleThreshold.toISOString()}`, {
      organizationId,
    })

    // Find stale jobs for this organization
    const staleJobs = await this.db
      .select({
        id: schema.SyncJob.id,
        status: schema.SyncJob.status,
        startTime: schema.SyncJob.startTime,
        updatedAt: schema.SyncJob.updatedAt,
        integrationSyncJobIds: schema.SyncJob.integrationSyncJobIds,
      })
      .from(schema.SyncJob)
      .where(
        and(
          eq(schema.SyncJob.organizationId, organizationId),
          eq(schema.SyncJob.integrationCategory, 'message'),
          inArray(schema.SyncJob.status, [SYNC_STATUS.PENDING, SYNC_STATUS.IN_PROGRESS]),
          or(
            lt(schema.SyncJob.startTime, staleThreshold),
            lt(schema.SyncJob.updatedAt, staleThreshold)
          )
        )
      )

    // Also reset integrations stuck in SYNCING for too long
    const staleIntegrationResult = await this.db
      .update(schema.Integration)
      .set({
        syncStatus: 'FAILED',
        syncStage: 'FAILED',
        syncStageStartedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.Integration.organizationId, organizationId),
          eq(schema.Integration.syncStatus, 'SYNCING'),
          or(
            isNull(schema.Integration.syncStageStartedAt),
            lt(schema.Integration.syncStageStartedAt, staleThreshold)
          )
        )
      )
      .returning({ id: schema.Integration.id })

    if (staleIntegrationResult.length > 0) {
      logger.warn(`Reset ${staleIntegrationResult.length} stale SYNCING integration(s)`, {
        organizationId,
        integrationIds: staleIntegrationResult.map((r) => r.id),
      })
    }

    if (staleJobs.length === 0) {
      logger.debug('No stale sync jobs found', { organizationId })
      return
    }

    logger.warn(`Found ${staleJobs.length} stale sync job(s), auto-failing them`, {
      organizationId,
      staleJobIds: staleJobs.map((j) => j.id),
    })

    // Auto-fail each stale job
    for (const staleJob of staleJobs) {
      try {
        await this.failStaleJob(staleJob)
      } catch (error) {
        logger.error(`Failed to clean up stale job ${staleJob.id}`, { error })
        // Continue with other stale jobs
      }
    }
  }

  /**
   * Fail a stale job and clean up associated BullMQ jobs
   */
  private async failStaleJob(staleJob: {
    id: string
    status: string
    startTime: Date
    updatedAt: Date
    integrationSyncJobIds: string[] | null
  }): Promise<void> {
    const { organizationId, userId } = this
    const syncJobId = staleJob.id

    logger.info(`Failing stale sync job ${syncJobId}`, {
      status: staleJob.status,
      startTime: staleJob.startTime,
      updatedAt: staleJob.updatedAt,
    })

    // Update DB status
    await this.db
      .update(schema.SyncJob)
      .set({
        status: SYNC_STATUS.FAILED,
        endTime: new Date(),
        error: `Stale job detected - likely worker crash or timeout. Last updated: ${staleJob.updatedAt.toISOString()}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.SyncJob.id, syncJobId))

    // Cancel associated BullMQ jobs (best effort)
    const messageSyncQueue = getQueue(Queues.messageSyncQueue)
    const childJobIds = staleJob.integrationSyncJobIds || []

    if (childJobIds.length > 0) {
      logger.info(
        `Attempting to cancel ${childJobIds.length} BullMQ jobs for stale sync ${syncJobId}`
      )

      await Promise.allSettled(
        childJobIds.map(async (jobId) => {
          try {
            const job = await messageSyncQueue.getJob(jobId)
            if (job) {
              await job.moveToFailed(new Error('Stale job cleanup'), '', true)
              logger.debug(`Cancelled stale BullMQ job ${jobId}`)
            }
          } catch (error) {
            logger.error(`Failed to cancel stale BullMQ job ${jobId}`, { error })
          }
        })
      )
    }

    // Publish failure event
    await publisher.publishLater({
      type: 'messages:sync:failed',
      data: {
        syncJobId,
        organizationId,
        userId,
        status: SYNC_STATUS.FAILED,
        errorDetails: 'Stale job auto-failed by cleanup',
      },
    } as MessageSyncFailedEvent)

    logger.info(`Successfully failed stale sync job ${syncJobId}`)
  }
}
