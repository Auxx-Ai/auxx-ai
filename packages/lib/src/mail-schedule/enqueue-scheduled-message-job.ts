// packages/lib/src/mail-schedule/enqueue-scheduled-message-job.ts

import type { SendScheduledMessageJobData } from './send-scheduled-message-job'

/**
 * Enqueue a delayed BullMQ job to send a scheduled message at the specified time.
 * Returns the BullMQ job ID for cancellation.
 */
export async function enqueueScheduledMessageJob(
  data: SendScheduledMessageJobData,
  scheduledAt: Date
): Promise<string> {
  // Dynamic imports to avoid circular dependencies
  const { getQueue } = await import('../jobs/queues')
  const { Queues } = await import('../jobs/queues/types')

  const queue = getQueue(Queues.messageProcessingQueue)
  const delay = Math.max(scheduledAt.getTime() - Date.now(), 0)

  const job = await queue.add('sendScheduledMessageJob', data, {
    delay,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    jobId: `scheduled-msg-${data.scheduledMessageId}`,
    removeOnComplete: true,
    removeOnFail: false,
  })

  return job.id!
}
