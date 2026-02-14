import { database as db } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import { WebhookEventModel } from '@auxx/database/models'
import { fetchCustomer, upsertCustomer } from '@auxx/lib/shopify'
import type { Job } from 'bullmq'
import {
  getWebhookDataAndStart,
  shopifyWebhookLogger as logger,
  type WebhookJobDataProps,
} from './utils'
export const customerWebhookJob = async (job: Job<WebhookJobDataProps>) => {
  const webhook = await getWebhookDataAndStart(job)
  if (!webhook) {
    return
  }
  const { client, webhookEvent } = webhook
  const data = JSON.parse(webhookEvent.payload)
  const customer = await fetchCustomer(data.admin_graphql_api_id, client)
  try {
    await upsertCustomer(db, customer, 0, webhookEvent.organizationId, webhookEvent.integrationId)
    const weModel = new WebhookEventModel(webhookEvent.organizationId)
    await weModel.update(webhookEvent.id, {
      status: SYNC_STATUS.COMPLETED as any,
      endTime: new Date() as any,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Error upserting customer', { msg })
    const weModel = new WebhookEventModel(webhookEvent.organizationId)
    await weModel.update(webhookEvent.id, { status: SYNC_STATUS.FAILED as any, error: msg as any })
  }
}
