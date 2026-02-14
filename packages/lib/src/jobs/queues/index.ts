import { createScopedLogger } from '@auxx/logger'
import { getConnectionOptions } from '@auxx/redis'
import { type JobsOptions, Queue } from 'bullmq'
import type { Queues } from './types'

const logger = createScopedLogger('jobs-queues')

// Export flow utilities
export {
  addFlow,
  addFlows,
  closeFlowProducer,
  type FlowJobDefinition,
  getFlowProducer,
} from './flow-producer'
export { Queues } from './types'

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5, //env.JOB_RETRY_ATTEMPTS,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnFail: true,
  removeOnComplete: true,
}
// const options = {
//   connection: { host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD },
//   defaultJobOptions: DEFAULT_JOB_OPTIONS,
// }

// Cache for queue instances to prevent recreating them
const queueCache: Record<string, Queue> = {}

const getBullMQOptions = () => {
  const connectionOptions = getConnectionOptions()
  return {
    connection: {
      ...connectionOptions,
      // Optional: Add connection timeout and retry strategy
      // tls: {},
      connectTimeout: 10000,
    },
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  }
}

/**
 * Get a queue instance (creates it if it doesn't exist)
 * @param queueName Name of the queue from Queues enum
 * @returns Queue instance
 */
export function getQueue(queueName: Queues): Queue {
  try {
    // Return from cache if it exists
    if (queueCache[queueName]) {
      return queueCache[queueName]
    }

    logger.info(`Creating queue: ${queueName}`)
    const options = getBullMQOptions()
    // console.log('Queue options:', options)
    // Create new queue instance
    const queue = new Queue(queueName, options)

    // Cache it for future use
    queueCache[queueName] = queue

    return queue
  } catch (error) {
    logger.error(`Error creating queue: ${queueName}`, { error })
    throw error
  }
}

/**
 * Close all queue connections - useful for graceful shutdown
 */
export async function closeAllQueues(): Promise<void> {
  const closePromises: Promise<void>[] = []

  for (const queueName of Object.keys(queueCache)) {
    logger.info(`Closing queue: ${queueName}`)
    closePromises.push(queueCache[queueName].close())
  }

  await Promise.all(closePromises)

  // Clear the cache after closing
  for (const key of Object.keys(queueCache)) {
    delete queueCache[key]
  }

  logger.info('All queues closed')
}

// export const defaultQueue = new Queue(Queues.defaultQueue, options)
// export const eventHandlersQueue = new Queue(Queues.eventHandlersQueue, options)
// export const eventsQueue = new Queue(Queues.eventsQueue, options)
// export const maintenanceQueue = new Queue(Queues.maintenanceQueue, options)
// export const webhooksQueue = new Queue(Queues.webhooksQueue, options)
// export const shopifyQueue = new Queue(Queues.shopifyQueue, options)
