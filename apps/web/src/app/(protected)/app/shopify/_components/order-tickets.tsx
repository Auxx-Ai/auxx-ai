import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
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
import {
  AlertCircle,
  MessageSquare,
  PackageOpen,
  Plus,
  Receipt,
  RefreshCw,
  ShoppingBag,
  Truck,
} from 'lucide-react'
import Link from 'next/link'
import { useOrder } from '~/components/orders/order-context'

// Helper function to format dates
function formatDate(date: Date | null | undefined) {
  if (!date) return 'N/A'
  return format(new Date(date), 'MMM d, yyyy')
}

// Function to get icon based on ticket type
function getTicketTypeIcon(type: string) {
  const icons = {
    GENERAL: <MessageSquare className='h-4 w-4' />,
    MISSING_ITEM: <PackageOpen className='h-4 w-4' />,
    RETURN: <RefreshCw className='h-4 w-4' />,
    REFUND: <Receipt className='h-4 w-4' />,
    PRODUCT_ISSUE: <ShoppingBag className='h-4 w-4' />,
    SHIPPING_ISSUE: <Truck className='h-4 w-4' />,
    // Add more icons as needed
  } as Record<string, JSX.Element>

  return icons[type] || <AlertCircle className='h-4 w-4' />
}

// Function to get badge color based on ticket status
function getTicketStatusBadge(status: string) {
  const statusMap: Record<
    string,
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    OPEN: { label: 'Open', variant: 'secondary' },
    IN_PROGRESS: { label: 'In Progress', variant: 'secondary' },
    WAITING_FOR_CUSTOMER: { label: 'Waiting for Customer', variant: 'outline' },
    WAITING_FOR_THIRD_PARTY: { label: 'Waiting for Third Party', variant: 'outline' },
    RESOLVED: { label: 'Resolved', variant: 'default' },
    CLOSED: { label: 'Closed', variant: 'default' },
    CANCELLED: { label: 'Cancelled', variant: 'destructive' },
    MERGED: { label: 'Merged', variant: 'outline' },
  }

  const statusInfo = statusMap[status] || { label: status, variant: 'outline' }

  return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
}

// Function to get badge color based on ticket priority
function getTicketPriorityBadge(priority: string) {
  const priorityMap: Record<
    string,
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    LOW: { label: 'Low', variant: 'outline' },
    MEDIUM: { label: 'Medium', variant: 'secondary' },
    HIGH: { label: 'High', variant: 'default' },
    URGENT: { label: 'Urgent', variant: 'destructive' },
  }

  const priorityInfo = priorityMap[priority] || { label: priority, variant: 'outline' }

  return <Badge variant={priorityInfo.variant}>{priorityInfo.label}</Badge>
}

