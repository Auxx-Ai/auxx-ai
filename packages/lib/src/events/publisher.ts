// packages/lib/src/events/publisher.ts

import { createScopedLogger } from '@auxx/logger'
import { getQueue } from '../jobs/queues'
import { Queues } from '../jobs/queues/types'
import { isWebhookEvent } from '../jobs/webhooks/webhook-events'
import type { AuxxEvent } from './types'

const logger = createScopedLogger('events:publisher')

/**
 * Responsible for publishing events to the event bus and webhooks
 * publisher.publishLater(event) will add the event to the queue for processing
 * This function is called from many services to handle long running tasks.
 *
 * publishEventJob is the single fan-out on the events queue: it persists the
 * Event row, captures analytics (posthog) and then enqueues one job per handler
 * in `EventHandlers[type]`. See `publish-event-job.ts`.
 * processWebhookJob is enqueued on the webhooks queue only for types a webhook
 * can subscribe to (`WEBHOOK_EVENTS`):
 *  - it will find all webhooks that are subscribed to the event type
 *  - it will send the event to the webhook
 *  - See `process-webhook-job.ts` for more details
 */
export const publisher = {
  publishLater: async (event: AuxxEvent) => {
    const eventsQueue = getQueue(Queues.eventsQueue)

    // One awaited round-trip per queue. Errors are logged, not thrown:
    // many callers fire-and-forget and must not get unhandled rejections.
    try {
      await Promise.all([
        eventsQueue.add('publishEventJob', event),
        isWebhookEvent(event.type)
          ? getQueue(Queues.webhooksQueue).add('processWebhookJob', event)
          : undefined,
      ])
    } catch (error) {
      logger.error('Failed to enqueue event', {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
}
