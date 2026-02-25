// packages/lib/src/health/queue-metrics.ts

import { getQueue } from '../jobs/queues'
import type { Queues } from '../jobs/queues/types'
import type { QueueMetricsResponse, QueueMetricsTimeRange } from './types'

/** Number of minutes of data to fetch per time range */
const POINTS_NEEDED: Record<QueueMetricsTimeRange, number> = {
  '1H': 60,
  '4H': 240,
  '12H': 720,
  '1D': 1440,
  '7D': 10080,
}

const TARGET_VISUALIZATION_POINTS = 240

/**
 * Get time-series metrics for a specific queue.
 */
export async function getQueueMetrics(
  queueName: string,
  timeRange: QueueMetricsTimeRange
): Promise<QueueMetricsResponse> {
  const queue = getQueue(queueName as Queues)
  const pointsNeeded = POINTS_NEEDED[timeRange]
  const samplingFactor = Math.ceil(pointsNeeded / TARGET_VISUALIZATION_POINTS)

  const [workers, failedMetrics, completedMetrics, waiting, active, delayed, failed, completed] =
    await Promise.all([
      queue.getWorkers(),
      queue.getMetrics('failed', 0, pointsNeeded - 1),
      queue.getMetrics('completed', 0, pointsNeeded - 1),
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getDelayedCount(),
      queue.getFailedCount(),
      queue.getCompletedCount(),
    ])

  const totalJobs = failed + completed
  const failureRate = totalJobs > 0 ? Number(((failed / totalJobs) * 100).toFixed(1)) : 0

  const failedData = sampleMetrics(failedMetrics.data, pointsNeeded, samplingFactor)
  const completedData = sampleMetrics(completedMetrics.data, pointsNeeded, samplingFactor)

  return {
    queueName,
    workers: workers.length,
    timeRange,
    failed,
    completed,
    waiting,
    active,
    delayed,
    failureRate,
    data: [
      { id: 'Completed', data: completedData.map((y, x) => ({ x, y })) },
      { id: 'Failed', data: failedData.map((y, x) => ({ x, y })) },
    ],
  }
}

/** Downsample raw metrics by taking the max value per chunk */
function sampleMetrics(rawData: number[], pointsNeeded: number, samplingFactor: number): number[] {
  const targetLength = Math.ceil(pointsNeeded / samplingFactor)
  const result: number[] = []

  for (let i = 0; i < targetLength; i++) {
    const start = i * samplingFactor
    const end = Math.min(start + samplingFactor, rawData.length)
    const chunk = rawData.slice(start, end)
    result.push(chunk.length > 0 ? Math.max(...chunk) : 0)
  }

  while (result.length < targetLength) {
    result.push(0)
  }

  return result
}
