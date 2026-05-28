// apps/web/src/components/subscriptions/shopify-admin-billing-banner.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ExternalLink } from 'lucide-react'

interface ShopifyAdminBillingBannerProps {
  shopDomain: string | null
}

/**
 * Banner shown above Billing Details for Shopify-billed orgs. Clarifies that only
 * payment method + invoice history live in Shopify Admin — plan changes and
 * cancellation still work from this page.
 */
export function ShopifyAdminBillingBanner({ shopDomain }: ShopifyAdminBillingBannerProps) {
  if (!shopDomain) return null

  return (
    <div className='rounded-2xl border p-4 flex items-center justify-between gap-4'>
      <div className='space-y-1'>
        <div className='font-medium text-foreground'>
          Payment method and invoices are managed in Shopify
        </div>
        <div className='text-sm text-muted-foreground'>
          Your card on file, past charges, and invoice history are handled by Shopify Admin. Plan
          changes and cancellation work from this page.
        </div>
      </div>
      <Button variant='outline' asChild>
        <a href={`https://${shopDomain}/admin/charges`} target='_blank' rel='noopener noreferrer'>
          Open Shopify Admin
          <ExternalLink />
        </a>
      </Button>
    </div>
  )
}
