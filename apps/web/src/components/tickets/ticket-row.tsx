// apps/web/src/components/tickets/ticket-row.tsx

import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, AlertTriangle, Clock, Info, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React from 'react'
import { TicketTypeBadge } from './ticket-badges'

type Props = {
  ticket: any // Replace with proper ticket type
  className?: string
}

/**
 * Get the priority icon and color based on priority level
 */
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

/**
 * Get the status badge styling
 */
function getStatusDisplay(status: string) {
  switch (status) {
    case 'IN_PROGRESS':
      return {
        icon: Clock,
        bg: 'bg-yellow-100',
        text: 'text-yellow-800',
        label: 'In Progress',
      }
    case 'OPEN':
      return {
        icon: Clock,
        bg: 'bg-blue-100',
        text: 'text-blue-800',
        label: 'Open',
      }
    case 'WAITING_FOR_CUSTOMER':
      return {
        icon: Clock,
        bg: 'bg-purple-100',
        text: 'text-purple-800',
        label: 'Waiting',
      }
    case 'RESOLVED':
      return {
        icon: Clock,
        bg: 'bg-green-100',
        text: 'text-green-800',
        label: 'Resolved',
      }
    case 'CLOSED':
      return {
        icon: Clock,
        bg: 'bg-gray-100',
        text: 'text-gray-800',
        label: 'Closed',
      }
    default:
      return {
        icon: Clock,
        bg: 'bg-gray-100',
        text: 'text-gray-800',
        label: status.replace(/_/g, ' '),
      }
  }
}

/** TicketRow component - displays a ticket card that navigates to the ticket drawer */
function TicketRow({ ticket, className }: Props) {
  const router = useRouter()
  const handleViewTicket = (ticketId: string) => {
    // Navigate to tickets page with drawer open via URL param
    router.push(`/app/tickets?t=${ticketId}`)
  }

  const priorityDisplay = getPriorityDisplay(ticket.priority)
  const statusDisplay = getStatusDisplay(ticket.status)
  const PriorityIcon = priorityDisplay.icon
  const StatusIcon = statusDisplay.icon

  return (
    <div
      className={cn(
        'bg-card ring-border-illustration relative cursor-pointer rounded-2xl p-3 shadow shadow-black/10 ring-1 transition-all',
        className
      )}
      onClick={() => handleViewTicket(ticket.id)}>
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
          <div className='font-mono text-lg font-semibold'>#{ticket.number}</div>
          <div className='text-xs text-muted-foreground'>
            Opened {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
          </div>
        </div>
        <div
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-1 text-xs',
            statusDisplay.bg,
            statusDisplay.text
          )}>
          <StatusIcon className='size-3' />
          <span>{statusDisplay.label}</span>
        </div>
      </div>

      <div className='space-y-1.5 [--color-border:color-mix(in_oklab,var(--color-foreground)10%,transparent)]'>
        <div className='border-b pb-3'>
          <div className='mb-2 text-sm font-medium'>{ticket.title}</div>
          {ticket.description && (
            <div className='line-clamp-2 text-xs text-muted-foreground'>{ticket.description}</div>
          )}
        </div>

        <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
          <span className='text-xs text-muted-foreground'>Customer:</span>
          <div className='flex items-center gap-2'>
            <User className='size-3 text-muted-foreground' />
            <span className='text-sm'>
              {ticket.contact?.name || ticket.contact?.email || 'Unknown'}
            </span>
          </div>
        </div>

        {ticket.assignedTo && (
          <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
            <span className='text-xs text-muted-foreground'>Assigned:</span>
            <span className='text-sm'>{ticket.assignedTo.name || ticket.assignedTo.email}</span>
          </div>
        )}

        {ticket.type && (
          <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
            <span className='text-xs text-muted-foreground'>Category:</span>
            <TicketTypeBadge type={ticket.type} />
          </div>
        )}
      </div>
    </div>
  )
}

export default TicketRow
