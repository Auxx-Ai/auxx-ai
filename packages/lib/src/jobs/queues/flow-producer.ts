// packages/lib/src/jobs/queues/flow-producer.ts

import { createScopedLogger } from '@auxx/logger'
import { getConnectionOptions } from '@auxx/redis'
import { type FlowJob, type FlowOpts, FlowProducer } from 'bullmq'
import type { Queues } from './types'

const logger = createScopedLogger('flow-producer')

let flowProducerInstance: FlowProducer | null = null

/**
 * Get or create the FlowProducer singleton
 */
export function getFlowProducer(): FlowProducer {
  if (!flowProducerInstance) {
    flowProducerInstance = new FlowProducer({
      connection: getConnectionOptions(),
    })

    flowProducerInstance.on('error', (error) => {
      logger.error('FlowProducer error', { error: error.message })
    })

    logger.info('FlowProducer initialized')
  }

  return flowProducerInstance
}

/**
 * Close the FlowProducer connection
 */
export async function closeFlowProducer(): Promise<void> {
  if (flowProducerInstance) {
    await flowProducerInstance.close()
    flowProducerInstance = null
    logger.info('FlowProducer closed')
  }
}

/**
 * Flow job builder for type-safe flow creation
 */
export interface FlowJobDefinition<T = any> {
  name: string
  queue: Queues
  data: T
  opts?: FlowOpts
  children?: FlowJobDefinition[]
}

/**
 * Convert FlowJobDefinition to BullMQ FlowJob
 */
function toFlowJob(def: FlowJobDefinition): FlowJob {
  return {
    name: def.name,
    queueName: def.queue,
    data: def.data,
    opts: def.opts,
    children: def.children?.map(toFlowJob),
  }
}

/**
 * Add a flow to the queue
 *
 * @param flow The flow definition (parent with optional children)
 * @returns The created flow with job references
 */
export async function addFlow(flow: FlowJobDefinition) {
  const producer = getFlowProducer()
  const flowJob = toFlowJob(flow)

  logger.info('Adding flow', {
    parentName: flow.name,
    parentQueue: flow.queue,
    childrenCount: flow.children?.length || 0,
  })

  const result = await producer.add(flowJob)

  logger.info('Flow added successfully', {
    parentJobId: result.job.id,
    childrenJobIds: result.children?.map((c) => c.job.id),
  })

  return result
}

/**
 * Add multiple flows in bulk
 */
export async function addFlows(flows: FlowJobDefinition[]) {
  const producer = getFlowProducer()
  const flowJobs = flows.map(toFlowJob)

  logger.info('Adding bulk flows', { count: flows.length })

  const results = await producer.addBulk(flowJobs)

  logger.info('Bulk flows added', {
    count: results.length,
    jobIds: results.map((r) => r.job.id),
  })

  return results
}
