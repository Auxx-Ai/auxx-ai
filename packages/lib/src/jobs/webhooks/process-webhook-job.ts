// packages/lib/src/jobs/webhooks/process-webhook-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { AuxxEvent } from '../../events'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'
import { isWebhookEvent, WEBHOOK_EVENTS } from './webhook-events'

const logger = createScopedLogger('webhook-jobs')

// The list lives in the leaf `webhook-events.ts`; re-exported here so existing
// `@auxx/lib/jobs` imports keep resolving.
export { WEBHOOK_EVENTS }

export async function processWebhookJob({ data: event }: { data: AuxxEvent }) {
  if (!('organizationId' in event.data) || !event.data.organizationId) {
    logger.debug(`Skipping webhook event: ${event.type}. No organizationId found in event data.`)
    return // Skip silently as this is an expected condition
  }
  if (!isWebhookEvent(event.type)) {
    logger.debug(`Skipping webhook event: ${event.type}. Not in the list of supported events.`)
    return // Skip silently as this is an expected condition
  }

  const activeWebhooks = await database
    .select()
    .from(schema.Webhook)
    .where(
      and(
        eq(schema.Webhook.organizationId, event.data.organizationId),
        eq(schema.Webhook.isActive, true)
      )
    )

  const webhooksQueue = getQueue(Queues.webhooksQueue)
  // Enqueue a job for each webhook
  await Promise.all(
    activeWebhooks.map((webhook) => {
      webhooksQueue.add('processSingleWebhookJob', { event, webhookId: webhook.id })
    })
  )
}
