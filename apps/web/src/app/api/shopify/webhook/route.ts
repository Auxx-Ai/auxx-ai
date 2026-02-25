import { configService } from '@auxx/credentials'
import {
  ShopifyIntegrationModel,
  SubscriptionModel,
  WebhookEventModel,
} from '@auxx/database/models'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import {
  deleteWebhook,
  SHOPIFY_WEBHOOK_EVENTS,
  type ShopifyWebhookEventKey,
  WEBHOOK_TOPIC,
} from '@auxx/lib/shopify'
import { createScopedLogger } from '@auxx/logger'
import { createHmac } from 'crypto'
import type { NextRequest } from 'next/server'

const logger = createScopedLogger('shopify/webhook')

export const POST = async (req: NextRequest) => {
  logger.info('Shopify Webhook POST request received')
  const query = req.nextUrl.searchParams

  //   logger.info(`query: ${query}`)
  const integrationId = query.get('integrationId') as string
  // const userId = query.get('userId') as string
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256') as string
  // const shopDomain = req.headers.get('x-shopify-shop-domain') as string // storage-system.myshopify.com
  const topic = req.headers.get('x-shopify-topic') as ShopifyWebhookEventKey // products/update
  const eventId = req.headers.get('x-shopify-event-id') as string // will stay the same for each event, you can track how often the same webhook was called
  // x-shopify-product-id: 6732273909936
  // x-shopify-api-version: 2025-01
  // x-shopify-triggered-at: 2025-03-11T20:54:30.516267807Z
  // x-shopify-webhook-id: e8d56838-1314-4d40-b0f4-f28c555feeed
  const dbTopic = SHOPIFY_WEBHOOK_EVENTS[topic]

  const shopifySecret = configService.get<string>('SHOPIFY_API_SECRET') as string

  const headers: Record<string, string> = {}
  for (const [key, value] of req.headers.entries()) {
    headers[key] = value
  }

  const sim = new ShopifyIntegrationModel()
  const intRes = await sim.findByIdGlobal(integrationId)
  const integration = intRes.ok && intRes.value?.enabled ? intRes.value : null

  // const user = await db.user.findFirst({
  //   where: { id: userId },
  //   select: { id: true },
  // })

  if (!integration) {
    logger.error('Integration not found', { integrationId })
    deleteWebhook({ topic: dbTopic, integrationId, provider: 'shopify' })
    return new Response(null, { status: 200 })
  }

  // const body = await getRequestBody(req)
  const body = await req.text()
  const subModel = new SubscriptionModel()
  const subRes = await subModel.findByProviderIntegrationTopicGlobal({
    provider: 'shopify',
    integrationId,
    topic: dbTopic,
  })
  const subscription = subRes.ok ? (subRes.value as any) : null

  if (!subscription) {
    logger.info('subscription not found', { provider: 'shopify', integrationId, dbTopic, topic })
    return new Response(null, { status: 200 })
  } else {
    logger.info(`Subscription found: ${subscription.id}`)
  }

  const weModel = new WebhookEventModel(subscription.organizationId)
  const createRes = await weModel.create({
    payload: body as any,
    headers: JSON.stringify(headers) as any,
    eventId: eventId as any,
    topic: dbTopic as any,
    subscriptionId: subscription.id as any,
    integrationId: integrationId as any,
  } as any)
  const event = createRes.ok ? ({ id: createRes.value.id } as any) : null
  if (event) {
    logger.info('subscription event created:', { eventId: event.id })
  } else {
    logger.info('Unable to create subscription event:')
  }
  const calculatedHmac = createHmac('sha256', shopifySecret).update(body).digest('base64')

  logger.info('Received webhook:', { shopifySecret, calculatedHmac, hmacHeader })

  if (calculatedHmac !== hmacHeader) {
    logger.error(`hmacHeaders don't match`)
    return new Response(null, { status: 401 })
  }

  const webhookEventData = {
    webhookEventId: event.id,
    organizationId: subscription.organizationId,
    integrationId,
  }
  const shopifyQueue = getQueue(Queues.shopifyQueue)
  switch (dbTopic) {
    case WEBHOOK_TOPIC.PRODUCTS_CREATE:
    case WEBHOOK_TOPIC.PRODUCTS_UPDATE:
      logger.info('try to create/update product')
      await shopifyQueue.add('productWebhookJob', webhookEventData)
      break
    case WEBHOOK_TOPIC.ORDERS_CREATE:
    case WEBHOOK_TOPIC.ORDERS_UPDATED:
      logger.info('try to create/update order')
      await shopifyQueue.add('orderWebhookJob', webhookEventData)
      break

    case WEBHOOK_TOPIC.CUSTOMERS_CREATE:
    case WEBHOOK_TOPIC.CUSTOMERS_UPDATE:
      logger.info('try to create/update customer')
      await shopifyQueue.add('customerWebhookJob', webhookEventData)
      break
    default:
      logger.info(`No topic matched for webhook: ${dbTopic}`)
  }

  return new Response(null, { status: 200 })
}
