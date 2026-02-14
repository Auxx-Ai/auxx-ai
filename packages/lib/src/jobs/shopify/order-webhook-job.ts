import { database as db } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import { WebhookEventModel } from '@auxx/database/models'
import { fetchOrder, upsertOrder } from '@auxx/lib/shopify'
import type { Job } from 'bullmq'
import {
  getWebhookDataAndStart,
  shopifyWebhookLogger as logger,
  type WebhookJobDataProps,
} from './utils'
export const orderWebhookJob = async (job: Job<WebhookJobDataProps>) => {
  const webhook = await getWebhookDataAndStart(job)
  if (!webhook) {
    return
  }
  const { client, webhookEvent } = webhook
  const data = JSON.parse(webhookEvent.payload)
  // const userId = webhookEvent.userId
  const order = await fetchOrder(data.admin_graphql_api_id, client)
  const { organizationId, integrationId } = webhookEvent
  try {
    await upsertOrder(db, order, 0, organizationId, integrationId)
    const weModel = new WebhookEventModel(webhookEvent.organizationId)
    await weModel.update(webhookEvent.id, {
      status: SYNC_STATUS.COMPLETED as any,
      endTime: new Date() as any,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Error upserting order', { msg })
    const weModel = new WebhookEventModel(webhookEvent.organizationId)
    await weModel.update(webhookEvent.id, { status: SYNC_STATUS.FAILED as any, error: msg as any })
  }
}