export default function OrderTickets({ order: orderProp }: { order?: any } = {}) {
  // Use order from context if available, fallback to prop for backward compatibility
  const { order: contextOrder, isLoading } = useOrder?.() || { order: null, isLoading: false }
  const order = contextOrder || orderProp

  // Show loading state when using context
  if (isLoading && !orderProp) {
    return <OrderTicketsSkeleton />
  }

  // Check if order has tickets
  const hasTickets = order?.tickets && order.tickets.length > 0

  if (!order || !hasTickets) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Support Tickets</CardTitle>
          <CardDescription>No support tickets are associated with this order.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex flex-col items-center justify-center space-y-3 py-6'>
            <MessageSquare className='h-12 w-12 text-muted-foreground' />
            <p className='max-w-md text-center text-muted-foreground'>
              There are no support tickets linked to this order. Create a support ticket if the
              customer has questions or issues with their order.
            </p>
            <Button>
              <Plus className='mr-2 h-4 w-4' /> Create Support Ticket
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <div>
            <CardTitle>Support Tickets</CardTitle>
            <CardDescription>Support tickets associated with this order</CardDescription>
          </div>
          <Button size='sm'>
            <Plus /> Create Ticket
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.tickets.map((ticket: any) => (
                <TableRow key={ticket.id}>
                  <TableCell>
                    <div className='font-medium'>#{ticket.number}</div>
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center gap-1'>
                      {getTicketTypeIcon(ticket.type)}
                      <span className='text-xs'>{ticket.type}</span>
                    </div>
                  </TableCell>
                  <TableCell>{ticket.title}</TableCell>
                  <TableCell>{getTicketStatusBadge(ticket.status)}</TableCell>
                  <TableCell>{getTicketPriorityBadge(ticket.priority)}</TableCell>
                  <TableCell>{formatDate(ticket.createdAt)}</TableCell>
                  <TableCell>{formatDate(ticket.updatedAt)}</TableCell>
                  <TableCell className='text-right'>
                    <Link href={`/tickets/${ticket.id}`} passHref>
                      <Button variant='ghost' size='sm'>
                        View
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Ticket type breakdown */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
        {/* Missing Items */}
        {order.tickets.some((ticket: any) => ticket.type === 'MISSING_ITEM') && (
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center text-base'>
                <PackageOpen className='mr-2 h-5 w-5 text-amber-500' />
                Missing Item Tickets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className='space-y-4'>
                {order.tickets
                  .filter((ticket: any) => ticket.type === 'MISSING_ITEM')
                  .map((ticket: any) => (
                    <div
                      key={ticket.id}
                      className='flex items-center justify-between border-b pb-2 last:border-0 last:pb-0'>
                      <div>
                        <div className='font-medium'>#{ticket.number}</div>
                        <div className='max-w-[200px] truncate text-sm text-muted-foreground'>
                          {ticket.title}
                        </div>
                      </div>
                      <div className='flex items-center'>
                        {getTicketStatusBadge(ticket.status)}
                        <Link href={`/tickets/${ticket.id}`} passHref>
                          <Button variant='ghost' size='sm'>
                            View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Shipping Issues */}
        {order.tickets.some((ticket: any) => ticket.type === 'SHIPPING_ISSUE') && (
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center text-base'>
                <Truck className='mr-2 h-5 w-5 text-blue-500' />
                Shipping Issue Tickets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className='space-y-4'>
                {order.tickets
                  .filter((ticket: any) => ticket.type === 'SHIPPING_ISSUE')
                  .map((ticket: any) => (
                    <div
                      key={ticket.id}
                      className='flex items-center justify-between border-b pb-2 last:border-0 last:pb-0'>
                      <div>
                        <div className='font-medium'>#{ticket.number}</div>
                        <div className='max-w-[200px] truncate text-sm text-muted-foreground'>
                          {ticket.title}
                        </div>
                      </div>
                      <div className='flex items-center'>
                        {getTicketStatusBadge(ticket.status)}
                        <Link href={`/tickets/${ticket.id}`} passHref>
                          <Button variant='ghost' size='sm'>
                            View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Return/Refund */}
        {order.tickets.some(
          (ticket: any) => ticket.type === 'RETURN' || ticket.type === 'REFUND'
        ) && (
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center text-base'>
                <Receipt className='mr-2 h-5 w-5 text-green-500' />
                Return & Refund Tickets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className='space-y-4'>
                {order.tickets
                  .filter((ticket: any) => ticket.type === 'RETURN' || ticket.type === 'REFUND')
                  .map((ticket: any) => (
                    <div
                      key={ticket.id}
                      className='flex items-center justify-between border-b pb-2 last:border-0 last:pb-0'>
                      <div>
                        <div className='font-medium'>#{ticket.number}</div>
                        <div className='max-w-[200px] truncate text-sm text-muted-foreground'>
                          {ticket.title}
                        </div>
                      </div>
                      <div className='flex items-center'>
                        {getTicketStatusBadge(ticket.status)}
                        <Link href={`/tickets/${ticket.id}`} passHref>
                          <Button variant='ghost' size='sm'>
                            View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

// Skeleton component for loading state
function OrderTicketsSkeleton() {
  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>Support Tickets</CardTitle>
          <CardDescription>Loading ticket information...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            {[...Array(3)].map((_, index) => (
              <div key={index} className='rounded-lg border p-4'>
                <div className='flex items-center justify-between mb-2'>
                  <Skeleton className='h-5 w-20' />
                  <Skeleton className='h-6 w-16' />
                </div>
                <Skeleton className='h-4 w-full mb-2' />
                <div className='flex justify-between items-center'>
                  <Skeleton className='h-4 w-24' />
                  <Skeleton className='h-8 w-16' />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
