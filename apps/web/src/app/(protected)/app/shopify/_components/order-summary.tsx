import { Badge } from '@auxx/ui/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { formatCurrency } from '@auxx/utils/currency'
import { format } from 'date-fns'
import { useOrder } from '~/components/orders/order-context'

// Helper function to format dates
function formatDate(date: Date | null | undefined) {
  if (!date) return 'N/A'
  return format(new Date(date), 'MMM d, yyyy')
}

// Get status badge color based on fulfillment status
function getStatusBadge(status: string) {
  const statusMap: Record<
    string,
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    FULFILLED: { label: 'Fulfilled', variant: 'default' },
    PARTIALLY_FULFILLED: { label: 'Partially Fulfilled', variant: 'secondary' },
    UNFULFILLED: { label: 'Unfulfilled', variant: 'outline' },
    REFUNDED: { label: 'Refunded', variant: 'destructive' },
    PARTIALLY_REFUNDED: { label: 'Partially Refunded', variant: 'secondary' },
    // Add more statuses as needed
  }

  const statusInfo = statusMap[status] || { label: status, variant: 'outline' }

  return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
}

export default function OrderSummary({ order: orderProp }: { order?: any } = {}) {
  // Use order from context if available, fallback to prop for backward compatibility
  const { order: contextOrder, isLoading } = useOrder?.() || { order: null, isLoading: false }
  const order = contextOrder || orderProp

  // Show loading state when using context
  if (isLoading && !orderProp) {
    return <OrderSummarySkeleton />
  }

  // Show error state if no order data
  if (!order) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Order Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='flex h-40 items-center justify-center'>
            <p className='text-muted-foreground'>No order information available</p>
          </div>
        </CardContent>
      </Card>
    )
  }
  return (
    <div className='grid gap-6 md:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>Order Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Order Number</span>
              <span className='font-medium'>{order.name}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Date</span>
              <span className='font-medium'>{formatDate(order.createdAt)}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Status</span>
              {getStatusBadge(order.fulfillmentStatus)}
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Payment Status</span>
              {getStatusBadge(order.financialStatus)}
            </div>
            {order.discountCode && (
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Discount Code</span>
                <span className='font-medium'>{order.discountCode}</span>
              </div>
            )}
            {order.tags && order.tags.length > 0 && (
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Tags</span>
                <div className='flex flex-wrap justify-end gap-1'>
                  {order.tags.map((tag: string, index: number) => (
                    <Badge key={index} variant='outline'>
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Financial Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Subtotal</span>
              <span className='font-medium'>{formatCurrency(order.subtotalPrice)}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Shipping</span>
              <span className='font-medium'>{formatCurrency(order.totalShippingPrice)}</span>
            </div>
            {order.totalDiscounts > 0 && (
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Discounts</span>
                <span className='font-medium text-red-500'>
                  -{formatCurrency(order.totalDiscounts)}
                </span>
              </div>
            )}
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Tax</span>
              <span className='font-medium'>{formatCurrency(order.totalTax)}</span>
            </div>
            <Separator />
            <div className='flex justify-between font-bold'>
              <span>Total</span>
              <span>{formatCurrency(order.totalPrice)}</span>
            </div>
            {order.totalRefunded > 0 && (
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Refunded</span>
                <span className='font-medium text-red-500'>
                  -{formatCurrency(order.totalRefunded)}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className='md:col-span-2'>
        <CardHeader>
          <CardTitle>Shipping & Billing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid gap-6 md:grid-cols-2'>
            <div>
              <h3 className='mb-2 font-semibold'>Shipping Address</h3>
              {order.shippingAddress ? (
                <div className='space-y-1'>
                  <p>{order.shippingAddress.name}</p>
                  <p>{order.shippingAddress.address1}</p>
                  {order.shippingAddress.address2 && <p>{order.shippingAddress.address2}</p>}
                  <p>
                    {order.shippingAddress.city}, {order.shippingAddress.provinceCode}{' '}
                    {order.shippingAddress.zip}
                  </p>
                  <p>{order.shippingAddress.countryCode}</p>
                  {order.shippingAddress.phone && <p>{order.shippingAddress.phone}</p>}
                </div>
              ) : (
                <p className='text-muted-foreground'>No shipping address provided</p>
              )}
            </div>
            <div>
              <h3 className='mb-2 font-semibold'>Billing Address</h3>
              {order.billingAddress ? (
                <div className='space-y-1'>
                  <p>{order.billingAddress.name}</p>
                  <p>{order.billingAddress.address1}</p>
                  {order.billingAddress.address2 && <p>{order.billingAddress.address2}</p>}
                  <p>
                    {order.billingAddress.city}, {order.billingAddress.provinceCode}{' '}
                    {order.billingAddress.zip}
                  </p>
                  <p>{order.billingAddress.countryCode}</p>
                  {order.billingAddress.phone && <p>{order.billingAddress.phone}</p>}
                </div>
              ) : (
                <p className='text-muted-foreground'>Same as shipping address</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Skeleton component for loading state
function OrderSummarySkeleton() {
  return (
    <div className='grid gap-6 md:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>Order Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Order Number</span>
              <Skeleton className='h-4 w-20' />
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Date</span>
              <Skeleton className='h-4 w-24' />
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Status</span>
              <Skeleton className='h-6 w-16' />
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Payment Status</span>
              <Skeleton className='h-6 w-16' />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Financial Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Subtotal</span>
              <Skeleton className='h-4 w-16' />
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Shipping</span>
              <Skeleton className='h-4 w-16' />
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Tax</span>
              <Skeleton className='h-4 w-16' />
            </div>
            <Separator />
            <div className='flex justify-between font-bold'>
              <span>Total</span>
              <Skeleton className='h-4 w-20' />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className='md:col-span-2'>
        <CardHeader>
          <CardTitle>Shipping & Billing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid gap-6 md:grid-cols-2'>
            <div>
              <h3 className='mb-2 font-semibold'>Shipping Address</h3>
              <div className='space-y-2'>
                <Skeleton className='h-4 w-32' />
                <Skeleton className='h-4 w-40' />
                <Skeleton className='h-4 w-28' />
                <Skeleton className='h-4 w-24' />
              </div>
            </div>
            <div>
              <h3 className='mb-2 font-semibold'>Billing Address</h3>
              <div className='space-y-2'>
                <Skeleton className='h-4 w-32' />
                <Skeleton className='h-4 w-40' />
                <Skeleton className='h-4 w-28' />
                <Skeleton className='h-4 w-24' />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
