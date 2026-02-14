import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { format } from 'date-fns'
import { ExternalLink, Mail, Phone, User } from 'lucide-react'
import Link from 'next/link'
import { useOrder } from '~/components/orders/order-context'
import { formatMoney } from '~/utils/strings'

export default function OrderCustomer({ order: orderProp }: { order?: any } = {}) {
  // Use order from context if available, fallback to prop for backward compatibility
  const { order: contextOrder, isLoading } = useOrder?.() || { order: null, isLoading: false }
  const order = contextOrder || orderProp

  // Show loading state when using context
  if (isLoading && !orderProp) {
    return <OrderCustomerSkeleton />
  }

  // Early return if no customer data
  if (!order || !order.customer) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Customer Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='flex h-40 items-center justify-center'>
            <p className='text-muted-foreground'>No customer information available</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const { customer } = order

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle>Customer Information</CardTitle>
          {customer.id && (
            <Link href={`/app/shopify/customers/${customer.id}`} passHref>
              <Button variant='outline' size='sm'>
                View Customer Profile <ExternalLink className='ml-1 h-4 w-4' />
              </Button>
            </Link>
          )}
        </CardHeader>
        <CardContent>
          <div className='grid gap-6 md:grid-cols-2'>
            <div className='space-y-4'>
              <div className='flex items-center gap-2'>
                <User className='h-5 w-5 text-muted-foreground' />
                <div>
                  <p className='font-medium'>
                    {customer.firstName} {customer.lastName}
                  </p>
                  {customer.tags && customer.tags.length > 0 && (
                    <div className='mt-1 flex flex-wrap gap-1'>
                      {customer.tags.map((tag: string, index: number) => (
                        <Badge key={index} variant='outline' className='text-xs'>
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {customer.email && (
                <div className='flex items-center gap-2'>
                  <Mail className='h-5 w-5 text-muted-foreground' />
                  <a href={`mailto:${customer.email}`} className='text-blue-600 hover:underline'>
                    {customer.email}
                  </a>
                </div>
              )}

              {customer.phone && (
                <div className='flex items-center gap-2'>
                  <Phone className='h-5 w-5 text-muted-foreground' />
                  <a href={`tel:${customer.phone}`} className='text-blue-600 hover:underline'>
                    {customer.phone}
                  </a>
                </div>
              )}
            </div>

            <div className='space-y-4'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Orders Count</span>
                <span className='font-medium'>{customer.numberOfOrders || 1}</span>
              </div>

              {customer.amountSpent !== undefined && (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Total Spent</span>
                  <span className='font-medium'>{formatMoney(customer.amountSpent)}</span>
                </div>
              )}

              {customer.verifiedEmail !== undefined && (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Email Verified</span>
                  <Badge variant={customer.verifiedEmail ? 'default' : 'outline'}>
                    {customer.verifiedEmail ? 'Yes' : 'No'}
                  </Badge>
                </div>
              )}

              {customer.createdAt && (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Customer Since</span>
                  <span className='font-medium'>
                    {format(new Date(customer.createdAt), 'MMM d, yyyy')}
                  </span>
                </div>
              )}

              {customer.taxExempt !== undefined && customer.taxExempt && (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Tax Exempt</span>
                  <Badge>Yes</Badge>
                </div>
              )}
            </div>
          </div>

          {customer.note && (
            <div className='mt-6'>
              <h4 className='mb-2 text-sm font-medium'>Customer Notes</h4>
              <div className='rounded-lg bg-muted p-3 text-sm'>{customer.note}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contact information component - displays linked Contact entity if available */}
      {customer.contact && (
        <Card>
          <CardHeader className='flex flex-row items-center justify-between'>
            <CardTitle>Contact Record</CardTitle>
            <Link href={`/contacts/${customer.contact.id}`} passHref>
              <Button variant='outline' size='sm'>
                View Contact <ExternalLink className='ml-1 h-4 w-4' />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className='space-y-3'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Name</span>
                <span className='font-medium'>
                  {customer.contact.firstName} {customer.contact.lastName}
                </span>
              </div>

              {customer.contact.emails && customer.contact.emails.length > 0 && (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Emails</span>
                  <div className='flex flex-col items-end'>
                    {customer.contact.emails.map((email: string, index: number) => (
                      <a
                        key={index}
                        href={`mailto:${email}`}
                        className='text-blue-600 hover:underline'>
                        {email}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {customer.contact.phone && (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Phone</span>
                  <a
                    href={`tel:${customer.contact.phone}`}
                    className='text-blue-600 hover:underline'>
                    {customer.contact.phone}
                  </a>
                </div>
              )}

              {customer.contact.tags && customer.contact.tags.length > 0 && (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Tags</span>
                  <div className='flex flex-wrap justify-end gap-1'>
                    {customer.contact.tags.map((tag: string, index: number) => (
                      <Badge key={index} variant='outline' className='text-xs'>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Skeleton component for loading state
function OrderCustomerSkeleton() {
  return (
    <div className='grid gap-6'>
      <Card>
        <CardHeader>
          <CardTitle>Customer Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Name</span>
              <Skeleton className='h-4 w-32' />
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Email</span>
              <Skeleton className='h-4 w-40' />
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Phone</span>
              <Skeleton className='h-4 w-28' />
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Customer Since</span>
              <Skeleton className='h-4 w-24' />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Order History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Total Orders</span>
              <Skeleton className='h-4 w-8' />
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Total Spent</span>
              <Skeleton className='h-4 w-16' />
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Average Order Value</span>
              <Skeleton className='h-4 w-16' />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
