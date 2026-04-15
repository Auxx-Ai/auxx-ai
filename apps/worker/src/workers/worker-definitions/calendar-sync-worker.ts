// apps/worker/src/workers/worker-definitions/calendar-sync-worker.ts

import { calendarSyncJob, calendarSyncScannerJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

/**
 * Logger for the calendar sync worker.
 */
const logger = createScopedLogger('worker:calendar-sync')

/**
 * Job handlers registered on the calendar sync queue.
 */
const calendarSyncJobMappings = {
  calendarSyncScannerJob,
  calendarSyncJob,
}

/**
 * Start the BullMQ worker for Google calendar sync jobs.
 */
export function startCalendarSyncWorker() {
  logger.info(`Starting worker for queue: ${Queues.calendarSyncQueue}`)

  return createWorker(Queues.calendarSyncQueue, calendarSyncJobMappings, {
    concurrency: 5,
  })
}
