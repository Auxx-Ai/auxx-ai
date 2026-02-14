'use client'

import { Card } from '@auxx/ui/components/card'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@auxx/ui/components/hover-card'
import { cn } from '@auxx/ui/lib/utils'
// import { Badge } from '@auxx/ui/components/badge'
import {
  CalendarIcon,
  ClockIcon,
  ExternalLinkIcon,
  HashIcon,
  TagIcon,
  UserIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import {
  TicketPriorityBadge,
  TicketStatusBadge,
  // TicketTypeBadge,
} from '~/components/tickets/ticket-badges'
import { api } from '~/trpc/react'

// Define the Ticket type based on your schema
type Ticket = {
  id: string
  number: string
  title: string
  description?: string | null
  type:
    | 'GENERAL'
    | 'MISSING_ITEM'
    | 'RETURN'
    | 'REFUND'
    | 'PRODUCT_ISSUE'
    | 'SHIPPING_ISSUE'
    | 'BILLING'
    | 'TECHNICAL'
    | 'OTHER'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  status:
    | 'OPEN'
    | 'IN_PROGRESS'
    | 'WAITING_FOR_CUSTOMER'
    | 'WAITING_FOR_THIRD_PARTY'
    | 'RESOLVED'
    | 'CLOSED'
    | 'CANCELLED'
    | 'MERGED'
  createdAt: Date
  updatedAt: Date
  dueDate?: Date | null
  contact?: {
    id: string
    firstName?: string | null
    lastName?: string | null
    email?: string | null
  } | null
  order?: { id: string; name: string } | null
  // You can add more fields as needed
}

interface TicketHoverCardProps {
  ticketId?: string
  ticket?: Ticket
  children: ReactNode
  className?: string
  showFooterActions?: boolean
}

export function TicketHoverCard({
  ticketId,
  ticket: initialTicket,
  children,
  className,
  showFooterActions = true,
}: TicketHoverCardProps) {
  const [ticket, setTicket] = useState<Ticket | null>(initialTicket || null)
  const [loading, setLoading] = useState(!initialTicket && !!ticketId)

  // Only fetch the ticket data if a ticketId is provided and no initial ticket
  const { data: fetchedTicket } = api.ticket.byId.useQuery(
    { id: ticketId as string },
    {
      enabled: !initialTicket && !!ticketId,
      onSuccess: (data) => {
        setTicket(data)
        setLoading(false)
      },
      onError: () => setLoading(false),
    }
  )

  // Update ticket if fetchedTicket changes
  useEffect(() => {
    if (fetchedTicket) {
      setTicket(fetchedTicket)
    }
  }, [fetchedTicket])

  // Helper function to format date
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  // TicketPriorityBadge
  // TicketStatusBadge
  // TicketTypeBadge

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <div className={cn('cursor-pointer', className)}>{children}</div>
      </HoverCardTrigger>
      <HoverCardContent className='w-80'>
        {loading ? (
          <div className='flex h-32 items-center justify-center'>
            <div className='h-4 w-24 animate-pulse rounded bg-gray-200'></div>
          </div>
        ) : ticket ? (
          <div className='space-y-4'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <HashIcon className='h-4 w-4 text-muted-foreground' />
                  <span className='text-sm font-medium'>{ticket.number}</span>
                </div>
                <TicketStatusBadge status={ticket.status} />
              </div>
              <h4 className='line-clamp-2 text-sm font-semibold'>{ticket.title}</h4>
            </div>

            <div className='grid grid-cols-2 gap-2 text-xs'>
              <div className='flex items-center text-muted-foreground'>
                <TagIcon className='mr-1 h-3 w-3' />
                <span>{ticket.type.replace(/_/g, ' ')}</span>
              </div>
              <div className='flex items-center justify-end'>
                <TicketPriorityBadge priority={ticket.priority} />
              </div>

              <div className='flex items-center text-muted-foreground'>
                <CalendarIcon className='mr-1 h-3 w-3' />
                <span>Created: </span>
              </div>
              <div className='flex items-center justify-end'>{formatDate(ticket.createdAt)}</div>

              {ticket.dueDate && (
                <>
                  <div className='flex items-center justify-end text-muted-foreground'>
                    <ClockIcon className='mr-1 h-3 w-3' />
                    <span>Due: </span>
                  </div>
                  <div className='flex items-center justify-end'>{formatDate(ticket.dueDate)}</div>
                </>
              )}
            </div>

            {ticket.contact && (
              <div className='flex items-center text-xs text-muted-foreground'>
                <UserIcon className='mr-1 h-3 w-3' />
                <span>
                  {ticket.contact.firstName || ticket.contact.lastName
                    ? `${ticket.contact.firstName || ''} ${ticket.contact.lastName || ''}`.trim()
                    : ticket.contact.email || 'Unknown Contact'}
                </span>
              </div>
            )}

            {ticket.description && (
              <Card className='p-2 text-xs'>
                <p className='line-clamp-3'>{ticket.description}</p>
              </Card>
            )}

            {showFooterActions && (
              <div className='flex justify-end gap-2 pt-2 text-xs'>
                <a
                  href={`/app/tickets/${ticket.id}`}
                  className='flex items-center text-blue-600 hover:underline'>
                  <span>View Ticket</span>
                  <ExternalLinkIcon className='ml-1 h-3 w-3' />
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className='p-4 text-center text-muted-foreground'>Ticket not found</div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
