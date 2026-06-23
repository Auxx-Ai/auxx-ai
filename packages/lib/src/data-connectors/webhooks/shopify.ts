// packages/lib/src/data-connectors/webhooks/shopify.ts
// Shopify webhook capability (Step 8). The read path (verify / event-id / topic→action)
// is declared as data in `shopifySpec` and compiled into the capability; only the
// registration half — webhookSubscriptionCreate/Delete over the Admin GraphQL API — is
// coded here, because GraphQL construction + shop auth is genuinely provider-specific.

import { createScopedLogger } from '@auxx/logger'
import type { RuntimeConnectionData } from '../../connections/resolve-connection-for-runtime'
import { compileWebhookSpec, shopifySpec } from '../../webhooks/inbound'
import type {
  WebhookCapability,
  WebhookRegisterInput,
  WebhookSubscription,
  WebhookUnregisterInput,
} from '../types'

const logger = createScopedLogger('data-connector-webhook-shopify')

/** Shopify Admin API version pinned for webhook registration calls. */
const SHOPIFY_API_VERSION = '2024-10'

/** Default topics a Shopify connector subscribes —  is the load-bearing one. */
const DEFAULT_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/delete',
  'products/create',
  'products/update',
  'products/delete',
  'customers/create',
  'customers/update',
  'customers/delete',
]

/** Shopify topic `orders/delete` → enum `ORDERS_DELETE` for the GraphQL API. */
function topicToGraphqlEnum(topic: string): string {
  return topic.replace(/[/]/g, '_').toUpperCase()
}

/** Resolve the shop origin + admin token from the resolved credential. */
function shopAuth(
  credential: RuntimeConnectionData | null
): { origin: string; token: string } | null {
  const origin = credential?.baseUrl
  const token = credential?.value
  if (!origin || !token) return null
  return { origin: origin.replace(/\/$/, ''), token }
}

async function shopifyGraphql(
  credential: RuntimeConnectionData | null,
  query: string,
  variables: Record<string, unknown>
): Promise<any> {
  const auth = shopAuth(credential)
  if (!auth) throw new Error('Shopify webhook: missing shop origin or admin token on credential')
  const res = await fetch(`${auth.origin}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shopify-access-token': auth.token,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify webhook API ${res.status}: ${await res.text()}`)
  return res.json()
}

async function shopifyRegister(input: WebhookRegisterInput): Promise<WebhookSubscription[]> {
  const topics = input.topics.length > 0 ? input.topics : DEFAULT_TOPICS
  const mutation = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }`
  const subs: WebhookSubscription[] = []
  for (const topic of topics) {
    try {
      const json = await shopifyGraphql(input.credential, mutation, {
        topic: topicToGraphqlEnum(topic),
        sub: { callbackUrl: input.callbackUrl, format: 'JSON' },
      })
      const result = json?.data?.webhookSubscriptionCreate
      const id = result?.webhookSubscription?.id
      if (id) {
        subs.push({ topic, externalId: id })
      } else {
        logger.warn('Shopify webhook subscribe returned no id', {
          topic,
          userErrors: result?.userErrors,
        })
      }
    } catch (error) {
      logger.warn('Shopify webhook subscribe failed', {
        topic,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return subs
}

async function shopifyUnregister(input: WebhookUnregisterInput): Promise<void> {
  const mutation = `
    mutation webhookSubscriptionDelete($id: ID!) {
      webhookSubscriptionDelete(id: $id) { userErrors { field message } }
    }`
  for (const id of input.externalIds) {
    try {
      await shopifyGraphql(input.credential, mutation, { id })
    } catch (error) {
      logger.warn('Shopify webhook unsubscribe failed', {
        id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export const shopifyWebhookCapability: WebhookCapability = compileWebhookSpec(shopifySpec, {
  topics: DEFAULT_TOPICS,
  register: shopifyRegister,
  unregister: shopifyUnregister,
})
