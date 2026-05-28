// app/(protected)/app/settings/plans/_components/shopify-admin-billing-banner-wrapper.tsx
'use client'

import { ShopifyAdminBillingBanner } from '~/components/subscriptions/shopify-admin-billing-banner'
import { api } from '~/trpc/react'

/**
 * Client wrapper that reads the cached subscription via tRPC and conditionally
 * renders the Shopify Admin billing banner. Keeps the parent page server-rendered.
 */
export function ShopifyAdminBillingBannerWrapper() {
  const { data: subscription } = api.billing.getCurrentSubscription.useQuery()

  if (subscription?.billingProvider !== 'shopify') return null
  return <ShopifyAdminBillingBanner shopDomain={subscription.shopifyShopDomain} />
}
