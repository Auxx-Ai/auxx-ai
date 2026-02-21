// packages/lib/src/health/indicators/worker.ts

import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { HealthStateManager } from '../state-manager'
import {
  FAILURE_RATE_THRESHOLD,
  HEALTH_ERROR_MESSAGES,
  HealthStatus,
  type QueueHealth,
} from '../types'

const stateManager = new HealthStateManager()

/** All queue names to monitor */
const MONITORED_QUEUES = Object.values(Queues)

/**
 * Check BullMQ worker health across all queues.
 */
export async function checkWorker() {
  try {
    const queueResults = await Promise.all(MONITORED_QUEUES.map(checkSingleQueue))

    const hasActiveWorkers = queueResults.some((q) => q.workers > 0)
    const status = hasActiveWorkers ? HealthStatus.OPERATIONAL : HealthStatus.OUTAGE

    const details = {
      timestamp: new Date().toISOString(),
      totalQueues: queueResults.length,
      queuesWithWorkers: queueResults.filter((q) => q.workers > 0).length,
      errorMessage: !hasActiveWorkers ? HEALTH_ERROR_MESSAGES.NO_ACTIVE_WORKERS : null,
    }

    stateManager.updateState(details)
    return { status, details, queues: queueResults }
  } catch {
    return {
      status: HealthStatus.OUTAGE,
      details: {
        error: HEALTH_ERROR_MESSAGES.WORKER_CHECK_FAILED,
        stateHistory: stateManager.getStateWithAge(),
      },
    }
  }
}

/** Check a single BullMQ queue */
async function checkSingleQueue(queueName: string): Promise<QueueHealth> {
  const queue = getQueue(queueName as Queues)

  const [workers, waiting, active, delayed, failed, completed] = await Promise.all([
    queue.getWorkers(),
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getDelayedCount(),
    queue.getFailedCount(),
    queue.getCompletedCount(),
  ])

  const totalJobs = failed + completed
  const failureRate = totalJobs > 0 ? Number(((failed / totalJobs) * 100).toFixed(1)) : 0

  return {
    queueName,
    workers: workers.length,
    status: failureRate > FAILURE_RATE_THRESHOLD ? HealthStatus.OUTAGE : HealthStatus.OPERATIONAL,
    metrics: {
      failed,
      completed,
      waiting,
      active,
      delayed,
      failureRate,
    },
  }
}
