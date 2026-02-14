import { database as db, schema } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'
import { createShopifyAdminClient, type ShopifyAdminClient } from '../../shopify'

const logger = createScopedLogger('shopify-webhook')
export const shopifyWebhookLogger = logger
export type WebhookJobDataProps = {
  webhookEventId: string
  organizationId: string
  integrationId: string
}
type WebhookEvent = {
  id: string
  payload: any
  integrationId: string
  organizationId: string
  headers: any
  status: string
  subscription: {
    id: string
    topic: string
    provider: string
  } | null
}
export const getWebhookDataAndStart = async (
  job: Job<WebhookJobDataProps>
): Promise<
  | {
      client: ShopifyAdminClient
      webhookEvent: WebhookEvent
    }
  | undefined
> => {
  const { webhookEventId, organizationId, integrationId } = job.data
  const [integration] = await db
    .select({
      id: schema.ShopifyIntegration.id,
      shopDomain: schema.ShopifyIntegration.shopDomain,
      accessToken: schema.ShopifyIntegration.accessToken,
      enabled: schema.ShopifyIntegration.enabled,
    })
    .from(schema.ShopifyIntegration)
    .where(
      and(
        eq(schema.ShopifyIntegration.id, integrationId),
        eq(schema.ShopifyIntegration.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!integration) {
    throw new Error('No active Shopify integration found')
  }
  const client = createShopifyAdminClient(integration) as ShopifyAdminClient
  const [webhookEventData] = await db
    .select({
      webhookEvent: {
        id: schema.WebhookEvent.id,
        payload: schema.WebhookEvent.payload,
        integrationId: schema.WebhookEvent.integrationId,
        organizationId: schema.WebhookEvent.organizationId,
        headers: schema.WebhookEvent.headers,
        status: schema.WebhookEvent.status,
      },
      subscription: {
        id: schema.WebhookSubscription.id,
        topic: schema.WebhookSubscription.topic,
        provider: schema.WebhookSubscription.provider,
      },
    })
    .from(schema.WebhookEvent)
    .leftJoin(
      schema.WebhookSubscription,
      eq(schema.WebhookSubscription.id, schema.WebhookEvent.subscriptionId)
    )
    .where(eq(schema.WebhookEvent.id, webhookEventId))
    .limit(1)
  const webhookEvent: WebhookEvent | null = webhookEventData
    ? {
        ...webhookEventData.webhookEvent,
        subscription: webhookEventData.subscription,
      }
    : null
  if (!client || !webhookEvent) {
    logger.error('No client or webhook event found')
    return
  }
  const [result] = await db
    .update(schema.WebhookEvent)
    .set({ status: SYNC_STATUS.IN_PROGRESS, startTime: new Date() })
    .where(eq(schema.WebhookEvent.id, webhookEvent.id))
    .returning()
  if (!result) {
    logger.error('webhook event failed to update')
    return
  }
  return { client, webhookEvent }
}
