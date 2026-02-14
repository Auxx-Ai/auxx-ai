import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { AlertCircle, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import React from 'react'
import { useOrder } from '~/components/orders/order-context'
import { formatMoney } from '~/utils/strings'

export default function OrderLineItems({ order: orderProp }: { order?: any } = {}) {
  // Use order from context if available, fallback to prop for backward compatibility
  const { order: contextOrder, isLoading } = useOrder?.() || { order: null, isLoading: false }
  const order = contextOrder || orderProp

  // Show loading state when using context
  if (isLoading && !orderProp) {
    return <OrderLineItemsSkeleton />
  }

  // Handle case where there are no line items
  if (!order || !order.lineItems || order.lineItems.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='flex h-40 items-center justify-center'>
            <p className='text-muted-foreground'>No line items found for this order</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Check if any items have missing items
  const hasMissingItems = order.lineItems.some(
    (item: any) => item.missingItems && item.missingItems.length > 0
  )

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-[40%]'>Product</TableHead>
                <TableHead className='text-center'>Quantity</TableHead>
                <TableHead className='text-right'>Unit Price</TableHead>
                <TableHead className='text-right'>Total</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.lineItems.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className='font-medium'>
                    <div>
                      {item.title}
                      {item.productId && (
                        <div>
                          <Badge variant='outline' className='mt-1'>
                            SKU: {item.variantId || 'N/A'}
                          </Badge>
                        </div>
                      )}
                      {item.missingItems && item.missingItems.length > 0 && (
                        <div className='mt-2 flex items-center text-sm text-red-500'>
                          <AlertCircle className='mr-1 h-4 w-4' />
                          Missing Item Reported
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className='text-center'>{item.quantity}</TableCell>
                  <TableCell className='text-right'>
                    {formatMoney(item.originalUnitPrice)}
                  </TableCell>
                  <TableCell className='text-right'>{formatMoney(item.originalTotal)}</TableCell>
                  <TableCell className='text-right'>
                    {item.productId && (
                      <Link href={`/app/shopify/products/${item.productId}`} passHref>
                        <Button variant='ghost' size='sm'>
                          <ExternalLink className='h-4 w-4' />
                        </Button>
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Display Missing Items section if relevant */}
      {hasMissingItems && (
        <Card className='border-red-200'>
          <CardHeader>
            <CardTitle className='flex items-center text-red-600'>
              <AlertCircle className='mr-2 h-5 w-5' />
              Missing Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className='text-center'>Quantity Missing</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lineItems.map(
                  (item: any) =>
                    item.missingItems &&
                    item.missingItems.map((missingItem: any) => (
                      <TableRow key={missingItem.id}>
                        <TableCell className='font-medium'>{item.title}</TableCell>
                        <TableCell className='text-center'>{missingItem.quantity}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              missingItem.status === 'APPROVED'
                                ? 'default'
                                : missingItem.status === 'SHIPPED'
                                  ? 'outline'
                                  : missingItem.status === 'REJECTED'
                                    ? 'destructive'
                                    : 'secondary'
                            }>
                            {missingItem.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{missingItem.reason || 'No reason provided'}</TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Skeleton component for loading state
function OrderLineItemsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Line Items</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-[40%]'>Product</TableHead>
              <TableHead className='text-center'>Quantity</TableHead>
              <TableHead className='text-right'>Unit Price</TableHead>
              <TableHead className='text-right'>Total</TableHead>
              <TableHead className='text-right'>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(3)].map((_, index) => (
              <TableRow key={index}>
                <TableCell>
                  <div>
                    <Skeleton className='h-4 w-48' />
                    <div className='mt-1'>
                      <Skeleton className='h-5 w-20' />
                    </div>
                  </div>
                </TableCell>
                <TableCell className='text-center'>
                  <Skeleton className='h-4 w-8 mx-auto' />
                </TableCell>
                <TableCell className='text-right'>
                  <Skeleton className='h-4 w-16 ml-auto' />
                </TableCell>
                <TableCell className='text-right'>
                  <Skeleton className='h-4 w-16 ml-auto' />
                </TableCell>
                <TableCell className='text-right'>
                  <Skeleton className='h-8 w-8 ml-auto' />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
