import { database as db } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import { WebhookEventModel } from '@auxx/database/models'
import type { Job } from 'bullmq'
import { fetchProduct, upsertProduct } from '../../shopify/sync-products'
import {
  getWebhookDataAndStart,
  shopifyWebhookLogger as logger,
  type WebhookJobDataProps,
} from './utils'
export const productWebhookJob = async (job: Job<WebhookJobDataProps>) => {
  const webhook = await getWebhookDataAndStart(job)
  if (!webhook) {
    return
  }
  const { client, webhookEvent } = webhook
  try {
    const data = JSON.parse(webhookEvent.payload)
    const product = await fetchProduct(data.admin_graphql_api_id, client)
    await upsertProduct(db, product, 0, webhookEvent.organizationId, webhookEvent.integrationId)
    const weModel = new WebhookEventModel(webhookEvent.organizationId)
    await weModel.update(webhookEvent.id, {
      status: SYNC_STATUS.COMPLETED as any,
      endTime: new Date() as any,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Error upserting product', { msg })
    const weModel = new WebhookEventModel(webhookEvent.organizationId)
    await weModel.update(webhookEvent.id, { status: SYNC_STATUS.FAILED as any, error: msg as any })
  }
}
