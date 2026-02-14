'use client'
import type { Customer } from '@auxx/database/types'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { pluralize } from '@auxx/utils'
import type { ColumnDef } from '@tanstack/react-table'
import Link from 'next/link'
// import { DataTableRowActions } from './data-table-row-actions'
import { DataTableColumnHeader } from '~/components/data-table/data-table-column-header'
import { formatMoney } from '~/utils/strings'
// import { Customer } from './schema'
import { DataTableRowActions } from './customers-data-table-row-actions'

function renderName(row: Customer) {
  if (!row.firstName && !row.lastName) {
    if (row.email) {
      return row.email
    }
    return 'No Name'
  }
  return `${row.firstName} ${row.lastName}`.trim()
}
export const columns: ColumnDef<Customer>[] = [
  {
    id: 'select',
    minSize: 40,
    maxSize: 40,
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label='Select all'
        className='translate-y-[2px]'
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label='Select row'
        className='translate-y-[2px]'
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  // {
  //   accessorKey: 'id',
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title='Customer' />
  //   ),
  //   cell: ({ row }) => <div className='w-[80px]'>{row.getValue('id')}</div>,
  //   enableSorting: false,
  //   enableHiding: false,
  // },
  {
    id: 'title',
    minSize: 150,
    maxSize: Number.MAX_SAFE_INTEGER,
    header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
    accessorFn: (row) => `${row.firstName} ${row.lastName}`.trim(),
    cell: ({ row }) => {
      return (
        <div className='flex space-x-2'>
          <Link
            href={`/app/contacts/${row.original.contact.id}`}
            className='w-full max-w-[1000px] truncate font-medium hover:underline'>
            {renderName(row.original)}
          </Link>
        </div>
      )
    },
  },
  // {
  //   accessorKey: 'firstName',
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title='First Name' />
  //   ),
  //   cell: ({ row }) => {
  //     const label = labels.find(
  //       (label) => label.value === row.original.firstName
  //     )
  //     return (
  //       <div className='flex space-x-2'>
  //         {label && <Badge variant='outline'>{label.label}</Badge>}
  //         <span className='max-w-[500px] truncate font-medium'>
  //           {row.getValue('firstName')}
  //         </span>
  //       </div>
  //     )
  //   },
  // },
  // {
  //   id: 'title',
  //   accessorFn: (row) => `${row.firstName} ${row.lastName}`,
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title='First Name' />
  //   ),
  //   cell: ({ row }) => {
  //     const label = labels.find(
  //       (label) => label.value === row.original.firstName
  //     )
  //     return (
  //       <div className='flex space-x-2'>
  //         {label && <Badge variant='outline'>{label.label}</Badge>}
  //         <span className='max-w-[500px] truncate font-medium'>
  //           {row.getValue('firstName')}
  //         </span>
  //       </div>
  //     )
  //   },
  // },
  // {
  //   id: 'status',
  //   accessorFn: (row) => `pending`,
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title='Status' />
  //   ),
  //   cell: ({ row }) => {
  //     const label = labels.find(
  //       (label) => label.value === row.original.firstName
  //     )
  //     return <div className='flex space-x-2'>Status</div>
  //   },
  // },
  {
    id: 'Orders',
    minSize: 100,
    maxSize: 400,
    accessorKey: 'numberOfOrders',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Orders' />,
    cell: ({ row }) => {
      // row.original.numberOfOrders
      const count = row.original.numberOfOrders || 0
      return (
        <div className='flex space-x-2'>
          {count} {pluralize(count, 'order')}
        </div>
      )
    },
  },
  {
    id: 'Amount Spent',
    minSize: 100,
    maxSize: 400,
    accessorKey: 'amountSpent',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Amount spent' />,
    cell: ({ row }) => {
      // row.original.numberOfOrders
      return (
        <div className='flex space-x-2'>
          {formatMoney(row.original.amountSpent || 0, '${{amount_no_decimals}}')}
        </div>
      )
    },
  },
  // { id: 'priority', cell: ({ row }) => <DataTableRowActions row={row} /> },
  /*
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Status' />
      ),
      cell: ({ row }) => {
        const status = statuses.find(
          (status) => status.value === row.getValue('status')
        )
  
        if (!status) {
          return null
        }
  
        return (
          <div className='flex w-[100px] items-center'>
            {status.icon && (
              <status.icon className='mr-2 h-4 w-4 text-muted-foreground' />
            )}
            <span>{status.label}</span>
          </div>
        )
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },
    {
      accessorKey: 'priority',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Priority' />
      ),
      cell: ({ row }) => {
        const priority = priorities.find(
          (priority) => priority.value === row.getValue('priority')
        )
  
        if (!priority) {
          return null
        }
  
        return (
          <div className='flex items-center'>
            {priority.icon && (
              <priority.icon className='mr-2 h-4 w-4 text-muted-foreground' />
            )}
            <span>{priority.label}</span>
          </div>
        )
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },*/
  { id: 'actions', minSize: 40, maxSize: 40, cell: ({ row }) => <DataTableRowActions row={row} /> },
]
