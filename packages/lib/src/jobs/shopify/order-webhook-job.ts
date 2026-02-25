// packages/lib/src/jobs/shopify/order-webhook-job.ts

import { database as db, schema } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { fetchOrder, upsertOrder } from '../../shopify/sync-orders'
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
  const order = await fetchOrder(data.admin_graphql_api_id, client)
  const { organizationId, integrationId } = webhookEvent
  try {
    await upsertOrder(db, order, 0, organizationId, integrationId)
    await db
      .update(schema.WebhookEvent)
      .set({ status: SYNC_STATUS.COMPLETED, endTime: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.WebhookEvent.id, webhookEvent.id),
          eq(schema.WebhookEvent.organizationId, webhookEvent.organizationId)
        )
      )
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Error upserting order', { msg })
    await db
      .update(schema.WebhookEvent)
      .set({ status: SYNC_STATUS.FAILED, error: msg, updatedAt: new Date() })
      .where(
        and(
          eq(schema.WebhookEvent.id, webhookEvent.id),
          eq(schema.WebhookEvent.organizationId, webhookEvent.organizationId)
        )
      )
  }
}
