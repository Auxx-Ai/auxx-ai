import type { Job } from 'bullmq'
import { WebhookModel } from '@auxx/database/models'
import { AuxxEvent, Events } from '../../events/types'
import { WebhookService } from '../../webhooks/webhook-service'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('webhook-jobs')

const WEBHOOK_EVENTS: Array<Events> = ['user:created', 'project:created']

export type ProcessSingleWebhookJobData = { event: any; webhookId: string; organizationId: string }

export const processSingleWebhookJob = async (job: Job<ProcessSingleWebhookJobData>) => {
  const { event, webhookId, organizationId } = job.data
  logger.info(`Processing webhook job for event: ${event.type} and webhookId: ${webhookId}`)
  const webhookService = new WebhookService(organizationId)
  // Get the webhook and event
  const model = new WebhookModel()
  const res = await model.findActiveByIdGlobal(webhookId)
  const webhook = res.ok ? res.value : null

  if (!webhook || !webhook.isActive) {
    logger.error(`Webhook not found or inactive: ${webhookId}`)
    throw new Error(`Webhook not found or inactive: ${webhookId}`)
  }

  // Extract projectId from the event
  // const projectId = fetchProjectIdFromEvent(event as AuxxEvent)
  // if (!projectId) {
  //   throw new Error(`No project id found in event ${event.type}`)
  // }

  // // Check if the webhook has project filters and if the event's projectId matches
  // if (
  //   webhook.projectIds &&
  //   webhook.projectIds.length > 0 &&
  //   !webhook.projectIds.includes(projectId)
  // ) {
  //   // Skip this webhook as it doesn't match the project filter
  //   return
  // }
  // webhook.eventTypes.includes(event.type as Events)

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
    // logger.info(`Webhook sent successfully:`, { result })
    if (!result.ok) {
      logger.error(`Error sending fdssdf:`)
      // logger.error(`Error sending webhook:`, { error: result.error })
      // throw result.error
    }
    const response = result.unwrap()
    if (!response) {
      logger.error(`no response:`)

      // throw new Error('No response received from webhook')
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

// function fetchProjectIdFromEvent(event: LatitudeEvent) {
//   if (!WEBHOOK_EVENTS.includes(event.type as Events)) {
//     return
//   }

//   switch (event.type) {
//     case 'commitPublished':
//       return event.data.commit.projectId
//     default:
//       return
//   }
// }
