// apps/web/src/components/drawers/tabs/contact-tickets-tab.tsx

import { Button } from '@auxx/ui/components/button'
import { Plus, TicketIcon } from 'lucide-react'
import React, { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import CreateTicketDialog from '~/components/tickets/create-ticket-dialog'
import TicketRow from '~/components/tickets/ticket-row'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * Tickets tab for contact drawer
 */
export function ContactTicketsTab({ entityInstanceId }: DrawerTabProps) {
  const contactId = entityInstanceId
  const [page, setPage] = useState(1)
  const pageSize = 10
  const utils = api.useUtils()

  // Query tickets for this customer
  const { data, isLoading } = api.ticket.byContactId.useQuery(
    { contactId, page, pageSize },
    {
      enabled: !!contactId,
    }
  )

  // Refetch tickets when a new one is created
  const handleTicketCreated = () => {
    utils.ticket.byContactId.invalidate({ contactId })
  }
  function handleViewTicket(ticketId: string) {
    // Navigate to ticket page
    window.location.href = `/app/tickets/${ticketId}`
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center h-full w-full'>
        <EmptyState
          icon={TicketIcon}
          iconClassName='animate-spin'
          title='Loading tickets'
          description='Fetching tickets for this customer...'
          button={<div className='h-7' />}
        />
      </div>
    )
  } else if (data?.tickets.length === 0) {
    return (
      <div className='flex items-center justify-center h-full w-full'>
        <EmptyState
          icon={TicketIcon}
          title='Create a ticket'
          description='Create a ticket for this contact'
          button={
            <CreateTicketDialog contactId={contactId} onSuccess={handleTicketCreated}>
              <Button variant='outline' size='sm'>
                <Plus />
                Create Ticket
              </Button>
            </CreateTicketDialog>
          }
        />
      </div>
    )
  }

  return (
    <>
      <div className='flex items-center justify-between px-4 pt-3'>
        <h2 className='text-base flex items-center space-x-2 gap-2'>
          <TicketIcon className='size-5 text-muted-foreground/50' />
          Tickets
        </h2>
        <CreateTicketDialog contactId={contactId} onSuccess={handleTicketCreated}>
          <Button variant='outline' size='sm'>
            <Plus />
            Create Ticket
          </Button>
        </CreateTicketDialog>
      </div>
      <div className='space-y-4 m-4'>
        {data?.tickets.map((ticket) => (
          <TicketRow key={ticket.id} ticket={ticket} />
        ))}

        {data?.totalPages && data?.totalPages > 1 && (
          <div className='mt-4 flex items-center justify-between'>
            <Button
              variant='outline'
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}>
              Previous
            </Button>
            <span className='text-sm text-muted-foreground'>
              Page {page} of {data!.totalPages}
            </span>
            <Button
              variant='outline'
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= data!.totalPages}>
              Next
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
