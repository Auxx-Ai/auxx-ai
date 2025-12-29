// import { webhooks } from '../../../schema/models/webhooks'

import { WebhookModel } from '@auxx/database/models'
import { AuxxEvent, Events } from '../../events'
import { getQueue } from '../queues'
import { createScopedLogger } from '@auxx/logger'
import { Queues } from '../queues/types'

const logger = createScopedLogger('webhook-jobs')

export const WEBHOOK_EVENTS: Array<Events> = [
  'user:created',
  'project:created',
  'membership:created',
  'ticket:created',
  'ticket:updated',
  'ticket:deleted',
  'ticket:status:changed',
  'ticket:assignee:added',
  'ticket:assignee:removed',
  'ticket:reply:created',

  // message events
  'message:received',
  'message:sent',
  'message:failed',
  'message:comment:created',
  'message:assignee:changed',
  'message:tag:added',
  'message:tag:removed',

  // thread events
  'thread:moved',
  'thread:archived',
  'thread:deleted',
  'thread:reopened',
  'thread:restored',

  // workflow events
  'workflow:paused',
  'workflow:resumed',
  'workflow:resume:failed',
]

export async function processWebhookJob({ data: event }: { data: AuxxEvent }) {
  if (!('organizationId' in event.data) || !event.data.organizationId) {
    logger.debug(`Skipping webhook event: ${event.type}. No organizationId found in event data.`)
    return // Skip silently as this is an expected condition
  }
  if (!WEBHOOK_EVENTS.includes(event.type as Events)) {
    logger.debug(`Skipping webhook event: ${event.type}. Not in the list of supported events.`)
    return // Skip silently as this is an expected condition
  }
  // // Get all active webhooks for the org

  const model = new WebhookModel(event.data.organizationId)
  const res = await model.listActive()
  if (!res.ok) return
  const activeWebhooks = res.value

  const webhooksQueue = getQueue(Queues.webhooksQueue)
  // // Enqueue a job for each webhook
  await Promise.all(
    activeWebhooks.map((webhook) => {
      webhooksQueue.add('processSingleWebhookJob', { event, webhookId: webhook.id })
    })
  )
}
