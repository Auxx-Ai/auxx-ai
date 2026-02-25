// packages/lib/src/jobs/webhooks/process-single-webhook-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import type { AuxxEvent, Events } from '../../events/types'
import { WebhookService } from '../../webhooks/webhook-service'

const logger = createScopedLogger('webhook-jobs')

const WEBHOOK_EVENTS: Array<Events> = ['user:created', 'project:created']

export type ProcessSingleWebhookJobData = { event: any; webhookId: string; organizationId: string }

export const processSingleWebhookJob = async (job: Job<ProcessSingleWebhookJobData>) => {
  const { event, webhookId, organizationId } = job.data
  logger.info(`Processing webhook job for event: ${event.type} and webhookId: ${webhookId}`)
  const webhookService = new WebhookService(organizationId)

  const [webhook] = await database
    .select()
    .from(schema.Webhook)
    .where(and(eq(schema.Webhook.id, webhookId), eq(schema.Webhook.isActive, true)))
    .limit(1)

  if (!webhook || !webhook.isActive) {
    logger.error(`Webhook not found or inactive: ${webhookId}`)
    throw new Error(`Webhook not found or inactive: ${webhookId}`)
  }

  // Create webhook payload
  const payload = await webhookService.processPayload(event as AuxxEvent).then((r) => r.unwrap())
  logger.info(`Webhook payload:`, { payload })
  try {
    // Send signed webhook
    const result = await webhookService.sendSignedWebhook({
      url: webhook.url,
      secret: webhook.secret,
      payload,
    })
    if (!result.ok) {
      logger.error(`Error sending fdssdf:`)
    }
    const response = result.unwrap()
    if (!response) {
      logger.error(`no response:`)
    }
    logger.info(`store :`, { result })

    // Create delivery record
    await webhookService.storeDelivery({
      webhookId: webhook.id,
      eventType: event.type as Events,
      status: response.success ? 'success' : 'failed',
      responseStatus: response.statusCode,
      responseBody: response.responseBody,
      errorMessage: response.error?.message,
    })
  } catch (error) {
    logger.error(`Error sending webhook:`, { error })
    // Create failed delivery record
    await webhookService.storeDelivery({
      webhookId: webhook.id,
      eventType: event.type as Events,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
