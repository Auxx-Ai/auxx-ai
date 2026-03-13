// packages/lib/src/usage/enqueue-usage-event.ts

import { createScopedLogger } from '@auxx/logger'
import type { RecordUsageEventJobData } from './types'

const logger = createScopedLogger('enqueue-usage-event')

/**
 * Enqueue a usage event recording job via BullMQ.
 * This writes the event to Postgres for durable audit trail.
 */
export async function enqueueUsageEvent(data: RecordUsageEventJobData): Promise<void> {
  const { getQueue } = await import('../jobs/queues')
  const { Queues } = await import('../jobs/queues/types')
  const queue = getQueue(Queues.maintenanceQueue)

  await queue.add('recordUsageEvent', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: { count: 500 },
  })

  logger.debug('Enqueued usage event', { orgId: data.orgId, metric: data.metric })
}
