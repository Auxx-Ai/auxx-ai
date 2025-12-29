import { database as db, schema } from '@auxx/database'
import type { ShopifyIntegrationEntity } from '@auxx/database/models'
// import { extractShopifyId } from '.'
import { WEBHOOK_FORMAT, WEBHOOK_TOPIC, webhookSchema } from './shopify-types'
import { UserSettingsService } from '../settings'
import { env } from '@auxx/config/server'
import { createScopedLogger } from '@auxx/logger'
import { createAdminApiClient } from '@shopify/admin-api-client'
import { extractShopifyId } from './utils'
import { eq, and } from 'drizzle-orm'

const WEBHOOK_PROVIDER = 'shopify'
const logger = createScopedLogger('webhooks/setup')

const findSubscription = async (provider: string, topic: string, integrationId: string) => {
  const [subscription] = await db
    .select()
    .from(schema.Subscription)
    .where(
      and(
        eq(schema.Subscription.provider, provider),
        eq(schema.Subscription.topic, topic),
        eq(schema.Subscription.integrationId, integrationId)
      )
    )
    .limit(1)
  return subscription || null
}

export function createShopifyAdminClient(
  integration: Pick<ShopifyIntegrationEntity, 'shopDomain' | 'accessToken'>
) {
  try {
    // Get the integration details for the shop from the database
    logger.info('Creating Shopify admin client for shop')

    // Validate integration data
    if (!integration.shopDomain || !integration.accessToken) {
      throw new Error('Missing required integration properties: shopDomain or accessToken')
    }

    // Create a new admin client with the access token
    const client = createAdminApiClient({
      storeDomain: integration.shopDomain,
      apiVersion: '2025-04',
      accessToken: integration.accessToken,
    })

    return client
  } catch (error) {
    logger.error('Error creating Shopify admin client:', { error })
    throw error
  }
}
export type ShopifyAdminClient = ReturnType<typeof createShopifyAdminClient>

export const autoSyncShopify = async (userId: string, organizationId: string) => {
  const autoSync = await UserSettingsService.get(userId, 'shopify.autoSync')

  const [integration] = await db
    .select({
      id: schema.ShopifyIntegration.id,
      shopDomain: schema.ShopifyIntegration.shopDomain,
      accessToken: schema.ShopifyIntegration.accessToken,
    })
    .from(schema.ShopifyIntegration)
    .where(
      and(
        eq(schema.ShopifyIntegration.organizationId, organizationId),
        eq(schema.ShopifyIntegration.enabled, true)
      )
    )
    .limit(1)
  if (!integration) {
    logger.error('No active Shopify integration found for organization', { organizationId })
    return
  }

  const client = createShopifyAdminClient(integration)
  const integrationId = integration.id

  if (autoSync) {
    logger.info('Setup Webhooks for: ', { integrationId })
    await setupShopifyWebhooks(integrationId)
  } else {
    logger.info('Disable webhooks')
    disableWebhooks(userId)
  }
  //gid://shopify/WebhookSubscription/1316957520048

  // await setupShopifyWebhooks(userId)
}

export const setupShopifyWebhooks = async (integrationId: string) => {
  const topics = [
    WEBHOOK_TOPIC.CUSTOMERS_CREATE,
    WEBHOOK_TOPIC.CUSTOMERS_UPDATE,
    WEBHOOK_TOPIC.ORDERS_CREATE,
    WEBHOOK_TOPIC.ORDERS_UPDATED,
    WEBHOOK_TOPIC.PRODUCTS_CREATE,
    WEBHOOK_TOPIC.PRODUCTS_UPDATE,
  ]

  const [integration] = await db
    .select({
      id: schema.ShopifyIntegration.id,
      organizationId: schema.ShopifyIntegration.organizationId,
      accessToken: schema.ShopifyIntegration.accessToken,
      shopDomain: schema.ShopifyIntegration.shopDomain,
      enabled: schema.ShopifyIntegration.enabled,
    })
    .from(schema.ShopifyIntegration)
    .where(eq(schema.ShopifyIntegration.id, integrationId))
    .limit(1)
  if (!integration) {
    logger.error('No active Shopify integration found for integrationId', { integrationId })
    throw new Error('No active Shopify integration found')
  }

  const client = createShopifyAdminClient(integration)

  const results = topics.map(async (topic) => {
    return await createWebhook({
      topic,
      callbackUrl: `${env.NEXT_PUBLIC_APP_URL}/api/shopify/webhook?integrationId=${integrationId}`,
      integrationId,
      organizationId: integration.organizationId,
      client,
    })
  })

  return await Promise.all(results)
}

