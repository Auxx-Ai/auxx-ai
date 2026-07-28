// apps/web/src/components/drawers/tabs/contact-tickets-tab.tsx

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Loader2, Plus, TicketIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useInView } from 'react-intersection-observer'
import { EmptyState } from '~/components/global/empty-state'
import { RecordEditorDialog } from '~/components/records/record-editor-dialog'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import TicketRow from '~/components/tickets/ticket-row'
import { useAccess } from '~/providers/capabilities-provider'
import type { DrawerTabProps } from '../drawer-tab-registry'

/** Contact relationship field on the ticket def — also the filter key below. */
const TICKET_CONTACT_FIELD = 'ticket:contact'

/**
 * Tickets tab for contact drawer
 * Uses useRecordList with a relationship filter to fetch tickets for this contact.
 * Creating a ticket opens the generic {@link RecordEditorDialog} (matching the
 * records view) with the contact relationship pre-filled.
 */
export function ContactTicketsTab({ entityInstanceId }: DrawerTabProps) {
  const contactId = entityInstanceId
  const entityDefinitionId = useResourceProperty('ticket', 'id')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  // The tab itself is gated on READ of the ticket definition (drawer config
  // `recordResource`); creating from here additionally needs WRITE on it — a
  // `tickets: Read` member sees the list without a create affordance.
  const { canEditEntity } = useAccess()
  const canCreate = !!entityDefinitionId && canEditEntity(entityDefinitionId)

  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'contact-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'contact-match',
            fieldId: TICKET_CONTACT_FIELD as ResourceFieldId,
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

  // Generic create dialog, pre-linked to this contact. Shared across the empty
  // and populated states below.
  const createDialog = canCreate && (
    <RecordEditorDialog
      open={isCreateOpen}
      onOpenChange={setIsCreateOpen}
      entityDefinitionId='ticket'
      presetValues={{ [TICKET_CONTACT_FIELD]: [toRecordId('contact', contactId)] }}
      onSaved={() => {
        setIsCreateOpen(false)
        refresh()
      }}
    />
  )

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
          title={canCreate ? 'Create a ticket' : 'No tickets'}
          description={
            canCreate ? 'Create a ticket for this contact' : 'This contact has no tickets yet'
          }
          button={
            canCreate ? (
              <Button variant='outline' size='sm' onClick={() => setIsCreateOpen(true)}>
                <Plus />
                Create Ticket
              </Button>
            ) : undefined
          }
        />
        {createDialog}
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
          canCreate ? (
            <Button variant='ghost' size='sm' onClick={() => setIsCreateOpen(true)}>
              <Plus />
              Create Ticket
            </Button>
          ) : undefined
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
      {createDialog}
    </ScrollArea>
  )
}
