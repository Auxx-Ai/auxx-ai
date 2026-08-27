// apps/web/src/components/subscriptions/shopify-admin-billing-banner.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ExternalLink, Wallet } from 'lucide-react'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { shopifyAppUrl } from './shopify-admin-url'

interface ShopifyAdminBillingBannerProps {
  shopDomain: string | null
}

/**
 * Banner shown above Billing Details for Shopify-billed orgs. Shopify App Pricing owns the
 * payment method, invoice history, plan changes and cancellation alike — the in-app plan grid
 * and cancel dialog are both hidden for these orgs (see `ShopifyPlanCard`), so this says so
 * rather than implying either works here. "Open Shopify Admin" deep-links to the app's own page
 * (Settings → Apps → Auxx). Mirrors the plan-change-card row design.
 */
export function ShopifyAdminBillingBanner({ shopDomain }: ShopifyAdminBillingBannerProps) {
  const { shopifyAppHandle } = useEnv()
  const appUrl = shopDomain ? shopifyAppUrl(shopDomain, shopifyAppHandle) : null
  if (!appUrl) return null

  return (
    <div className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
      <div className='flex flex-row items-center gap-2'>
        <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0'>
          <Wallet className='size-4 shrink-0' />
        </div>
        <div className='flex flex-col'>
          <span className='text-sm'>Billing is managed in Shopify</span>
          <span className='text-xs text-muted-foreground'>
            Your payment method, plan changes and cancellation are all handled by Shopify Admin.
          </span>
        </div>
      </div>
      <Button variant='outline' size='sm' asChild>
        <a href={appUrl} target='_blank' rel='noopener noreferrer'>
          Open in Shopify Admin
          <ExternalLink />
        </a>
      </Button>
    </div>
  )
}
