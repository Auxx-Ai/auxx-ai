import type { Job } from 'bullmq'
import { type AuxxEvent } from '../types'
import { EventHandlers } from '.'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'

export const publishEventJob = async (job: Job<AuxxEvent>) => {
  const event = job.data
  const handlers = EventHandlers[event.type]

  const queue = getQueue(Queues.eventHandlersQueue)
  if (!handlers?.length) return
  handlers.forEach((handler) => {
    queue.add(handler.name, event)
  })
}
