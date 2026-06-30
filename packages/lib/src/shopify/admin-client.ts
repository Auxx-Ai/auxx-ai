// packages/lib/src/shopify/admin-client.ts
import { createScopedLogger } from '@auxx/logger'
import { createAdminApiClient } from '@shopify/admin-api-client'

const logger = createScopedLogger('shopify/admin-client')

/**
 * Build a Shopify Admin API client from a shop domain + access token. Used by
 * `chat-metafields` to write Auxx chat metafields onto the shop. Billing has its
 * own Admin client in `@auxx/billing`.
 */
export function createShopifyAdminClient(integration: { shopDomain: string; accessToken: string }) {
  if (!integration.shopDomain || !integration.accessToken) {
    throw new Error('Missing required integration properties: shopDomain or accessToken')
  }

  try {
    return createAdminApiClient({
      storeDomain: integration.shopDomain,
      apiVersion: '2025-04',
      accessToken: integration.accessToken,
    })
  } catch (error) {
    logger.error('Error creating Shopify admin client', { error })
    throw error
  }
}

export type ShopifyAdminClient = ReturnType<typeof createShopifyAdminClient>
