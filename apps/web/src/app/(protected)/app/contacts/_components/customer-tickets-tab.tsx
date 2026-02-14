// apps/web/src/app/(protected)/app/contacts/_components/customer-tickets-tab.tsx

import { Button } from '@auxx/ui/components/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { Loader2, Plus, Ticket } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import CreateTicketDialog from '~/components/tickets/create-ticket-dialog'
import TicketRow from '~/components/tickets/ticket-row'
import { api } from '~/trpc/react'

interface CustomerTicketsTabProps {
  customer: any // Replace with proper type
  contactId: string
}

/**
 * CustomerTicketsTab displays tickets associated with a customer contact.
 */
export default function CustomerTicketsTab({ customer, contactId }: CustomerTicketsTabProps) {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const pageSize = 10

  // Query tickets for this customer
  const { data: ticketsData, isLoading } = api.ticket.byContactId.useQuery(
    { contactId, page, pageSize },
    {
      enabled: !!contactId,
    }
  )

  const handleCreateTicket = () => {
    router.push(`/app/tickets/create?customerId=${contactId}`)
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
            <EmptyTitle>Loading tickets...</EmptyTitle>
            <EmptyDescription>Fetching support tickets</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  // No tickets found
  if (!ticketsData?.tickets || ticketsData.tickets.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center flex-1'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Ticket />
            </EmptyMedia>
            <EmptyTitle>No tickets found</EmptyTitle>
            <EmptyDescription>
              This customer hasn't submitted any support tickets yet.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={handleCreateTicket}>
              <Plus /> Create Ticket
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  // Tickets list
  return (
    <div className='flex flex-col flex-1 min-h-0 overflow-y-auto'>
      <CardHeader className='pb-3 border-b border-primary-200/50 shrink-0 sticky top-0 bg-background/80 backdrop-blur z-10'>
        <div className='flex items-center justify-between'>
          <div>
            <CardTitle>Tickets</CardTitle>
            <CardDescription>Support tickets associated with this customer</CardDescription>
          </div>
          <CreateTicketDialog contactId={contactId} onSuccess={() => {}} />
        </div>
      </CardHeader>

      <div className='flex-1 '>
        <CardContent className='py-4 px-6'>
          <div className='space-y-4'>
            {ticketsData.tickets.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} className='cursor-pointer' />
            ))}

            {ticketsData.totalPages > 1 && (
              <div className='mt-4 flex items-center justify-between'>
                <Button
                  variant='outline'
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}>
                  Previous
                </Button>
                <span className='text-sm text-muted-foreground'>
                  Page {page} of {ticketsData.totalPages}
                </span>
                <Button
                  variant='outline'
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= ticketsData.totalPages}>
                  Next
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </div>
    </div>
  )
}
