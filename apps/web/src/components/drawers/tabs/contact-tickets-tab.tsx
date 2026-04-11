// apps/web/src/components/drawers/tabs/contact-tickets-tab.tsx

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Loader2, Plus, TicketIcon } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useInView } from 'react-intersection-observer'
import { EmptyState } from '~/components/global/empty-state'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import CreateTicketDialog from '~/components/tickets/create-ticket-dialog'
import TicketRow from '~/components/tickets/ticket-row'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * Tickets tab for contact drawer
 * Uses useRecordList with a relationship filter to fetch tickets for this contact
 */
export function ContactTicketsTab({ entityInstanceId }: DrawerTabProps) {
  const contactId = entityInstanceId
  const entityDefinitionId = useResourceProperty('ticket', 'id')

  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'contact-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'contact-match',
            fieldId: 'ticket:contact' as ResourceFieldId,
            operator: 'is' as const,
            value: contactId,
          },
        ],
      },
    ],
    [contactId]
  )

  const { records, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage, refresh } =
    useRecordList({
      entityDefinitionId: entityDefinitionId ?? '',
      filters,
      limit: 20,
      enabled: !!contactId && !!entityDefinitionId,
    })

  const { ref, inView } = useInView({ threshold: 0 })
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [inView, fetchNextPage, hasNextPage, isFetchingNextPage])

  if (isLoading) {
    return (
      <div className='flex flex-1 items-center justify-center w-full'>
        <EmptyState
          icon={TicketIcon}
          iconClassName='animate-spin'
          title='Loading tickets'
          description='Fetching tickets for this customer...'
          button={<div className='h-7' />}
        />
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center w-full'>
        <EmptyState
          icon={TicketIcon}
          title='Create a ticket'
          description='Create a ticket for this contact'
          button={
            <CreateTicketDialog contactId={contactId} onSuccess={refresh}>
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
    <ScrollArea className='flex-1'>
      <Section
        title='Tickets'
        className='flex flex-col flex-1 min-h-0 w-full [&_[data-slot=section]]:flex-1 [&_[data-slot=section]]:border-b-0 [&_[data-slot=section-content]]:flex-1'
        collapsible={false}
        icon={<TicketIcon className='size-4 text-muted-foreground/50' />}
        actions={
          <CreateTicketDialog contactId={contactId} onSuccess={refresh}>
            <Button variant='ghost' size='sm'>
              <Plus />
              Create Ticket
            </Button>
          </CreateTicketDialog>
        }>
        <div className='space-y-4 sm:p-4'>
          {records.map((record) => (
            <TicketRow
              key={record.id}
              recordId={toRecordId(entityDefinitionId!, record.id)}
              createdAt={record.createdAt}
              onActionComplete={refresh}
            />
          ))}
        </div>

        <div className='pb-4'>
          {isFetchingNextPage && (
            <div className='flex h-8 w-full items-center justify-center'>
              <Loader2 className='h-4 w-4 animate-spin' />
            </div>
          )}
          <div ref={ref} className='h-1' />
        </div>
      </Section>
    </ScrollArea>
  )
}
