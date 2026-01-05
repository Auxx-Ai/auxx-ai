// apps/web/src/app/(protected)/app/tickets/_components/ticket-columns.tsx

'use client'

import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { FormattedCell, CellPadding, PrimaryCell } from '~/components/dynamic-table'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@auxx/ui/components/dropdown-menu'
import {
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
import { useTableContext } from '~/components/dynamic-table'
import type { Ticket } from './ticket-types'

/**
 * Type cell component - can access table context for inline editing
 */
function TicketTypeCell({ ticket }: { ticket: Ticket }) {
  const { table } = useTableContext<Ticket>()
  const closed = ticket.status === 'CLOSED'

  // TODO: Add inline editing via dropdown using table context
  return (
    <FormattedCell
      value={null}
      fieldType="ITEMS"
      columnId="type"
      items={[{ id: ticket.type }]}
      renderItem={() => <TicketTypeBadge type={ticket.type} closed={closed} />}
    />
  )
}

/**
 * Status cell component - can access table context for inline editing
 */
function TicketStatusCell({ ticket }: { ticket: Ticket }) {
  const { table } = useTableContext<Ticket>()
  const closed = ticket.status === 'CLOSED'

  // TODO: Add inline editing via dropdown using table context
  return (
    <FormattedCell
      value={null}
      fieldType="ITEMS"
      columnId="status"
      items={[{ id: ticket.status }]}
      renderItem={() => <TicketStatusBadge status={ticket.status} closed={closed} />}
    />
  )
}

/**
 * Priority cell component - can access table context for inline editing
 */
function TicketPriorityCell({ ticket }: { ticket: Ticket }) {
  const { table } = useTableContext<Ticket>()
  const closed = ticket.status === 'CLOSED'

  // TODO: Add inline editing via dropdown using table context
  return (
    <FormattedCell
      value={null}
      fieldType="ITEMS"
      columnId="priority"
      items={[{ id: ticket.priority }]}
      renderItem={() => <TicketPriorityBadge priority={ticket.priority} closed={closed} />}
    />
  )
}

/**
 * Contact cell component - can access table context for inline editing
 */
function TicketContactCell({ ticket }: { ticket: Ticket }) {
  const { table } = useTableContext<Ticket>()
  const contact = ticket.contact

  // TODO: Add inline editing via contact picker using table context
  return (
    <CellPadding>
      <ContactHoverCard contact={contact}>
        <div className="cursor-pointer hover:underline text-sm">
          <div className="font-medium">{getFullName(contact)}</div>
        </div>
      </ContactHoverCard>
    </CellPadding>
  )
}

/**
 * Due date cell component - can access table context for inline editing
 */
function TicketDueDateCell({ ticket }: { ticket: Ticket }) {
  const { table } = useTableContext<Ticket>()
  const { text, isOverdue, isDueToday } = formatDueDate(ticket.dueDate)
  const isClosed = ticket.status === 'CLOSED'

  // TODO: Add inline editing via date picker using table context
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
}

/**
 * Assignments cell component - can access table context for inline editing
 */
function TicketAssignmentsCell({
  ticket,
  onAssign,
}: {
  ticket: Ticket
  onAssign?: (ticket: Ticket) => void
}) {
  const { table } = useTableContext<Ticket>()
  const assignments = ticket.assignments

  // TODO: Add inline editing via agent picker using table context
  if (assignments.length === 0) {
    return (
      <CellPadding>
        <Button
          variant="ghost"
          size="xs"
          onClick={(e) => {
            e.stopPropagation()
            onAssign?.(ticket)
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
}

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
        <PrimaryCell
          value={row.original.title}
          onTitleClick={() => onViewDetails(row.original)}>
          <DropdownMenuItem onClick={() => onViewDetails(row.original)}>
            <Eye />
            View Details
          </DropdownMenuItem>
          {onReply && (
            <DropdownMenuItem onClick={() => onReply(row.original)}>
              <MessageSquare />
              Reply
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => onEdit(row.original)}>
            <Edit />
            Edit Ticket
          </DropdownMenuItem>
          {onAssign && (
            <DropdownMenuItem onClick={() => onAssign(row.original)}>
              <User />
              Assign Agent
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(row.original)}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </PrimaryCell>
      ),
      size: 300,
      minSize: 200,
      enableSorting: true,
      enableHiding: false,
      icon: TextAlignStart,
      primaryCell: true,
    },
    {
      accessorKey: 'contact',
      header: 'Customer',
      cell: ({ row }) => <TicketContactCell ticket={row.original} />,
      size: 200,
      enableSorting: false,
      icon: User,
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => <TicketTypeCell ticket={row.original} />,
      size: 130,
      enableSorting: true,
      icon: Bookmark,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <TicketStatusCell ticket={row.original} />,
      size: 150,
      enableSorting: true,
      icon: Tag,
    },
    {
      accessorKey: 'priority',
      header: 'Priority',
      cell: ({ row }) => <TicketPriorityCell ticket={row.original} />,
      size: 120,
      enableSorting: true,
      icon: CircleAlert,
    },
    {
      accessorKey: 'dueDate',
      header: 'Due Date',
      cell: ({ row }) => <TicketDueDateCell ticket={row.original} />,
      size: 130,
      enableSorting: true,
      icon: CalendarClock,
      fieldType: 'DATE',
    },
    {
      accessorKey: 'assignments',
      header: 'Assigned To',
      cell: ({ row }) => <TicketAssignmentsCell ticket={row.original} onAssign={onAssign} />,
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
