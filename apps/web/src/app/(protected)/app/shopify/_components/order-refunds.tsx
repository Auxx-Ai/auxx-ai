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
import { AlertCircle, ArrowLeft, Receipt } from 'lucide-react'
import React from 'react'
import { useOrder } from '~/components/orders/order-context'
import { formatMoney } from '~/utils/strings'

// Helper function to format dates
function formatDate(date: Date | null | undefined) {
  if (!date) return 'N/A'
  return format(new Date(date), 'MMM d, yyyy')
}

// Helper function to get status badge for refund
function getRefundStatusBadge(status: string) {
  const statusMap: Record<
    string,
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    PENDING: { label: 'Pending', variant: 'secondary' },
    APPROVED: { label: 'Approved', variant: 'default' },
    PROCESSED: { label: 'Processed', variant: 'default' },
    REJECTED: { label: 'Rejected', variant: 'destructive' },
  }

  const statusInfo = statusMap[status] || { label: status, variant: 'outline' }

  return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
}

export default function OrderRefunds({ order: orderProp }: { order?: any } = {}) {
  // Use order from context if available, fallback to prop for backward compatibility
  const { order: contextOrder, isLoading } = useOrder?.() || { order: null, isLoading: false }
  const order = contextOrder || orderProp

  // Show loading state when using context
  if (isLoading && !orderProp) {
    return <OrderRefundsSkeleton />
  }

  // Check if order has any refunds
  const hasRefunds = order?.refunds && order.refunds.length > 0

  // Check if order has any returns
  const hasReturns = order?.returns && order.returns.length > 0

  // Special case: Check if there's a RefundCase linked to this order (from ticket system)
  const hasRefundCase = order?.tickets && order.tickets.some((ticket: any) => ticket.refundCase)

  // If there are no refunds or returns
  if (!order || (!hasRefunds && !hasReturns && !hasRefundCase)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Refunds & Returns</CardTitle>
          <CardDescription>
            No refunds or returns have been processed for this order.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex flex-col items-center justify-center space-y-3 py-6'>
            <Receipt className='h-12 w-12 text-muted-foreground' />
            <p className='max-w-md text-center text-muted-foreground'>
              This order has not had any refunds or returns processed. You can initiate a refund or
              return process when needed.
            </p>
            <div className='flex gap-2'>
              <Button variant='outline'>Create Return</Button>
              <Button>Create Refund</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-6'>
      {/* Refunds section */}
      {hasRefunds && (
        <Card>
          <CardHeader>
            <CardTitle>Refunds</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Refund Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.refunds.map((refund: any) => (
                  <TableRow key={refund.id}>
                    <TableCell>{formatDate(refund.createdAt)}</TableCell>
                    <TableCell>{formatMoney(refund.totalRefundedAmount)}</TableCell>
                    <TableCell>{refund.currencyCode}</TableCell>
                    <TableCell>
                      <Button variant='ghost' size='sm'>
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Refund summary */}
            <div className='mt-4 flex justify-between border-t pt-4'>
              <span className='font-medium'>Total Refunded</span>
              <span className='font-medium'>{formatMoney(order.totalRefunded)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Returns section */}
      {hasReturns && (
        <Card>
          <CardHeader>
            <CardTitle>Returns</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Return Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.returns.map((returnItem: any) => (
                  <TableRow key={returnItem.id}>
                    <TableCell>{formatDate(returnItem.createdAt)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          returnItem.status === 'OPEN' || returnItem.status === 'REQUESTED'
                            ? 'secondary'
                            : returnItem.status === 'CLOSED'
                              ? 'default'
                              : returnItem.status === 'CANCELLED' ||
                                  returnItem.status === 'DECLINED'
                                ? 'destructive'
                                : 'outline'
                        }>
                        {returnItem.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant='ghost' size='sm'>
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Refund Cases from Ticket System */}
      {hasRefundCase && order.tickets && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center'>
              <AlertCircle className='mr-2 h-5 w-5 text-amber-500' />
              Refund Requests
            </CardTitle>
            <CardDescription>Refund requests from support tickets</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Request Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.tickets
                  .filter((ticket: any) => ticket.refundCase)
                  .map((ticket: any) => (
                    <TableRow key={ticket.id}>
                      <TableCell>#{ticket.number}</TableCell>
                      <TableCell>{formatDate(ticket.createdAt)}</TableCell>
                      <TableCell>
                        {ticket.refundCase.refundAmount
                          ? formatMoney(ticket.refundCase.refundAmount)
                          : 'Not specified'}
                      </TableCell>
                      <TableCell>{getRefundStatusBadge(ticket.refundCase.refundStatus)}</TableCell>
                      <TableCell className='max-w-xs truncate'>
                        {ticket.refundCase.refundReason || 'No reason provided'}
                      </TableCell>
                      <TableCell>
                        <div className='flex gap-1'>
                          <Button variant='ghost' size='sm'>
                            View Ticket
                          </Button>
                          <Button variant='outline' size='sm'>
                            Process
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Return Cases from Ticket System */}
      {order.tickets && order.tickets.some((ticket: any) => ticket.returnCase) && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center'>
              <ArrowLeft className='mr-2 h-5 w-5 text-amber-500' />
              Return Requests
            </CardTitle>
            <CardDescription>Return requests from support tickets</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Request Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Return Label Sent</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.tickets
                  .filter((ticket: any) => ticket.returnCase)
                  .map((ticket: any) => (
                    <TableRow key={ticket.id}>
                      <TableCell>#{ticket.number}</TableCell>
                      <TableCell>{formatDate(ticket.createdAt)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            ticket.returnCase.returnStatus === 'APPROVED' ||
                            ticket.returnCase.returnStatus === 'COMPLETED'
                              ? 'default'
                              : ticket.returnCase.returnStatus === 'REQUESTED' ||
                                  ticket.returnCase.returnStatus === 'RETURN_LABEL_SENT' ||
                                  ticket.returnCase.returnStatus === 'IN_TRANSIT' ||
                                  ticket.returnCase.returnStatus === 'RECEIVED'
                                ? 'secondary'
                                : ticket.returnCase.returnStatus === 'REJECTED'
                                  ? 'destructive'
                                  : 'outline'
                          }>
                          {ticket.returnCase.returnStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ticket.returnCase.returnLabelSent ? 'default' : 'outline'}>
                          {ticket.returnCase.returnLabelSent ? 'Yes' : 'No'}
                        </Badge>
                      </TableCell>
                      <TableCell>{ticket.returnCase.returnTrackingNumber || 'N/A'}</TableCell>
                      <TableCell>
                        <div className='flex gap-1'>
                          <Button variant='ghost' size='sm'>
                            View Ticket
                          </Button>
                          <Button variant='outline' size='sm'>
                            {ticket.returnCase.returnLabelSent ? 'Update' : 'Send Label'}
                          </Button>
                        </div>
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
        <Button variant='outline'>Create Return</Button>
        <Button>Create Refund</Button>
      </div>
    </div>
  )
}

// Skeleton component for loading state
function OrderRefundsSkeleton() {
  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>Refunds & Returns</CardTitle>
          <CardDescription>Loading refund information...</CardDescription>
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
                    <span className='text-muted-foreground'>Amount</span>
                    <Skeleton className='h-4 w-16' />
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Reason</span>
                    <Skeleton className='h-4 w-24' />
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Created</span>
                    <Skeleton className='h-4 w-20' />
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
