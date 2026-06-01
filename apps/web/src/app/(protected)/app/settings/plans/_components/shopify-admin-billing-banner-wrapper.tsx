// app/(protected)/app/settings/plans/_components/shopify-admin-billing-banner-wrapper.tsx
'use client'

import { Wallet } from 'lucide-react'
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
    <div id='billing-details' className='space-y-3'>
      <div className='space-y-1'>
        <div className='flex items-center gap-2 leading-none tracking-tight font-semibold text-foreground'>
          <Wallet className='size-4' /> Billing Details
        </div>
        <div className='text-sm text-muted-foreground mb-4'>
          Manage your payment methods and billing information
        </div>
      </div>
      <ShopifyAdminBillingBanner shopDomain={subscription.shopifyShopDomain} />
    </div>
  )
}
