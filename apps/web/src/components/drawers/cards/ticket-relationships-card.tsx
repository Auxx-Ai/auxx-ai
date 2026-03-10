// apps/web/src/components/drawers/cards/ticket-relationships-card.tsx
'use client'

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { GitBranch, Link as LinkIcon } from 'lucide-react'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import type { DrawerTabProps } from '../drawer-tab-registry'

const RELATIONSHIP_ATTRS = ['parent_ticket_id', 'ticket_child_tickets'] as const

/**
 * TicketRelationshipsCard - read-only display of parent/child ticket relationships.
 * Uses the system value hook for parentTicket and childTickets fields.
 */
export function TicketRelationshipsCard({ recordId }: DrawerTabProps) {
  const { values, isLoading } = useSystemValues(recordId, [...RELATIONSHIP_ATTRS], {
    autoFetch: true,
  })

  const parentRecordIds = extractRelationshipRecordIds(values.parent_ticket_id)
  const childRecordIds = extractRelationshipRecordIds(values.ticket_child_tickets)
  const hasRelationships = parentRecordIds.length > 0 || childRecordIds.length > 0

  if (isLoading) {
    return (
      <div className='bg-primary-100/50 rounded-2xl border py-3 px-3'>
        <div className='flex items-center gap-2'>
          <Skeleton className='size-4' />
          <Skeleton className='h-4 w-32' />
        </div>
      </div>
    )
  }

  if (!hasRelationships) {
    return (
      <div className='bg-primary-100/50 rounded-2xl border py-3 px-3'>
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <LinkIcon className='size-4' />
          <span>No related tickets</span>
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {parentRecordIds.length > 0 && (
        <div className='bg-primary-100/50 rounded-2xl border py-2 px-3'>
          <div className='flex items-center gap-2 mb-1'>
            <GitBranch className='size-3.5 text-muted-foreground' />
            <span className='text-xs font-medium text-muted-foreground'>Parent Ticket</span>
          </div>
          <div className='space-y-1'>
            {parentRecordIds.map((id) => (
              <RecordBadge key={id} recordId={id} link />
            ))}
          </div>
        </div>
      )}

      {childRecordIds.length > 0 && (
        <div className='bg-primary-100/50 rounded-2xl border py-2 px-3'>
          <div className='flex items-center gap-2 mb-1'>
            <GitBranch className='size-3.5 text-muted-foreground rotate-180' />
            <span className='text-xs font-medium text-muted-foreground'>
              Child Tickets ({childRecordIds.length})
            </span>
          </div>
          <div className='space-y-1'>
            {childRecordIds.map((id) => (
              <RecordBadge key={id} recordId={id} link />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
