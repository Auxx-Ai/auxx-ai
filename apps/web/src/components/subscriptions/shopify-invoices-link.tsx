// apps/web/src/components/subscriptions/shopify-invoices-link.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ExternalLink, FileText } from 'lucide-react'

interface ShopifyInvoicesLinkProps {
  shopDomain: string | null
}

/** Replaces the invoice ledger for Shopify-billed orgs — deeplinks to Shopify Admin charges. */
export function ShopifyInvoicesLink({ shopDomain }: ShopifyInvoicesLinkProps) {
  if (!shopDomain) return null

  return (
    <div className='flex items-center justify-between p-6'>
      <div className='flex items-center gap-3'>
        <div className='size-10 rounded bg-muted flex items-center justify-center'>
          <FileText className='size-5 text-muted-foreground' />
        </div>
        <div>
          <div className='text-sm font-medium'>Invoices are in Shopify Admin</div>
          <p className='text-xs text-muted-foreground'>
            Past charges and invoice history are managed by Shopify for this organization.
          </p>
        </div>
      </div>
      <Button variant='outline' size='sm' asChild>
        <a href={`https://${shopDomain}/admin/charges`} target='_blank' rel='noopener noreferrer'>
          View in Shopify
          <ExternalLink />
        </a>
      </Button>
    </div>
  )
}