export const disableWebhooks = async (integrationId: string) => {
  const topics = [
    WEBHOOK_TOPIC.CUSTOMERS_CREATE,
    WEBHOOK_TOPIC.CUSTOMERS_UPDATE,
    WEBHOOK_TOPIC.ORDERS_CREATE,
    WEBHOOK_TOPIC.ORDERS_UPDATED,
    WEBHOOK_TOPIC.PRODUCTS_CREATE,
    WEBHOOK_TOPIC.PRODUCTS_UPDATE,
  ]
  const results = topics.map(async (topic) => {
    return await deleteWebhook({ provider: WEBHOOK_PROVIDER, topic, integrationId })
  })
}
export const createWebhook = async ({
  topic,
  callbackUrl,
  format = WEBHOOK_FORMAT.JSON,
  integrationId,
  organizationId,
  client,
}: {
  topic: WEBHOOK_TOPIC
  callbackUrl: string
  format?: WEBHOOK_FORMAT
  integrationId: string
  organizationId: string
  client: ReturnType<typeof createShopifyAdminClient>
}) => {
  const provider = WEBHOOK_PROVIDER

  const subTopic = topic.toString()
  const exists = await findSubscription(WEBHOOK_PROVIDER, topic, integrationId)

  logger.info('createWebhook', { subTopic, integrationId, exists })
  if (exists && exists.active) {
    logger.error('Webhook already exists and is active', { subTopic, integrationId })
    throw new Error('Webhook already exists and is active')
  }

  const result = await client.request(createWebhookGraphQL, {
    variables: { topic, webhookSubscription: { callbackUrl, format } },
  })

  const providerId = result?.data?.webhookSubscriptionCreate?.webhookSubscription?.id as string
  if (!providerId) {
    logger.error('Failed to create webhook')
    throw new Error('Failed to create webhook')
  }

  const [subscription] = await db
    .insert(schema.Subscription)
    .values({
      topic: subTopic,
      format: format.toString(),
      provider,
      providerId,
      integrationId,
      organizationId,
      active: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.Subscription.provider,
        schema.Subscription.integrationId,
        schema.Subscription.topic,
      ],
      set: {
        active: true,
        providerId: providerId,
      },
    })
    .returning({ id: schema.Subscription.id })

  return subscription
}

export const deleteWebhook = async ({
  provider = WEBHOOK_PROVIDER,
  topic,
  integrationId,
}: {
  provider: string
  topic: string
  integrationId: string
}) => {
  const subscription = await findSubscription(provider, topic, integrationId)
  logger.info('Delete webhook', { provider, topic, integrationId })

  if (!subscription) {
    logger.error('Subscription not found', { provider, topic, integrationId })
    return
    // throw new Error('Subscription not found')
  }
  const gid = subscription.providerId

  const [integration] = await db
    .select({
      id: schema.ShopifyIntegration.id,
      shopDomain: schema.ShopifyIntegration.shopDomain,
      accessToken: schema.ShopifyIntegration.accessToken,
    })
    .from(schema.ShopifyIntegration)
    .where(eq(schema.ShopifyIntegration.id, integrationId))
    .limit(1)
  if (!integration) {
    logger.error('No active Shopify integration found for integrationId', { integrationId })
    throw new Error('No active Shopify integration found')
  }
  const client = createShopifyAdminClient(integration)

  // const gid = `gid://shopify/WebhookSubscription/${id}`
  const result = await client.request(deleteWebhookGraphQl, { variables: { id: gid } })

  if (result?.data?.webhookSubscriptionDelete?.userErrors?.length) {
    throw new Error(result?.data?.webhookSubscriptionDelete?.userErrors[0]?.message)
  }

  const [updatedSubscription] = await db
    .update(schema.Subscription)
    .set({ active: false })
    .where(eq(schema.Subscription.id, subscription.id))
    .returning()
  return updatedSubscription
}
type WebhookShopifyNode = {
  node: {
    id: number | null
    createdAt: Date
    updatedAt: Date
    callbackUrl?: string
    endpoint?: {
      callbackUrl: string
    }
  }
}
export const processWebhooks = (response: any) => {
  const result = response.data.webhookSubscriptions.edges.map((w: WebhookShopifyNode) => {
    w.node.id = extractShopifyId(w.node.id)
    w.node.createdAt = new Date(w.node.createdAt)
    w.node.updatedAt = new Date(w.node.updatedAt)
    w.node.callbackUrl = w.node?.endpoint?.callbackUrl
    delete w.node.endpoint

    return w.node
  }) as (typeof webhookSchema)[]
  return result
}

export const getWebhooksGraphQL = `#graphql
query {
  webhookSubscriptions(first: 100) {
    edges {
      node {
        id
        topic
        format
        createdAt
        updatedAt
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
          ... on WebhookEventBridgeEndpoint {
            arn
          }
          ... on WebhookPubSubEndpoint {
            pubSubProject
            pubSubTopic
          }
        }
      }
    }
  }
}`

export const createWebhookGraphQL = `#graphql
mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription {
          id
          topic
          apiVersion {
            handle
          }
          format
          createdAt
        }
        userErrors {
          field
          message
        }
      }
}`

export const deleteWebhookGraphQl = `#graphql
  mutation webhookSubscriptionDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      userErrors {
        field
        message
      }
      deletedWebhookSubscriptionId
    }
}`
