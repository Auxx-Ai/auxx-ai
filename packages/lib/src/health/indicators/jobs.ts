// packages/lib/src/health/indicators/jobs.ts

import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import { HealthStateManager } from '../state-manager'
import { FAILURE_RATE_THRESHOLD, HEALTH_ERROR_MESSAGES, HealthStatus } from '../types'

const stateManager = new HealthStateManager()

/**
 * Check background job health across all queues.
 * Different from worker check — this focuses on job success/failure rates.
 */
export async function checkJobs() {
  try {
    const queues = Object.values(Queues)
    const results = await Promise.all(
      queues.map(async (queueName) => {
        const queue = getQueue(queueName as Queues)
        const [failed, completed, waiting, active] = await Promise.all([
          queue.getFailedCount(),
          queue.getCompletedCount(),
          queue.getWaitingCount(),
          queue.getActiveCount(),
        ])

        const total = failed + completed
        const failureRate = total > 0 ? Number(((failed / total) * 100).toFixed(2)) : 0

        return { queueName, failed, completed, waiting, active, total, failureRate }
      })
    )

    /** Aggregate across all queues */
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0)
    const totalCompleted = results.reduce((sum, r) => sum + r.completed, 0)
    const totalJobs = totalFailed + totalCompleted
    const overallFailureRate =
      totalJobs > 0 ? Number(((totalFailed / totalJobs) * 100).toFixed(2)) : 0

    const status =
      totalJobs === 0 || overallFailureRate < FAILURE_RATE_THRESHOLD
        ? HealthStatus.OPERATIONAL
        : HealthStatus.OUTAGE

    const details = {
      timestamp: new Date().toISOString(),
      totalFailed,
      totalCompleted,
      totalJobs,
      overallFailureRate,
      queues: results,
      errorMessage:
        status === HealthStatus.OUTAGE ? HEALTH_ERROR_MESSAGES.JOB_HIGH_FAILURE_RATE : null,
    }

    stateManager.updateState(details)
    return { status, details }
  } catch {
    return {
      status: HealthStatus.OUTAGE,
      details: {
        error: HEALTH_ERROR_MESSAGES.JOB_CHECK_TIMEOUT,
        stateHistory: stateManager.getStateWithAge(),
      },
    }
  }
}
