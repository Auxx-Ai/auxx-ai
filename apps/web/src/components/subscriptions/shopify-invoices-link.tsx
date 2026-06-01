// apps/web/src/components/subscriptions/shopify-invoices-link.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ExternalLink, FileText } from 'lucide-react'
import { shopifyBillingUrl } from './shopify-admin-url'

interface ShopifyInvoicesLinkProps {
  shopDomain: string | null
}

/** Replaces the invoice ledger for Shopify-billed orgs — deeplinks to Shopify Admin charges. */
export function ShopifyInvoicesLink({ shopDomain }: ShopifyInvoicesLinkProps) {
  const billingUrl = shopDomain ? shopifyBillingUrl(shopDomain) : null
  if (!billingUrl) return null

  return (
    <div className='flex items-center justify-between gap-2 p-3'>
      <div className='flex flex-row items-center gap-2'>
        <div className='size-8 border bg-muted rounded-lg flex items-center justify-center shrink-0'>
          <FileText className='size-4 shrink-0 text-muted-foreground' />
        </div>
        <div className='flex flex-col'>
          <span className='text-sm'>Invoices are in Shopify Admin</span>
          <span className='text-xs text-muted-foreground'>
            Past charges and invoice history are managed by Shopify for this organization.
          </span>
        </div>
      </div>
      <Button variant='outline' size='sm' asChild>
        <a href={billingUrl} target='_blank' rel='noopener noreferrer'>
          View in Shopify
          <ExternalLink />
        </a>
      </Button>
    </div>
  )
}
