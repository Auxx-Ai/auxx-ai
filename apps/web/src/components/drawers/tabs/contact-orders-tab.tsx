// apps/web/src/components/drawers/tabs/contact-orders-tab.tsx

import { Button } from '@auxx/ui/components/button'
import { ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import NoShopifyIntegration from '~/app/(protected)/app/shopify/_components/no-shopify-integration'
import { EmptyState } from '~/components/global/empty-state'
import OrderRow from '~/components/orders/order-row'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * Orders tab for contact drawer - displays Shopify orders
 */
export function ContactOrdersTab({ entityInstanceId }: DrawerTabProps) {
  const contactId = entityInstanceId
  const [page, setPage] = useState(1)
  const pageSize = 10

  const { data: contact, isLoading: isContactLoading } = api.contact.getById.useQuery(
    { id: contactId },
    { enabled: !!contactId }
  )

  const shopifyCustomers = contact?.shopifyCustomers || []
  // Get Shopify customer IDs if present
  const shopifyCustomerIds = shopifyCustomers?.map((c: { id: number }) => c.id.toString()) || []
  const hasShopifyCustomers = shopifyCustomerIds.length > 0

  // Query orders for this customer
  const { data, isLoading } = api.order.getOrdersByShopifyCustomerIds.useQuery(
    { customerIds: shopifyCustomerIds, page, pageSize },
    {
      // Only fetch if we have Shopify customers
      enabled: hasShopifyCustomers,
    }
  )

  const { data: shopifyData, isLoading: isShopifyLoading } = api.shopify.hasIntegration.useQuery()

  // NoShopifyIntegration

  if (isLoading || isShopifyLoading || isContactLoading) {
    return (
      <div className='flex items-center justify-center h-full w-full'>
        <EmptyState
          icon={ShoppingBag}
          iconClassName='animate-spin'
          title='Loading orders'
          description='Fetching orders for this customer...'
          button={<div className='h-7' />}
        />
      </div>
    )
  }
  if (!isShopifyLoading && !shopifyData?.hasIntegration) {
    return (
      <div className='flex items-center justify-center h-full w-full'>
        <NoShopifyIntegration />
      </div>
    )
  }
  if (data?.orders.length === 0) {
    return (
      <div className='flex items-center justify-center h-full w-full'>
        <EmptyState
          icon={ShoppingBag}
          title='No orders found'
          description='This customer has no orders from Shopify yet.'
        />
      </div>
    )
  }

  return (
    <>
      <div className='flex items-center justify-between px-4'>
        <h2 className='text-base flex items-center space-x-2 gap-2'>
          <ShoppingBag className='h-5 w-5 text-muted-foreground/50' />
          Orders
        </h2>
      </div>
      <div className='space-y-4 m-4 border rounded-md bg-white dark:bg-muted/10'>
        {data?.orders.map((order) => (
          <OrderRow
            key={order.id}
            order={order}
            className='cursor-pointer transition-colors hover:bg-muted/50'
          />
        ))}

        {data?.totalPages && data?.totalPages > 1 && (
          <div className='mt-4 flex items-center justify-between'>
            <Button
              variant='outline'
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}>
              Previous
            </Button>
            <span className='text-sm text-muted-foreground'>
              Page {page} of {data!.totalPages}
            </span>
            <Button
              variant='outline'
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= data!.totalPages}>
              Next
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
