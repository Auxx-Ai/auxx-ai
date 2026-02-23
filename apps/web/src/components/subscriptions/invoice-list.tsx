// app/(protected)/app/settings/plans/_components/invoice-list.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { format, isFuture } from 'date-fns'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Download,
  FileText,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'

export function InvoiceList() {
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const { data, isLoading, isFetching, hasNextPage, fetchNextPage } =
    api.billing.getInvoices.useInfiniteQuery(
      { limit: 10, cursor },
      { getNextPageParam: (lastPage) => lastPage.nextCursor }
    )

  const { data: subscription } = api.billing.getCurrentSubscription.useQuery()

  // Function to determine status badge styling based on invoice status
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return (
          <span className='inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-800 dark:text-green-100'>
            <CheckCircle className='mr-1 h-3 w-3' /> Paid
          </span>
        )
      case 'PENDING':
        return (
          <span className='inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-800 dark:text-amber-100'>
            Pending
          </span>
        )
      case 'VOID':
        return (
          <span className='inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-300'>
            Void
          </span>
        )
      case 'UNCOLLECTIBLE':
        return (
          <span className='inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-800 dark:text-red-100'>
            <AlertTriangle className='mr-1 h-3 w-3' /> Failed
          </span>
        )
      default:
        return (
          <span className='inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-300'>
            {status}
          </span>
        )
    }
  }

  // Function to format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
      amount / 100
    )
  }

  // Combine all pages of invoices
  const invoices = data?.pages.flatMap((page) => page.items) || []

  // Loading state
  if (isLoading) {
    return (
      <div>
        <div className='flex flex-col space-y-1.5 p-3'>
          <Skeleton className='mb-2 h-7 w-64' />
          <Skeleton className='h-4 w-96' />
        </div>
        <div className='p-0 pt-0'>
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Skeleton className='h-4 w-32' />
                  </TableHead>
                  <TableHead>
                    <Skeleton className='h-4 w-24' />
                  </TableHead>
                  <TableHead>
                    <Skeleton className='h-4 w-24' />
                  </TableHead>
                  <TableHead>
                    <Skeleton className='h-4 w-20' />
                  </TableHead>
                  <TableHead className='text-right'>
                    <Skeleton className='ml-auto h-4 w-16' />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[1, 2, 3, 4].map((i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className='h-4 w-28' />
                    </TableCell>
                    <TableCell>
                      <Skeleton className='h-4 w-24' />
                    </TableCell>
                    <TableCell>
                      <Skeleton className='h-4 w-20' />
                    </TableCell>
                    <TableCell>
                      <Skeleton className='h-5 w-16' />
                    </TableCell>
                    <TableCell className='text-right'>
                      <Skeleton className='ml-auto h-9 w-9' />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    )
  }

  // If no subscription
  if (!subscription) {
    return (
      <div className='flex-1 h-full  items-center flex justify-center'>
        <EmptyState
          icon={AlertCircle}
          title='No Subscriptions'
          className='pt-4 pb-0'
          iconClassName='size-8'
          description={<>You don't have any subscriptions yet</>}
          button={
            <Button size='sm' variant='outline' asChild>
              <Link href='/app/settings/plans'>View Plans</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className='flex-1 h-full flex flex-col'>
      {invoices.length === 0 ? (
        <EmptyState
          icon={FileText}
          title='No invoices yet'
          className='pt-4 pb-0'
          iconClassName='size-8'
          description={<>Your billing history will appear here once you have been billed.</>}
        />
      ) : (
        // <div className="rounded-md border p-6 text-center">
        //   <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        //   <h3 className="mb-2 text-lg font-medium">No invoices yet</h3>
        //   <p className="text-muted-foreground">
        //     Your billing history will appear here once you have been billed.
        //   </p>
        // </div>
        <>
          <div className='p-0 overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className='font-medium'>{invoice.invoiceNumber}</TableCell>
                    <TableCell>{format(new Date(invoice.invoiceDate), 'MMM d, yyyy')}</TableCell>
                    <TableCell>{formatCurrency(invoice.amount)}</TableCell>
                    <TableCell>
                      {invoice.status === 'PENDING' && isFuture(new Date(invoice.dueDate)) ? (
                        <span className='inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-800 dark:text-blue-100'>
                          Upcoming
                        </span>
                      ) : (
                        getStatusBadge(invoice.status)
                      )}
                    </TableCell>
                    <TableCell className='text-right'>
                      {invoice.pdfUrl ? (
                        <Button variant='ghost' size='sm' asChild className='h-8 w-8 p-0'>
                          <a
                            href={invoice.pdfUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            aria-label='Download invoice'>
                            <Download className='h-4 w-4' />
                          </a>
                        </Button>
                      ) : (
                        <Button variant='ghost' size='sm' disabled className='h-8 w-8 p-0'>
                          <Download className='h-4 w-4 text-muted-foreground' />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {hasNextPage && (
            <div className='mt-4 flex justify-center'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => fetchNextPage()}
                disabled={isFetching}
                className='gap-1'
                loading={isFetching}
                loadingText='Loading...'>
                Load more
                <ChevronRight />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
