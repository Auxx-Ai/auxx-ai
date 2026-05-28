// packages/billing/src/providers/shopify/client.ts

import { createAdminApiClient } from '@shopify/admin-api-client'

const SHOPIFY_API_VERSION = '2026-04'

/**
 * Returns an authenticated Shopify Admin GraphQL client for a single shop.
 *
 * Mirrors the factory in `@auxx/lib/shopify` (createShopifyAdminClient) so the billing
 * package can call Admin GraphQL without crossing the lib tier boundary.
 */
export function createShopifyAdminClient(input: { shopDomain: string; accessToken: string }) {
  if (!input.shopDomain || !input.accessToken) {
    throw new Error('Missing required Shopify client properties: shopDomain or accessToken')
  }
  return createAdminApiClient({
    storeDomain: input.shopDomain,
    apiVersion: SHOPIFY_API_VERSION,
    accessToken: input.accessToken,
  })
}

export type ShopifyAdminClient = ReturnType<typeof createShopifyAdminClient>
