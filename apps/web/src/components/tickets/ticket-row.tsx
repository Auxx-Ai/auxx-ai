// apps/web/src/components/tickets/ticket-row.tsx

import type { RecordId } from '@auxx/lib/resources/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, AlertTriangle, Clock, Info } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { TicketTypeBadge } from './ticket-badges'
import { TicketRowActions } from './ticket-row-actions'

/** System attributes for ticket fields */
const TICKET_ATTRS = [
  'ticket_title',
  'ticket_number',
  'ticket_status',
  'ticket_priority',
  'ticket_type',
  'ticket_description',
] as const

type Props = {
  recordId: RecordId
  createdAt: string | Date
  className?: string
  onActionComplete?: () => void
}

/** Get the priority icon and color based on priority level */
function getPriorityDisplay(priority: string) {
  switch (priority) {
    case 'URGENT':
      return {
        icon: AlertCircle,
        iconBg: 'bg-red-500',
        iconText: 'text-white',
        label: 'URGENT',
        labelColor: 'text-red-600',
      }
    case 'HIGH':
      return {
        icon: AlertTriangle,
        iconBg: 'bg-orange-500',
        iconText: 'text-white',
        label: 'HIGH PRIORITY',
        labelColor: 'text-orange-600',
      }
    case 'MEDIUM':
      return {
        icon: Info,
        iconBg: 'bg-blue-500',
        iconText: 'text-white',
        label: 'MEDIUM',
        labelColor: 'text-blue-600',
      }
    default:
      return {
        icon: Info,
        iconBg: 'bg-slate-500',
        iconText: 'text-white',
        label: 'LOW',
        labelColor: 'text-slate-600',
      }
  }
}

/** Get the status badge styling */
function getStatusDisplay(status: string) {
  switch (status) {
    case 'IN_PROGRESS':
      return {
        className: 'bg-yellow-100 text-yellow-800',
        label: 'In Progress',
      }
    case 'OPEN':
      return { className: 'bg-blue-100 text-blue-800', label: 'Open' }
    case 'WAITING_FOR_CUSTOMER':
      return {
        className: 'bg-purple-100 text-purple-800',
        label: 'Waiting',
      }
    case 'RESOLVED':
      return { className: 'bg-green-100 text-green-800', label: 'Resolved' }
    case 'CLOSED':
      return { className: 'bg-gray-100 text-gray-800', label: 'Closed' }
    default:
      return {
        className: 'bg-gray-100 text-gray-800',
        label: (status + '').replace(/_/g, ' '),
      }
  }
}

/** TicketRow component - displays a ticket card using the field value store */
function TicketRow({ recordId, createdAt, className, onActionComplete }: Props) {
  const router = useRouter()

  const { values, isLoading } = useSystemValues(recordId, TICKET_ATTRS, { autoFetch: true })

  const unwrap = (v: unknown): string => {
    const raw = Array.isArray(v) ? v[0] : v
    return (raw as string) ?? ''
  }

  const title = unwrap(values.ticket_title)
  const number = unwrap(values.ticket_number)
  const status = unwrap(values.ticket_status)
  const priority = unwrap(values.ticket_priority)
  const type = unwrap(values.ticket_type)
  const description = unwrap(values.ticket_description)

  // Extract instance ID from recordId (format: "entityDefinitionId:instanceId")
  const instanceId = recordId.split(':').slice(1).join(':')

  if (isLoading) {
    return (
      <div
        className={cn(
          'bg-card ring-border-illustration relative rounded-2xl p-3 shadow shadow-black/10 ring-1',
          className
        )}>
        <div className='mb-2 flex items-start justify-between'>
          <div className='space-y-1'>
            {/* Priority row: icon + label */}
            <div className='flex items-center gap-2'>
              <Skeleton className='size-5 rounded-full' />
              <Skeleton className='h-3 w-16' />
            </div>
            {/* Ticket number */}
            <Skeleton className='h-7 w-24' />
            {/* Created date */}
            <Skeleton className='h-3 w-28' />
          </div>
          {/* Status badge */}
          <Skeleton className='h-6 w-20 rounded-full' />
        </div>
        <div className='space-y-1.5 [--color-border:color-mix(in_oklab,var(--color-foreground)10%,transparent)]'>
          <div className='border-b pb-3'>
            {/* Title */}
            <Skeleton className='mb-2 h-5 w-3/4' />
            {/* Description (1 line) */}
            <Skeleton className='h-3 w-full' />
          </div>
          {/* Category row */}
          <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
            <Skeleton className='h-3 w-14' />
            <Skeleton className='h-5 w-16 rounded-full' />
          </div>
        </div>
      </div>
    )
  }

  const priorityDisplay = getPriorityDisplay(priority)
  const statusDisplay = getStatusDisplay(status)
  const PriorityIcon = priorityDisplay.icon

  return (
    <div
      className={cn(
        'bg-card ring-border-illustration relative rounded-2xl p-3 shadow shadow-black/10 ring-1 transition-all',
        className
      )}>
      <div className='mb-2 flex items-start justify-between'>
        <div className='space-y-1'>
          <div className='flex items-center gap-2'>
            <div className={cn('rounded-full p-1', priorityDisplay.iconBg)}>
              <PriorityIcon className={cn('size-3', priorityDisplay.iconText)} />
            </div>
            <span className={cn('text-xs font-medium uppercase', priorityDisplay.labelColor)}>
              {priorityDisplay.label}
            </span>
          </div>
          {number && (
            <div
              className='cursor-pointer font-mono text-lg font-semibold hover:underline'
              onClick={() => router.push(`/app/tickets/${instanceId}`)}>
              #{number}
            </div>
          )}
          <div className='text-xs text-muted-foreground'>
            Opened {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
          </div>
        </div>
        <div
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-1 text-xs',
            statusDisplay.className
          )}>
          <Clock className='size-3' />
          <span>{statusDisplay.label}</span>
        </div>
      </div>

      <div className='space-y-1.5 [--color-border:color-mix(in_oklab,var(--color-foreground)10%,transparent)]'>
        <div className='border-b pb-3'>
          {title && (
            <div
              className='mb-2 cursor-pointer text-sm font-medium hover:underline'
              onClick={() => router.push(`/app/tickets/${instanceId}`)}>
              {title}
            </div>
          )}
          {description && (
            <div className='line-clamp-2 text-xs text-muted-foreground'>{description}</div>
          )}
        </div>

        <div className='flex items-center justify-between'>
          {type && (
            <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
              <span className='text-xs text-muted-foreground'>Category:</span>
              <TicketTypeBadge type={type} />
            </div>
          )}
          <TicketRowActions
            recordId={recordId}
            status={status}
            priority={priority}
            onActionComplete={onActionComplete}
          />
        </div>
      </div>
    </div>
  )
}

export default TicketRow
