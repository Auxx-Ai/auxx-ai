'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table'
import { ChevronDownIcon, ChevronUpIcon, Plus, Ticket } from 'lucide-react'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  TicketPriorityBadge,
  TicketStatusBadge,
  TicketTypeBadge,
} from '../../../../../components/tickets/ticket-badges'
import { getFullName } from '@auxx/lib/utils'
import { ContactHoverCard } from '~/components/contacts/contact-hover-card'
import { cn } from '@auxx/ui/lib/utils'
import { EmptyState } from '~/components/global/empty-state'
import { Button } from '@auxx/ui/components/button'
import Link from 'next/link'

export type Ticket = {
  id: string
  number: string
  title: string
  contact: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
  } // Adjusted to match the original comment
  // customer: { name: string | null; email: string | null }
  type: string
  status: string
  priority: string
  assignments: { id: string; agent: { name: string | null; email: string } }[]
  updatedAt: string
  createdAt: string
}

interface TicketTableProps {
  tickets: Ticket[]
  isLoading: boolean
  isFetchingNextPage: boolean
  onRowSelectionChange?: (rowSelection: RowSelectionState) => void
  loadMoreRef?: React.RefObject<HTMLTableRowElement>
}

export function TicketTable({
  tickets,
  isLoading,
  isFetchingNextPage,
  onRowSelectionChange,
  loadMoreRef,
}: TicketTableProps) {
  const router = useRouter()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'updatedAt', desc: true }])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const columns: ColumnDef<Ticket>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableResizing: false,
      size: 40,
    },
    {
      header: 'ID',
      accessorKey: 'number',
      cell: ({ row }) => <div className="font-mono text-xs">{row.getValue('number')}</div>,
      size: 100,
    },
    {
      header: 'Title',
      accessorKey: 'title',
      cell: ({ row }) => <div className="truncate font-medium">{row.getValue('title')}</div>,
      size: 250,
    },
    {
      header: 'Customer',
      accessorKey: 'contact',
      cell: ({ row }) => {
        const contact = row.original.contact
        return <div>{getFullName(contact)}</div>
      },
      size: 150,
    },
    {
      header: 'Type',
      accessorKey: 'type',
      cell: ({ row }) => (
        <TicketTypeBadge type={row.getValue('type')} closed={row.original.status === 'CLOSED'} />
      ),
      size: 130,
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: ({ row }) => (
        <TicketStatusBadge
          status={row.getValue('status')}
          closed={row.original.status === 'CLOSED'}
        />
      ),
      size: 150,
    },
    {
      header: 'Priority',
      accessorKey: 'priority',
      cell: ({ row }) => (
        <TicketPriorityBadge
          priority={row.getValue('priority')}
          closed={row.original.status === 'CLOSED'}
        />
      ),
      size: 120,
    },
    {
      header: 'Assigned To',
      accessorKey: 'assignments',
      cell: ({ row }) => {
        const assignments = row.original.assignments
        return assignments.length > 0 ? (
          <>
            {assignments.map((assignment) => (
              <span key={assignment.id} className="block text-sm text-muted-foreground">
                {assignment.agent.name || assignment.agent.email}
              </span>
            ))}
          </>
        ) : (
          'Unassigned'
        )
      },
      size: 150,
    },
    {
      header: 'Updated',
      accessorKey: 'updatedAt',
      cell: ({ row }) => (
        <div className="text-muted-foreground">
          {format(new Date(row.getValue('updatedAt')), 'MMM d, yyyy')}
        </div>
      ),
      size: 120,
    },
  ]

  const table = useReactTable({
    data: tickets,
    columns,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onRowSelectionChange: (updater) => {
      const newSelection = typeof updater === 'function' ? updater(rowSelection) : updater
      setRowSelection(newSelection)
      // Extract the IDs of selected tickets
      const selectedIds = Object.keys(newSelection)
        .filter((key) => newSelection[key])
        .map((rowId) => {
          const rowIndex = parseInt(rowId, 10)
          return tickets[rowIndex]?.id
        })

      // console.log('Selected ticket IDs:', selectedIds)

      if (onRowSelectionChange) {
        onRowSelectionChange(selectedIds)
      }
    },
    state: { sorting, rowSelection },
    enableRowSelection: true,
    enableSortingRemoval: false,
  })

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        <div className="h-6 w-full animate-pulse rounded bg-muted"></div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-16 w-full animate-pulse rounded bg-muted"></div>
        ))}
      </div>
    )
  } else if (tickets.length === 0) {
    return (
      <div className="h-full flex">
        <EmptyState
          icon={Ticket}
          title="No tickets found"
          description={
            <div className="max-w-sm">
              Create or select tickets to manage your support requests.
            </div>
          }
          button={
            <Link href="/app/tickets/list?create=true">
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4" />
                Create Ticket
              </Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex-1 h-full">
      <table
        className="w-full caption-bottom text-sm"
        style={{ width: table.getCenterTotalSize() }}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="bg-muted/50">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="relative h-10 select-none [&>.cursor-col-resize]:last:opacity-0"
                  aria-sort={
                    header.column.getIsSorted() === 'asc'
                      ? 'ascending'
                      : header.column.getIsSorted() === 'desc'
                        ? 'descending'
                        : 'none'
                  }
                  {...{ colSpan: header.colSpan, style: { width: header.getSize() } }}>
                  {header.isPlaceholder ? null : (
                    <div
                      className={cn(
                        header.column.getCanSort() &&
                          'flex h-full cursor-pointer select-none items-center justify-between gap-2'
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                      onKeyDown={(e) => {
                        if (header.column.getCanSort() && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault()
                          header.column.getToggleSortingHandler()?.(e)
                        }
                      }}
                      tabIndex={header.column.getCanSort() ? 0 : undefined}>
                      <span className="truncate">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      {{
                        asc: (
                          <ChevronUpIcon
                            className="shrink-0 opacity-60"
                            size={16}
                            aria-hidden="true"
                          />
                        ),
                        desc: (
                          <ChevronDownIcon
                            className="shrink-0 opacity-60"
                            size={16}
                            aria-hidden="true"
                          />
                        ),
                      }[header.column.getIsSorted() as string] ?? null}
                    </div>
                  )}
                  {header.column.getCanResize() && (
                    <div
                      {...{
                        onDoubleClick: () => header.column.resetSize(),
                        onMouseDown: header.getResizeHandler(),
                        onTouchStart: header.getResizeHandler(),
                        className:
                          'absolute top-0 h-full w-4 cursor-col-resize user-select-none touch-none -right-2 z-10 flex justify-center before:absolute before:w-px before:inset-y-0 before:bg-border before:translate-x-px',
                      }}
                    />
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length
            ? table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className={cn('cursor-pointer hover:bg-muted/50', {
                    '[&>td]:text-muted-foreground/50': row.original.status === 'CLOSED',
                  })}
                  onClick={() => router.push(`/app/tickets/${row.original.id}`)}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="truncate">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : null}
          {isFetchingNextPage && (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-4 text-center">
                Loading more tickets...
              </TableCell>
            </TableRow>
          )}
          {loadMoreRef && (
            <TableRow ref={loadMoreRef}>
              <TableCell colSpan={columns.length} className="p-0"></TableCell>
            </TableRow>
          )}
        </TableBody>
      </table>
    </div>
  )
}
