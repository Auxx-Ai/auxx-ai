// apps/web/src/components/drawers/cards/ticket-metrics-card.tsx
'use client'

import type { ActorId } from '@auxx/types/actor'
import { CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { format, formatDistanceToNow } from 'date-fns'
import { Calendar, CircleDot, Clock, Flag, Tags, Users } from 'lucide-react'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import {
  TicketPriorityBadge,
  TicketStatusBadge,
  TicketTypeBadge,
} from '~/components/tickets/ticket-badges'
import type { DrawerTabProps } from '../drawer-tab-registry'

const TICKET_ATTRS = [
  'ticket_status',
  'ticket_type',
  'ticket_priority',
  'assigned_to_id',
  'ticket_created_at',
  'ticket_updated_at',
] as const

/**
 * TicketMetricsCard - 2x2 grid showing status, type, priority, assignee, created/updated dates.
 * Uses the system value hook for all data access.
 */
export function TicketMetricsCard({ recordId }: DrawerTabProps) {
  const { values, isLoading } = useSystemValues(recordId, [...TICKET_ATTRS], { autoFetch: true })

  console.log('TicketMetricsCard values:', values)
  const statusStr = unwrap(values.ticket_status) as string | undefined
  const typeStr = unwrap(values.ticket_type) as string | undefined
  const priorityStr = unwrap(values.ticket_priority) as string | undefined
  const assigneeRaw = unwrap(values.assigned_to_id) as { actorId?: ActorId } | string | undefined
  const assigneeId =
    typeof assigneeRaw === 'object' && assigneeRaw?.actorId
      ? assigneeRaw.actorId
      : (assigneeRaw as ActorId | undefined)
  const isClosed = statusStr === 'CLOSED'

  return (
    <div className='grid grid-cols-2'>
      {/* Status, Type & Priority */}
      <div className='border-r border-b'>
        <CardContent className='py-2'>
          <div className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
              <Tags className='size-4 text-muted-foreground' />
              {isLoading ? (
                <Skeleton className='h-5 w-16' />
              ) : (
                <TicketStatusBadge status={statusStr ?? ''} />
              )}
            </div>
            <div className='flex items-center gap-2'>
              <CircleDot className='size-4 text-muted-foreground' />
              {isLoading ? (
                <Skeleton className='h-5 w-16' />
              ) : (
                <TicketTypeBadge type={typeStr ?? ''} closed={isClosed} />
              )}
            </div>
            <div className='flex items-center gap-2'>
              <Flag className='size-4 text-muted-foreground' />
              {isLoading ? (
                <Skeleton className='h-5 w-16' />
              ) : (
                <TicketPriorityBadge priority={priorityStr ?? ''} closed={isClosed} />
              )}
            </div>
          </div>
        </CardContent>
      </div>

      {/* Assignee */}
      <div className='border-b'>
        <CardHeader className='pb-2 pt-3'>
          <CardTitle className='text-sm font-medium text-muted-foreground'>Assigned To</CardTitle>
        </CardHeader>
        <CardContent className='pb-3'>
          <div className='flex items-start gap-2'>
            <Users className='h-4 w-4 text-muted-foreground mt-0.5' />
            <div className='flex-1'>
              {isLoading ? (
                <Skeleton className='h-5 w-24' />
              ) : assigneeId ? (
                <ActorBadge actorId={assigneeId} />
              ) : (
                <span className='text-sm text-muted-foreground'>Unassigned</span>
              )}
            </div>
          </div>
        </CardContent>
      </div>

      {/* Created Date */}
      <div className='border-r'>
        <CardHeader className='pb-2 pt-3'>
          <CardTitle className='text-sm font-medium text-muted-foreground'>Created</CardTitle>
        </CardHeader>
        <CardContent className='pb-3'>
          <div className='flex items-center gap-2'>
            <Calendar className='h-4 w-4 text-muted-foreground' />
            {isLoading ? (
              <Skeleton className='h-8 w-24' />
            ) : (
              <DateDisplay value={values.ticket_created_at} />
            )}
          </div>
        </CardContent>
      </div>

      {/* Updated Date */}
      <div>
        <CardHeader className='pb-2 pt-3'>
          <CardTitle className='text-sm font-medium text-muted-foreground'>Last Updated</CardTitle>
        </CardHeader>
        <CardContent className='pb-3'>
          <div className='flex items-center gap-2'>
            <Clock className='h-4 w-4 text-muted-foreground' />
            {isLoading ? (
              <Skeleton className='h-8 w-24' />
            ) : (
              <DateDisplay value={values.ticket_updated_at} />
            )}
          </div>
        </CardContent>
      </div>
    </div>
  )
}

/** Extract first element if value is an array (system values return arrays for select fields). */
function unwrap(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

function DateDisplay({ value: raw }: { value: unknown }) {
  const value = unwrap(raw)
  if (!value) return <span className='text-sm text-muted-foreground'>—</span>
  const date = value instanceof Date ? value : new Date(value as string | number)
  if (Number.isNaN(date.getTime())) return <span className='text-sm text-muted-foreground'>—</span>
  return (
    <div>
      <div className='text-sm font-semibold'>{format(date, 'MMM d, yyyy')}</div>
      <div className='text-xs text-muted-foreground'>
        {formatDistanceToNow(date, { addSuffix: true })}
      </div>
    </div>
  )
}
