// app/(protected)/app/settings/plans/_components/shopify-admin-billing-banner-wrapper.tsx
'use client'

import { Wallet } from 'lucide-react'
import { SettingsSection } from '~/components/global/settings-page'
import { ShopifyAdminBillingBanner } from '~/components/subscriptions/shopify-admin-billing-banner'
import { api } from '~/trpc/react'

/**
 * Client wrapper that reads the cached subscription via tRPC and conditionally
 * renders the Shopify Admin billing banner. Stands in for the hidden Billing Details
 * section on Shopify-billed orgs, so it carries the same section header.
 * Keeps the parent page server-rendered.
 */
export function ShopifyAdminBillingBannerWrapper() {
  const { data: subscription } = api.billing.getCurrentSubscription.useQuery()

  if (subscription?.billingProvider !== 'shopify') return null

  return (
    <div id='billing-details'>
      <SettingsSection
        className='space-y-3'
        icon={Wallet}
        title='Billing Details'
        description='Manage your payment methods and billing information'>
        <ShopifyAdminBillingBanner shopDomain={subscription.shopifyShopDomain} />
      </SettingsSection>
    </div>
  )
}
