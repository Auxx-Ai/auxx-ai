import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@auxx/ui/components/accordion'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { format } from 'date-fns'
import { ExternalLink, Package, PackageCheck } from 'lucide-react'
import { useOrder } from '~/components/orders/order-context'

// Helper function to format dates
function formatDate(date: Date | null | undefined) {
  if (!date) return 'N/A'
  return format(new Date(date), 'MMM d, yyyy')
}

// Get status badge based on fulfillment status
function getFulfillmentStatusBadge(status: string) {
  const statusMap: Record<
    string,
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    SUCCESS: { label: 'Fulfilled', variant: 'default' },
    PENDING: { label: 'Pending', variant: 'secondary' },
    OPEN: { label: 'Open', variant: 'secondary' },
    CANCELLED: { label: 'Cancelled', variant: 'destructive' },
    ERROR: { label: 'Error', variant: 'destructive' },
    FAILURE: { label: 'Failed', variant: 'destructive' },
  }

  const statusInfo = statusMap[status] || { label: status, variant: 'outline' }

  return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
}

export default function OrderFulfillments({ order: orderProp }: { order?: any } = {}) {
  // Use order from context if available, fallback to prop for backward compatibility
  const { order: contextOrder, isLoading } = useOrder?.() || { order: null, isLoading: false }
  const order = contextOrder || orderProp

  // Show loading state when using context
  if (isLoading && !orderProp) {
    return <OrderFulfillmentsSkeleton />
  }

  // Handle cases where there are no fulfillments
  const fulfillmentsExist = order?.fulfillments && order.fulfillments.length > 0
  const trackingsExist = order?.trackings && order.trackings.length > 0

  if (!order || (!fulfillmentsExist && !trackingsExist)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Fulfillments</CardTitle>
          <CardDescription>No fulfillments have been created for this order yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex flex-col items-center justify-center space-y-3 py-6'>
            <Package className='h-12 w-12 text-muted-foreground' />
            <p className='max-w-md text-center text-muted-foreground'>
              This order has not been fulfilled. Create a fulfillment when you're ready to ship the
              items.
            </p>
            <Button>Create Fulfillment</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-6'>
      {/* Fulfillments section */}
      {fulfillmentsExist && (
        <Card>
          <CardHeader>
            <CardTitle>Fulfillments</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type='multiple' className='w-full'>
              {order.fulfillments.map((fulfillment: any, index: number) => (
                <AccordionItem key={fulfillment.id} value={`fulfillment-${fulfillment.id}`}>
                  <AccordionTrigger className='py-4'>
                    <div className='flex w-full items-center justify-between pr-6'>
                      <div className='flex items-center'>
                        {fulfillment.status === 'SUCCESS' ? (
                          <PackageCheck className='mr-2 h-5 w-5 text-green-500' />
                        ) : (
                          <Package className='mr-2 h-5 w-5' />
                        )}
                        <span>Fulfillment #{index + 1}</span>
                      </div>
                      <div className='flex items-center space-x-3'>
                        <span className='text-sm text-muted-foreground'>
                          {formatDate(fulfillment.createdAt)}
                        </span>
                        {getFulfillmentStatusBadge(fulfillment.status)}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className='px-4 pb-4'>
                    <div className='space-y-4'>
                      <div className='grid gap-4 md:grid-cols-3'>
                        <div>
                          <h4 className='mb-1 text-sm font-medium'>Status</h4>
                          <p>{getFulfillmentStatusBadge(fulfillment.status)}</p>
                        </div>
                        <div>
                          <h4 className='mb-1 text-sm font-medium'>Created</h4>
                          <p>{formatDate(fulfillment.createdAt)}</p>
                        </div>
                        {fulfillment.deliveredAt && (
                          <div>
                            <h4 className='mb-1 text-sm font-medium'>Delivered</h4>
                            <p>{formatDate(fulfillment.deliveredAt)}</p>
                          </div>
                        )}
                      </div>

                      <Separator />

                      {/* Tracking information */}
                      {fulfillment.trackings && fulfillment.trackings.length > 0 && (
                        <div>
                          <h4 className='mb-2 text-sm font-medium'>Tracking Information</h4>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Carrier</TableHead>
                                <TableHead>Tracking Number</TableHead>
                                <TableHead>Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {fulfillment.trackings.map((tracking: any) => (
                                <TableRow key={tracking.id}>
                                  <TableCell>{tracking.company}</TableCell>
                                  <TableCell>{tracking.number}</TableCell>
                                  <TableCell>
                                    {tracking.url && (
                                      <a
                                        href={tracking.url}
                                        target='_blank'
                                        rel='noopener noreferrer'
                                        className='inline-flex items-center text-blue-600 hover:text-blue-800'>
                                        Track <ExternalLink className='ml-1 h-3 w-3' />
                                      </a>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Tracking Information - Standalone section if separate from fulfillments */}
      {trackingsExist && !fulfillmentsExist && (
        <Card>
          <CardHeader>
            <CardTitle>Tracking Information</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Tracking Number</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.trackings.map((tracking: any) => (
                  <TableRow key={tracking.id}>
                    <TableCell>{tracking.company}</TableCell>
                    <TableCell>{tracking.number}</TableCell>
                    <TableCell>{formatDate(tracking.createdAt)}</TableCell>
                    <TableCell>
                      {tracking.url && (
                        <a
                          href={tracking.url}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='inline-flex items-center text-blue-600 hover:text-blue-800'>
                          Track <ExternalLink className='ml-1 h-3 w-3' />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className='flex justify-end space-x-3'>
        <Button variant='outline'>Add Tracking Number</Button>
        <Button>Create Fulfillment</Button>
      </div>
    </div>
  )
}

// Skeleton component for loading state
function OrderFulfillmentsSkeleton() {
  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>Fulfillments</CardTitle>
          <CardDescription>Loading fulfillment information...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            {[...Array(2)].map((_, index) => (
              <div key={index} className='rounded-lg border p-4'>
                <div className='flex items-center justify-between mb-4'>
                  <Skeleton className='h-6 w-32' />
                  <Skeleton className='h-6 w-20' />
                </div>
                <div className='grid gap-2'>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Created</span>
                    <Skeleton className='h-4 w-24' />
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Tracking Number</span>
                    <Skeleton className='h-4 w-32' />
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Carrier</span>
                    <Skeleton className='h-4 w-16' />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
