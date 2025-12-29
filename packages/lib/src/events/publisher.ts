import { type AuxxEvent } from './types'
import { getQueue } from '../jobs/queues'
import { Queues } from '../jobs/queues/types'

/**
 * Responsible for publishing events to the event bus and webhooks
 * publisher.publishLater(event) will add the event to the queue for processing
 * This function is called from many services to handle long running tasks.
 *
 * createEventJob is responsible for creating the event in the database
 * publishEventJob is responsible for publishing the event to the event bus
 * publishToAnalyticsJob is responsible for publishing the event to the analytics service (posthog)
 * processWebhookJob is responsible for processing outgoing webhooks for the event:
 *  - it will find all webhooks that are subscribed to the event type
 *  - it will send the event to the webhook
 *  - See `process-webhook-job.ts` for more details
 */
export const publisher = {
  publishLater: async (event: AuxxEvent) => {
    const eventsQueue = getQueue(Queues.eventsQueue)
    const webhooksQueue = getQueue(Queues.webhooksQueue)

    eventsQueue.add('createEventJob', event)
    eventsQueue.add('publishEventJob', event)
    eventsQueue.add('publishToAnalyticsJob', event)

    webhooksQueue.add('processWebhookJob', event)
  },
}
