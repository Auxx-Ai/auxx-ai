// apps/web/src/app/(protected)/app/tickets/_components/ticket-columns.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { FormattedCell, CellPadding } from '~/components/dynamic-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  MessageSquare,
  User,
  Calendar,
  CalendarClock,
  Fingerprint,
  TextAlignStart,
  Tag,
  CircleAlert,
  Bookmark,
} from 'lucide-react'
import { differenceInDays, isToday, isPast } from 'date-fns'
import {
  TicketPriorityBadge,
  TicketStatusBadge,
  TicketTypeBadge,
} from '~/components/tickets/ticket-badges'
import { getFullName } from '@auxx/lib/utils'
import { ContactHoverCard } from '~/components/contacts/contact-hover-card'
import type { Ticket } from './ticket-provider'

/**
 * Formats a due date into a human-readable relative string
 */
function formatDueDate(dueDate: string | null | undefined): {
  text: string
  isOverdue: boolean
  isDueToday: boolean
} {
  if (!dueDate) {
    return { text: '—', isOverdue: false, isDueToday: false }
  }

  const date = new Date(dueDate)
  const now = new Date()

  if (isToday(date)) {
    return { text: 'Due today', isOverdue: false, isDueToday: true }
  }

  if (isPast(date)) {
    const daysOverdue = differenceInDays(now, date)
    return {
      text: daysOverdue === 1 ? 'Overdue 1 day' : `Overdue ${daysOverdue} days`,
      isOverdue: true,
      isDueToday: false,
    }
  }

  const daysUntil = differenceInDays(date, now)
  return {
    text: daysUntil === 1 ? 'Due in 1 day' : `Due in ${daysUntil} days`,
    isOverdue: false,
    isDueToday: false,
  }
}

interface TicketColumnsActions {
  onViewDetails: (ticket: Ticket) => void
  onEdit: (ticket: Ticket) => void
  onDelete: (ticket: Ticket) => void
  onAssign?: (ticket: Ticket) => void
  onReply?: (ticket: Ticket) => void
}

/**
 * Props for TicketTitleCell component
 */
interface TicketTitleCellProps {
  ticket: Ticket
  onViewDetails: (ticket: Ticket) => void
  onEdit: (ticket: Ticket) => void
  onDelete: (ticket: Ticket) => void
  onAssign?: (ticket: Ticket) => void
  onReply?: (ticket: Ticket) => void
}

/**
 * Ticket title cell component with integrated actions
 * Shows the ticket title as clickable link and actions dropdown on hover
 * Handles its own padding for proper table cell layout
 */
