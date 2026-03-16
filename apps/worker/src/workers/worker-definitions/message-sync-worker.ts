import {
  monitorMessageSyncJob,
  startMessageSyncJob,
  syncSingleChannelMessagesJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:message-sync')

const messageSyncJobMappings = {
  startMessageSyncJob,
  syncSingleIntegrationMessagesJob: syncSingleChannelMessagesJob,
  monitorMessageSyncJob,
}

/**
 * Starts a BullMQ worker specifically for the message sync queue.
 * This worker will process jobs related to message synchronization,
 * including orchestration, single integration syncs, and monitoring.
 *
 * Extended lock settings are configured to handle long-running sync operations
 * that can take several minutes when processing large message volumes.
 *
 * @returns {Worker} The started BullMQ Worker instance.
 */
export function startMessageSyncWorker() {
  logger.info(`Starting worker for queue: ${Queues.messageSyncQueue}`)

  // Extended lock configuration for long-running sync jobs
  // - lockDuration: 5 minutes to handle large Gmail/Outlook syncs
  // - lockRenewTime: 2.5 minutes (half of lockDuration for automatic renewal)
  // - concurrency: 5 to process multiple integrations simultaneously
  return createWorker(Queues.messageSyncQueue, messageSyncJobMappings, {
    lockDuration: 300000, // 5 minutes
    lockRenewTime: 150000, // 2.5 minutes
    concurrency: 5,
  })
}
