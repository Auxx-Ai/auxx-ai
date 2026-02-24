// apps/worker/src/workers/worker-definitions/polling-sync-worker.ts

import {
  messageListFetchJob,
  messagesImportJob,
  pollingRelaunchFailedJob,
  pollingStaleCheckJob,
  pollingSyncScannerJob,
} from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues/types'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:polling-sync')

const pollingSyncJobMappings = {
  pollingSyncScannerJob,
  messageListFetchJob,
  messagesImportJob,
  pollingStaleCheckJob,
  pollingRelaunchFailedJob,
}

/**
 * Starts a BullMQ worker for the polling sync queue.
 * Handles the two-phase polling pipeline: scanner, list-fetch, import,
 * and self-healing jobs (stale check, relaunch failed).
 */
export function startPollingSyncWorker() {
  logger.info(`Starting worker for queue: ${Queues.pollingSyncQueue}`)

  return createWorker(Queues.pollingSyncQueue, pollingSyncJobMappings, {
    lockDuration: 300000, // 5 minutes
    lockRenewTime: 150000, // 2.5 minutes
    concurrency: 10,
  })
}