function TicketTitleCell({
  ticket,
  onViewDetails,
  onEdit,
  onDelete,
  onAssign,
  onReply,
}: TicketTitleCellProps) {
  return (
    <div className="flex items-center justify-between w-full pl-3 pr-2 text-sm group/title">
      <button
        className="text-left underline decoration-muted-foreground/50 hover:decoration-primary truncate max-w-[calc(100%-40px)] font-medium"
        onClick={(e) => {
          e.stopPropagation()
          onViewDetails(ticket)
        }}>
        {ticket.title || 'Untitled'}
      </button>

      <div onClick={(e) => e.stopPropagation()} className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-6 p-0 opacity-0 group-hover/title:opacity-100 transition-opacity">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onViewDetails(ticket)}>
              <Eye />
              View Details
            </DropdownMenuItem>
            {onReply && (
              <DropdownMenuItem onClick={() => onReply(ticket)}>
                <MessageSquare />
                Reply
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onEdit(ticket)}>
              <Edit />
              Edit Ticket
            </DropdownMenuItem>
            {onAssign && (
              <DropdownMenuItem onClick={() => onAssign(ticket)}>
                <User />
                Assign Agent
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(ticket)}
              className="text-destructive focus:text-destructive">
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function createTicketColumns({
  onViewDetails,
  onEdit,
  onDelete,
  onAssign,
  onReply,
}: TicketColumnsActions): ExtendedColumnDef<Ticket>[] {
  return [
    {
      accessorKey: 'number',
      header: 'Ticket ID',
      cell: ({ row }) => (
        <CellPadding className="font-mono text-xs">#{row.getValue('number')}</CellPadding>
      ),
      size: 100,
      enableSorting: true,
      icon: Fingerprint,
    },
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <TicketTitleCell
          ticket={row.original}
          onViewDetails={onViewDetails}
          onEdit={onEdit}
          onDelete={onDelete}
          onAssign={onAssign}
          onReply={onReply}
        />
      ),
      size: 300,
      minSize: 200,
      enableSorting: true,
      enableHiding: false,
      icon: TextAlignStart,
      defaultPinned: true,
    },
    {
      accessorKey: 'contact',
      header: 'Customer',
      cell: ({ row }) => {
        const contact = row.original.contact
        return (
          <CellPadding>
            <ContactHoverCard contact={contact}>
              <div className="cursor-pointer hover:underline text-sm">
                <div className="font-medium">{getFullName(contact)}</div>
              </div>
            </ContactHoverCard>
          </CellPadding>
        )
      },
      size: 200,
      enableSorting: false,
      icon: User,
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => {
        const type = row.getValue('type') as string
        const closed = row.original.status === 'CLOSED'
        return (
          <FormattedCell
            value={null}
            fieldType="ITEMS"
            columnId="type"
            items={[{ id: type }]}
            renderItem={() => <TicketTypeBadge type={type} closed={closed} />}
          />
        )
      },
      size: 130,
      enableSorting: true,
      icon: Bookmark,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string
        const closed = row.original.status === 'CLOSED'
        return (
          <FormattedCell
            value={null}
            fieldType="ITEMS"
            columnId="status"
            items={[{ id: status }]}
            renderItem={() => <TicketStatusBadge status={status} closed={closed} />}
          />
        )
      },
      size: 150,
      enableSorting: true,
      icon: Tag,
    },
    {
      accessorKey: 'priority',
      header: 'Priority',
      cell: ({ row }) => {
        const priority = row.getValue('priority') as string
        const closed = row.original.status === 'CLOSED'
        return (
          <FormattedCell
            value={null}
            fieldType="ITEMS"
            columnId="priority"
            items={[{ id: priority }]}
            renderItem={() => <TicketPriorityBadge priority={priority} closed={closed} />}
          />
        )
      },
      size: 120,
      enableSorting: true,
      icon: CircleAlert,
    },
    {
      accessorKey: 'dueDate',
      header: 'Due Date',
      cell: ({ row }) => {
        const { text, isOverdue, isDueToday } = formatDueDate(row.original.dueDate)
        const isClosed = row.original.status === 'CLOSED'

        return (
          <CellPadding
            className={
              isClosed
                ? 'text-muted-foreground'
                : isOverdue
                  ? 'text-destructive font-medium'
                  : isDueToday
                    ? 'text-warning font-medium'
                    : 'text-muted-foreground'
            }>
            <span className="text-sm">{text}</span>
          </CellPadding>
        )
      },
      size: 130,
      enableSorting: true,
      icon: CalendarClock,
      fieldType: 'DATE',
    },
    {
      accessorKey: 'assignments',
      header: 'Assigned To',
      cell: ({ row }) => {
        const assignments = row.original.assignments
        if (assignments.length === 0) {
          return (
            <CellPadding>
              <Button
                variant="ghost"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation()
                  onAssign?.(row.original)
                }}>
                <User />
                Unassigned
              </Button>
            </CellPadding>
          )
        }

        return (
          <CellPadding>
            <div className="space-y-0.5">
              {assignments.map((assignment) => (
                <div key={assignment.id} className="text-sm">
                  <span className="font-medium">
                    {assignment.agent.name || assignment.agent.email.split('@')[0]}
                  </span>
                </div>
              ))}
            </div>
          </CellPadding>
        )
      },
      size: 180,
      enableSorting: false,
      icon: User,
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ getValue }) => (
        <FormattedCell value={getValue()} fieldType="DATE" columnId="createdAt" />
      ),
      size: 110,
      enableSorting: true,
      icon: Calendar,
      fieldType: 'DATE',
      columnType: 'date',
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
      cell: ({ getValue }) => (
        <FormattedCell value={getValue()} fieldType="DATE" columnId="updatedAt" />
      ),
      size: 110,
      enableSorting: true,
      icon: Calendar,
      fieldType: 'DATE',
      columnType: 'date',
    },
  ]
}
