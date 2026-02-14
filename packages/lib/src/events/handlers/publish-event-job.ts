import type { Job } from 'bullmq'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import type { AuxxEvent } from '../types'
import { EventHandlers } from '.'

export const publishEventJob = async (job: Job<AuxxEvent>) => {
  const event = job.data
  const handlers = EventHandlers[event.type]

  const queue = getQueue(Queues.eventHandlersQueue)
  if (!handlers?.length) return
  handlers.forEach((handler) => {
    queue.add(handler.name, event)
  })
}
