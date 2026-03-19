// apps/web/src/app/(protected)/app/contacts/_components/customer-tickets-tab.tsx

/**
 * @deprecated Use ContactTicketsTab from drawer tabs instead.
 * This component is kept for the deprecated contact-detail.tsx.
 */

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ResourceFieldId } from '@auxx/types/field'
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
import { useMemo } from 'react'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import CreateTicketDialog from '~/components/tickets/create-ticket-dialog'
import TicketRow from '~/components/tickets/ticket-row'

interface CustomerTicketsTabProps {
  customer: any
  contactId: string
}

export default function CustomerTicketsTab({ customer, contactId }: CustomerTicketsTabProps) {
  const router = useRouter()
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

  const { records, isLoading } = useRecordList({
    entityDefinitionId: entityDefinitionId ?? '',
    filters,
    limit: 20,
    enabled: !!contactId && !!entityDefinitionId,
  })

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

  if (records.length === 0) {
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
            <Button onClick={() => router.push(`/app/tickets/create?customerId=${contactId}`)}>
              <Plus /> Create Ticket
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

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

      <div className='flex-1'>
        <CardContent className='py-4 px-6'>
          <div className='space-y-4'>
            {records.map((record) => (
              <TicketRow
                key={record.id}
                recordId={toRecordId(entityDefinitionId!, record.id)}
                createdAt={record.createdAt}
                className='cursor-pointer'
              />
            ))}
          </div>
        </CardContent>
      </div>
    </div>
  )
}
