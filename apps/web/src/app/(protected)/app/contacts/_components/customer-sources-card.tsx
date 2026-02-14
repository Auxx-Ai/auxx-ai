// apps/web/src/app/(protected)/app/contacts/_components/customer-sources-card.tsx

import { Badge } from '@auxx/ui/components/badge'
import { LinkIcon } from 'lucide-react'

interface CustomerSourcesCardProps {
  customer: any // Replace with proper type
}

/**
 * CustomerSourcesCard displays the external sources connected to a customer.
 * Header (h4) is rendered by the parent component.
 */
export default function CustomerSourcesCard({ customer }: CustomerSourcesCardProps) {
  const sources = customer.customerSources || []
  const shopifyCustomers = customer.shopifyCustomers || []

  // Group sources by type for display
  const groupedSources: Record<string, any[]> = sources.reduce(
    (acc: Record<string, any[]>, source: any) => {
      if (!acc[source.source]) {
        acc[source.source] = []
      }
      acc[source.source].push(source)
      return acc
    },
    {}
  )

  // Add Shopify customers as sources if they exist
  if (shopifyCustomers.length > 0) {
    groupedSources['SHOPIFY'] = shopifyCustomers
  }

  // Check if customer has associated emails (apart from primary)
  const additionalEmails =
    customer.emails?.filter((email: string) => email !== customer.email) || []

  const hasAnySources = Object.keys(groupedSources).length > 0 || additionalEmails.length > 0

  return (
    <div className='bg-primary-100/50 rounded-2xl border py-2 px-3'>
      {hasAnySources ? (
        <div className='space-y-3'>
          {Object.entries(groupedSources).map(([sourceType, sourceItems]) => (
            <div key={sourceType} className='space-y-1'>
              <div className='flex items-center gap-2'>
                <Badge variant='outline' size='sm'>
                  {sourceType}
                </Badge>
                <span className='text-xs text-muted-foreground'>
                  {sourceItems.length} {sourceItems.length === 1 ? 'connection' : 'connections'}
                </span>
              </div>

              <ul className='space-y-1 pl-2 text-sm'>
                {sourceItems.map((item: any, index: number) => (
                  <li key={index} className='flex items-center text-muted-foreground'>
                    <LinkIcon className='mr-1.5 size-3 shrink-0' />
                    {sourceType === 'SHOPIFY' ? (
                      <span className='truncate'>
                        Shopify Customer {item.id.toString()}
                        {item.email && ` (${item.email})`}
                      </span>
                    ) : item.email ? (
                      <span className='truncate'>{item.email}</span>
                    ) : (
                      <span>ID: {item.sourceId}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {additionalEmails.length > 0 && (
            <div className='space-y-1 border-t pt-2'>
              <span className='text-sm font-medium'>Additional Emails</span>
              <ul className='space-y-1 pl-2 text-sm'>
                {additionalEmails.map((email: string, index: number) => (
                  <li key={index} className='flex items-center text-muted-foreground'>
                    <LinkIcon className='mr-1.5 size-3 shrink-0' />
                    <span className='truncate'>{email}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <span className='text-sm text-muted-foreground'>No connected sources</span>
      )}
    </div>
  )
}
