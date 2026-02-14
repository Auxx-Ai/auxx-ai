'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader } from '@auxx/ui/components/card'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { format } from 'date-fns'
import { ShoppingBag } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import OrderCustomer from './order-customer'
import OrderFulfillments from './order-fulfillments'
import OrderLineItems from './order-line-items'
import OrderRefunds from './order-refunds'
import OrderSummary from './order-summary'
import OrderTickets from './order-tickets'

type OrderDetailProps = {
  orderId: string // Using string as we'll pass the orderId from URL params which are strings
}

export default function OrderDetail({ orderId }: OrderDetailProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useQueryState('tab', {
    defaultValue: 'summary',
    parse: (value) => {
      // Validate that the value is one of our tab options
      const validTabs = ['summary', 'customer', 'items', 'fulfillments', 'refunds', 'tickets']
      return validTabs.includes(value) ? value : 'summary'
    },
  })

  // Convert string orderId to BigInt for querying
  // const orderIdBigInt = BigInt(orderId)

  const { data: order, isLoading, error } = api.order.byId.useQuery({ id: orderId })

  // Handle error state
  if (error) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <div className='text-center'>
          <h2 className='text-lg font-medium'>Failed to load order</h2>
          <p className='text-muted-foreground'>{error.message}</p>
          <Button variant='outline' className='mt-4' onClick={() => router.back()}>
            Go Back
          </Button>
        </div>
      </div>
    )
  }

  // Loading state
  if (isLoading || !order) {
    return <OrderDetailSkeleton />
  }

  const formattedDate = order.createdAt
    ? format(new Date(order.createdAt), 'MMM d, yyyy')
    : 'Unknown date'

  // Breadcrumbs for navigation
  const breadcrumbs = [
    { title: 'Orders', href: '/app/shopify/orders' },
    { title: order.name, href: '' },
  ]

  // Action buttons for the order
  const actionButton = (
    <div className='flex gap-2'>
      <Button variant='outline' onClick={() => router.push(`/app/shopify/orders/${orderId}/edit`)}>
        Edit Order
      </Button>
      <Button variant='secondary'>Create Return</Button>
    </div>
  )

  return (
    <SettingsPage
      icon={<ShoppingBag className='h-6 w-6' />}
      title={`Order ${order.name}`}
      description={`Created on ${formattedDate}`}
      breadcrumbs={breadcrumbs}
      button={actionButton}>
      <div className='space-y-6 p-8'>
        <Tabs value={activeTab || 'summary'} onValueChange={setActiveTab} className='w-full'>
          <TabsList className='mb-4'>
            <TabsTrigger value='summary'>Summary</TabsTrigger>
            <TabsTrigger value='customer'>Customer</TabsTrigger>
            <TabsTrigger value='items'>Line Items</TabsTrigger>
            <TabsTrigger value='fulfillments'>Fulfillments</TabsTrigger>
            <TabsTrigger value='refunds'>Refunds</TabsTrigger>
            <TabsTrigger value='tickets'>Tickets</TabsTrigger>
          </TabsList>

          <TabsContent value='summary'>
            <OrderSummary order={order} />
          </TabsContent>

          <TabsContent value='customer'>
            <OrderCustomer order={order} />
          </TabsContent>

          <TabsContent value='items'>
            <OrderLineItems order={order} />
          </TabsContent>

          <TabsContent value='fulfillments'>
            <OrderFulfillments order={order} />
          </TabsContent>

          <TabsContent value='refunds'>
            <OrderRefunds order={order} />
          </TabsContent>

          <TabsContent value='tickets'>
            <OrderTickets order={order} />
          </TabsContent>
        </Tabs>
      </div>
    </SettingsPage>
  )
}

// Skeleton component for loading state
function OrderDetailSkeleton() {
  return (
    <SettingsPage
      icon={<ShoppingBag className='h-6 w-6' />}
      title={<Skeleton className='h-8 w-48' />}
      description={<Skeleton className='h-4 w-32' />}
      breadcrumbs={[
        { title: 'Orders', href: '/app/shopify/orders' },
        { title: 'Loading...', href: '' },
      ]}>
      <div className='space-y-6 p-8'>
        <Tabs defaultValue='summary' className='w-full'>
          <TabsList className='mb-4'>
            <TabsTrigger value='summary'>Summary</TabsTrigger>
            <TabsTrigger value='customer'>Customer</TabsTrigger>
            <TabsTrigger value='items'>Line Items</TabsTrigger>
            <TabsTrigger value='fulfillments'>Fulfillments</TabsTrigger>
            <TabsTrigger value='refunds'>Refunds</TabsTrigger>
            <TabsTrigger value='tickets'>Tickets</TabsTrigger>
          </TabsList>

          <Card>
            <CardHeader>
              <Skeleton className='h-7 w-40' />
            </CardHeader>
            <CardContent>
              <div className='space-y-4'>
                <Skeleton className='h-4 w-full' />
                <Skeleton className='h-4 w-full' />
                <Skeleton className='h-4 w-3/4' />
              </div>
            </CardContent>
          </Card>
        </Tabs>
      </div>
    </SettingsPage>
  )
}
