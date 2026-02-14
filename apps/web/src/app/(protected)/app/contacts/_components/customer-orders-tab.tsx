// apps/web/src/app/(protected)/app/contacts/_components/customer-orders-tab.tsx

import { Button } from '@auxx/ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { Loader2, ShoppingCart, Unlink } from 'lucide-react'
import { useState } from 'react'
import OrderRow from '~/components/orders/order-row'
import { api } from '~/trpc/react'

interface CustomerOrdersTabProps {
  customer: any // Replace with proper type
  shopifyCustomers: any[] // Replace with proper type
}

/**
 * CustomerOrdersTab displays orders for a customer from their linked Shopify accounts.
 */
export default function CustomerOrdersTab({ customer, shopifyCustomers }: CustomerOrdersTabProps) {
  const [page, setPage] = useState(1)
  const pageSize = 10

  // Get Shopify customer IDs if present
  const shopifyCustomerIds = shopifyCustomers?.map((c) => c.id.toString()) || []
  const hasShopifyCustomers = shopifyCustomerIds.length > 0

  // Query orders for this customer
  const { data: ordersData, isLoading } = api.order.getOrdersByShopifyCustomerIds.useQuery(
    { customerIds: shopifyCustomerIds, page, pageSize },
    {
      // Only fetch if we have Shopify customers
      enabled: hasShopifyCustomers,
    }
  )

  // No Shopify account linked
  if (!hasShopifyCustomers) {
    return (
      <div className='flex flex-col items-center justify-center flex-1'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Unlink />
            </EmptyMedia>
            <EmptyTitle>No Shopify account linked</EmptyTitle>
            <EmptyDescription>
              This customer doesn't have a linked Shopify account.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className='flex flex-col items-center justify-center flex-1'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Loader2 className='animate-spin' />
            </EmptyMedia>
            <EmptyTitle>Loading orders...</EmptyTitle>
            <EmptyDescription>Fetching orders from Shopify</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  // No orders found
  if (!ordersData?.orders || ordersData.orders.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center flex-1'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <ShoppingCart />
            </EmptyMedia>
            <EmptyTitle>No orders found</EmptyTitle>
            <EmptyDescription>This customer hasn't placed any orders yet.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  // Orders list
  return (
    <div className='space-y-4'>
      {ordersData.orders.map((order) => (
        <OrderRow key={order.id.toString()} order={order} />
      ))}

      {ordersData.totalPages > 1 && (
        <div className='mt-4 flex items-center justify-between'>
          <Button
            variant='outline'
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}>
            Previous
          </Button>
          <span className='text-sm text-muted-foreground'>
            Page {page} of {ordersData.totalPages}
          </span>
          <Button
            variant='outline'
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= ordersData.totalPages}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
