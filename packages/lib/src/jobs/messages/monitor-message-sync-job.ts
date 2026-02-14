// File: packages/lib/src/jobs/messages/monitor-message-sync-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { publisher } from '../../events/publisher'
import type { MessageSyncCompleteEvent, MessageSyncFailedEvent } from '../../events/types'
import { getQueue, Queues } from '../queues'

const logger = createScopedLogger('job:message-sync-monitor')

export type MonitorMessageSyncJobData = {
  syncRunId: string // Refers to SyncJob.id
  organizationId: string
  userId: string
  attempt?: number
}

export const MONITOR_RECHECK_DELAY_MS = 5000

export const monitorMessageSyncJob = async (job: Job<MonitorMessageSyncJobData>) => {
  const { syncRunId: syncJobId, organizationId, userId } = job.data
  const jobAttempt = job.data.attempt || 1

  logger.info(`Monitoring sync job ${syncJobId}, attempt ${jobAttempt}`, {
    bullmqJobId: job.id,
    organizationId,
    userId,
  })

  const messageSyncQueue = getQueue(Queues.messageSyncQueue)

  try {
    // 1. Fetch the SyncJob record
    const [syncJob] = await db
      .select({
        id: schema.SyncJob.id,
        status: schema.SyncJob.status,
        integrationSyncJobIds: schema.SyncJob.integrationSyncJobIds,
        totalRecords: schema.SyncJob.totalRecords,
        organizationId: schema.SyncJob.organizationId,
      })
      .from(schema.SyncJob)
      .where(
        and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
      )

    // If sync job is already complete or failed, or not found, stop monitoring.
    if (!syncJob || ['COMPLETED', 'FAILED'].includes(syncJob.status as any)) {
      logger.warn(
        `Monitor job ${job.id} found sync job ${syncJobId} in terminal state or not found. Stopping monitoring.`,
        { syncJobStatus: syncJob?.status }
      )
      return
    }

    const integrationJobIds = syncJob.integrationSyncJobIds
    const totalJobsExpected = syncJob.totalRecords // Use totalRecords

    // Handle edge case where no jobs were ever enqueued (should be caught by orchestrator, but defensive)
    if (!integrationJobIds || integrationJobIds.length === 0) {
      logger.warn(
        `Monitor job ${job.id} found sync job ${syncJobId} with no child job IDs. Total expected: ${totalJobsExpected}. Marking as failed if total > 0.`,
        { jobId: job.id }
      )
      const status = totalJobsExpected > 0 ? 'FAILED' : 'COMPLETED'
      const errorMsg =
        totalJobsExpected > 0
          ? 'No individual sync jobs were queued despite expected total > 0.'
          : null

      // Update DB status *before* publishing event
      await db
        .update(schema.SyncJob)
        .set({
          status: status as any,
          endTime: new Date(),
          error: errorMsg || null,
          failedRecords: totalJobsExpected > 0 ? 0 : 0,
          processedRecords: totalJobsExpected === 0 ? 0 : 0,
        })
        .where(
          and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
        )

      // Publish event *after* DB update
      if (status === 'COMPLETED') {
        await publisher.publishLater({
          type: 'messages:sync:complete',
          data: { syncJobId, organizationId, userId, status: 'COMPLETED' as any },
        } as MessageSyncCompleteEvent)
      } else {
        await publisher.publishLater({
          type: 'messages:sync:failed',
          data: {
            syncJobId,
            organizationId,
            userId,
            status: 'FAILED' as any,
            errorDetails: errorMsg,
          },
        } as MessageSyncFailedEvent)
      }
      return
    }

    // 2. Get the status of the child jobs by their BullMQ job IDs
    const childJobs = await Promise.all(integrationJobIds.map((id) => messageSyncQueue.getJob(id)))

    let completedCount = 0
    let failedCount = 0
    let activeCount = 0 // Jobs that are not in a terminal state ('completed', 'failed')
    let missingCount = 0 // Jobs not found or potentially cleaned up prematurely

    const failedJobDetails: { id: string; error: string }[] = []
    const jobsToCleanUp: Job[] = [] // Store jobs that have reached a terminal state

    for (const childJob of childJobs) {
      if (!childJob) {
        missingCount++
        continue
      }

      const state = await childJob.getState()

      if (state === 'completed') {
        completedCount++
        jobsToCleanUp.push(childJob) // Mark for cleanup
      } else if (state === 'failed' || state === 'stuck') {
        failedCount++
        failedJobDetails.push({
          id: childJob.id!,
          error: childJob.failedReason || (state === 'stuck' ? 'Job stuck' : 'Unknown error'),
        })
        if (state === 'stuck')
          logger.warn(`Child job ${childJob.id} for sync job ${syncJobId} is stuck.`)
        jobsToCleanUp.push(childJob) // Mark for cleanup
      } else {
        activeCount++ // Job is still waiting, delayed, or active
      }
    }

    const totalJobsEnqueued = integrationJobIds.length // This is the source of truth for total
    logger.info(
      `Sync job ${syncJobId} monitor status: Total Enqueued (from DB): ${totalJobsExpected}, Total Enqueued (actual list): ${totalJobsEnqueued}, Completed Child Jobs: ${completedCount}, Failed Child Jobs: ${failedCount}, Active Child Jobs: ${activeCount}, Missing Child Jobs: ${missingCount}`,
      { bullmqJobId: job.id }
    )

    // 3. Determine overall status
    const allJobsFinished = activeCount === 0

    if (allJobsFinished) {
      // All child jobs have reached a terminal state or are missing
      const hasFailuresOrMissing = failedCount > 0 || missingCount > 0
      const finalStatus = hasFailuresOrMissing ? 'FAILED' : 'COMPLETED'
      const errorSummary = hasFailuresOrMissing
        ? `Sync failed. ${failedCount} integration(s) failed, ${missingCount} job(s) missing. Failed integrations: ${failedJobDetails.map((d) => `${d.id} (${d.error})`).join(', ')}`
        : null

      logger.info(`Sync job ${syncJobId} reached terminal state: ${finalStatus}.`, {
        bullmqJobId: job.id,
        errorSummary,
      })

      // Update DB status *before* publishing event
      await db
        .update(schema.SyncJob)
        .set({
          status: finalStatus as any,
          endTime: new Date(),
          error: errorSummary || null,
          processedRecords: completedCount,
          failedRecords: failedCount,
        })
        .where(
          and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
        )
      logger.info(`Sync job ${syncJobId} status updated to ${finalStatus} in DB.`, {
        bullmqJobId: job.id,
      })

      // Publish event *after* DB update
      if (finalStatus === 'COMPLETED') {
        await publisher.publishLater({
          type: 'messages:sync:complete',
          data: { syncJobId, organizationId, userId, status: 'COMPLETED' as any },
        } as MessageSyncCompleteEvent)
      } else {
        await publisher.publishLater({
          type: 'messages:sync:failed',
          data: {
            syncJobId,
            organizationId,
            userId,
            status: 'FAILED' as any,
            errorDetails: errorSummary,
          },
        } as MessageSyncFailedEvent)
      }
      logger.info(`Sync status ${finalStatus} event published for job ${syncJobId}.`, {
        bullmqJobId: job.id,
      })

      // --- Cleanup: Remove child jobs that finished ---
      logger.info(
        `Monitor job ${job.id} cleaning up ${jobsToCleanUp.length} finished child jobs for sync job ${syncJobId}.`
      )
      await Promise.all(
        jobsToCleanUp.map((childJob) => {
          logger.debug(`Removing child job ${childJob.id} for sync job ${syncJobId}`)
          return childJob.remove().catch((err) => {
            // Log error but don't fail the monitor job because cleanup failed
            logger.error(
              `Failed to remove child job ${childJob.id} during cleanup for sync job ${syncJobId}`,
              { error: err }
            )
          })
        })
      )
      logger.info(`Cleanup complete for sync job ${syncJobId}.`)

      // Monitoring is complete for this sync job
      logger.info(`Monitor job ${job.id} finishing for sync job ${syncJobId}.`)
    } else {
      // Some jobs are still active, reschedule the monitor job
      logger.info(
        `Sync job ${syncJobId} still has active jobs (${activeCount}). Rescheduling monitor job ${job.id}.`,
        { bullmqJobId: job.id }
      )

      // Update completed/failed counts periodically on the parent SyncJob so UI can show progress
      try {
        await db
          .update(schema.SyncJob)
          .set({ processedRecords: completedCount, failedRecords: failedCount })
          .where(
            and(eq(schema.SyncJob.id, syncJobId), eq(schema.SyncJob.organizationId, organizationId))
          )
        logger.debug(`Updated progress counts for sync job ${syncJobId}`, {
          bullmqJobId: job.id,
          completed: completedCount,
          failed: failedCount,
        })
      } catch (dbError) {
        logger.error(`Failed to update progress counts for sync job ${syncJobId}`, {
          bullmqJobId: job.id,
          dbError,
        })
      }

      // Reschedule the monitor job using the same ID
      await messageSyncQueue.add(
        job.name,
        { ...job.data, attempt: jobAttempt + 1 },
        {
          delay: MONITOR_RECHECK_DELAY_MS,
          jobId: job.id,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
        }
      )
    }
  } catch (error: any) {
    logger.error(`Error in monitorMessageSyncJob for sync job ${syncJobId}`, {
      bullmqJobId: job.id,
      error,
    })
    throw error
  }
}
