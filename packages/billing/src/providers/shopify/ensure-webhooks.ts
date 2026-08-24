// packages/billing/src/providers/shopify/ensure-webhooks.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { configService } from '@auxx/credentials'
import { getAppConnection } from '@auxx/credentials/connections'
import { createScopedLogger } from '@auxx/logger'
import { credentialLock } from '../../credential-lock'
import { createShopifyAdminClient } from './client'

const logger = createScopedLogger('billing/shopify/ensure-webhooks')

/**
 * The billing topics the app depends on for near-real-time plan sync. Registered per shop
 * because the app uses `use_legacy_install_flow`, and Shopify rejects app-specific
 * (toml-declared) webhook subscriptions in that mode — shop-scoped subscriptions via the
 * Admin API are the supported alternative.
 */
const BILLING_TOPICS = ['APP_SUBSCRIPTIONS_UPDATE', 'APP_UNINSTALLED'] as const

const LIST_QUERY = `#graphql
  query BillingWebhookSubscriptions {
    webhookSubscriptions(first: 50, topics: [APP_SUBSCRIPTIONS_UPDATE, APP_UNINSTALLED]) {
      edges { node { id topic uri } }
    }
  }
`

const CREATE_MUTATION = `#graphql
  mutation BillingWebhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`

/** The endpoint Shopify delivers billing webhooks to (HMAC-verified by the route). */
function billingWebhookUri(): string {
  const base = process.env.NGROK_URL || WEBAPP_URL
  return `${base}/api/apps/shopify/billing-webhook`
}

/**
 * Idempotently registers the shop-scoped billing webhook subscriptions
 * (`app_subscriptions/update`, `app/uninstalled`) for one shop, using the org's stored
 * app access token. Skips topics already subscribed at the current callback URI, so it is
 * safe to call on every install finalize and sync-job tick. Throws on Admin API failure —
 * callers log and continue, since the 15-minute poll still backstops a missed
 * registration.
 */
export async function ensureBillingWebhooks(input: {
  shopDomain: string
  organizationId: string
}): Promise<{ created: string[] }> {
  const appId = configService.get<string>('SHOPIFY_APP_ID')
  if (!appId) throw new Error('SHOPIFY_APP_ID must be configured')

  const conn = await getAppConnection(appId, input.organizationId, '', { lock: credentialLock })
  if (conn.isErr()) throw conn.error
  const accessToken = conn.value.accessToken
  if (!accessToken) throw new Error('Shopify connection has no access token')

  const client = createShopifyAdminClient({ shopDomain: input.shopDomain, accessToken })
  const uri = billingWebhookUri()

  const listRes = (await client.request(LIST_QUERY)) as {
    data?: { webhookSubscriptions?: { edges?: Array<{ node: { topic: string; uri: string } }> } }
    errors?: unknown
  }
  if (listRes.errors) {
    throw new Error(`webhookSubscriptions query failed: ${JSON.stringify(listRes.errors)}`)
  }
  const existing = (listRes.data?.webhookSubscriptions?.edges ?? []).map((e) => e.node)

  const created: string[] = []
  for (const topic of BILLING_TOPICS) {
    if (existing.some((n) => n.topic === topic && n.uri === uri)) continue

    const createRes = (await client.request(CREATE_MUTATION, {
      variables: { topic, webhookSubscription: { uri } },
    })) as {
      data?: { webhookSubscriptionCreate?: { userErrors?: Array<{ message: string }> } }
      errors?: unknown
    }
    const userErrors = createRes.data?.webhookSubscriptionCreate?.userErrors ?? []
    if (createRes.errors || userErrors.length > 0) {
      throw new Error(
        `webhookSubscriptionCreate(${topic}) failed: ${JSON.stringify(createRes.errors ?? userErrors)}`
      )
    }
    created.push(topic)
  }

  if (created.length > 0) {
    logger.info('Registered shop-scoped billing webhooks', {
      shopDomain: input.shopDomain,
      organizationId: input.organizationId,
      created,
      uri,
    })
  }
  return { created }
}
