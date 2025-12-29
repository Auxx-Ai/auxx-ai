'use client'
import { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@auxx/ui/components/badge'
import { Checkbox } from '@auxx/ui/components/checkbox'
// import { DataTableRowActions } from './data-table-row-actions'
import { labels, priorities, statuses } from '~/constants/products'
import { DataTableColumnHeader } from '~/components/data-table/data-table-column-header'
// import { Order } from './schema'
// import { DataTableRowActions } from './data-table-row-actions'
// import { Order } from './schema'
import { DataTableRowActions } from './orders-data-table-row-actions'
import { formatRelativeDate } from '~/utils/date'
import { formatMoney } from '~/utils/strings'
import { Button } from '@auxx/ui/components/button'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import Link from 'next/link'
import { ContactHoverCard } from '~/components/contacts/contact-hover-card'
import { ORDER_FULFILLMENT_STATUS } from '@auxx/database/enums'
import type { Order } from '@auxx/database/types'
function renderName(row: any) {
  if (!row.firstName && !row.lastName) {
    if (row.email) {
      return row.email
    }
    return 'No Name'
  }
  return `${row.firstName} ${row.lastName}`.trim()
}
const orderFulfillmentStatuses = {
  [ORDER_FULFILLMENT_STATUS.UNFULFILLED]: 'Unfulfilled',
  [ORDER_FULFILLMENT_STATUS.PARTIALLY_FULFILLED]: 'Partially Fulfilled',
  [ORDER_FULFILLMENT_STATUS.FULFILLED]: 'Fulfilled',
  [ORDER_FULFILLMENT_STATUS.RESTOCKED]: 'Restocked',
  [ORDER_FULFILLMENT_STATUS.PENDING_FULFILLMENT]: 'Pending Fulfillment',
  [ORDER_FULFILLMENT_STATUS.OPEN]: 'Open',
  [ORDER_FULFILLMENT_STATUS.IN_PROGRESS]: 'In Progress',
  [ORDER_FULFILLMENT_STATUS.ON_HOLD]: 'On Hold',
  [ORDER_FULFILLMENT_STATUS.SCHEDULED]: 'Scheduled',
  [ORDER_FULFILLMENT_STATUS.REQUEST_DECLINED]: 'Request Declined',
}
// const orderFulfillmentStatusColor = {
//   [ORDER_FULFILLMENT_STATUS.UNFULFILLED]: 'rgba(255, 235, 120, 1)',
//   [ORDER_FULFILLMENT_STATUS.PARTIALLY_FULFILLED]: 'rgba(255, 184, 0, 1)',
//   [ORDER_FULFILLMENT_STATUS.FULFILLED]: 'rgba(0, 0, 0, .06)',
//   [ORDER_FULFILLMENT_STATUS.RESTOCKED]: 'rgba(0, 0, 0, .06)',
//   [ORDER_FULFILLMENT_STATUS.PENDING_FULFILLMENT]: 'rgba(255, 235, 120, 1)',
//   [ORDER_FULFILLMENT_STATUS.OPEN]: 'rgba(0, 0, 0, .06)',
//   [ORDER_FULFILLMENT_STATUS.IN_PROGRESS]: 'rgba(0, 0, 0, .06)',
//   [ORDER_FULFILLMENT_STATUS.ON_HOLD]: 'rgba(0, 0, 0, .06)',
//   [ORDER_FULFILLMENT_STATUS.SCHEDULED]: 'rgba(0, 0, 0, .06)',
//   [ORDER_FULFILLMENT_STATUS.REQUEST_DECLINED]: 'rgba(0, 0, 0, .06)',
// }
export const columns: ColumnDef<Order>[] = [
  {
    minSize: 30,
    maxSize: 30,
    id: 'expander',
    header: () => null,
    cell: ({ row }) => {
      return row.getCanExpand() ? (
        <Button
          {...{
            className: 'size-7 shadow-none text-muted-foreground',
            onClick: row.getToggleExpandedHandler(),
            'aria-expanded': row.getIsExpanded(),
            'aria-label': row.getIsExpanded()
              ? `Collapse details for ${row.original.name}`
              : `Expand details for ${row.original.name}`,
            size: 'icon',
            variant: 'ghost',
          }}>
          {row.getIsExpanded() ? (
            <ChevronUpIcon className="opacity-60" size={16} aria-hidden="true" />
          ) : (
            <ChevronDownIcon className="opacity-60" size={16} aria-hidden="true" />
          )}
        </Button>
      ) : undefined
    },
  },
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
        aria-label="Select all"
        className="translate-y-[2px]"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
        className="translate-y-[2px]"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'title',
    minSize: 70,
    size: 75,
    maxSize: 85,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Order" />,
    cell: ({ row }) => (
      <Link className="text-sm font-bold" href={`/app/shopify/orders/${row.original.id}`}>
        {row.original?.name || '--'}
      </Link>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: 'Date',
    accessorKey: 'createdAt',
    minSize: 130,
    size: 155,
    maxSize: 200,
    // size: 100,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => {
      // const label = labels.find((label) => label.value === row.original.label)
      const date = formatRelativeDate(row.original?.createdAt)
      return (
        <div className="flex space-x-2">
          {/* {label && <Badge variant='outline'>{label.label}</Badge>} */}
          <span className="truncate text-sm">{date}</span>
        </div>
      )
    },
  },
  {
    accessorKey: 'customer',
    minSize: 150,
    maxSize: Number.MAX_SAFE_INTEGER,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
    cell: ({ row }) => {
      // const label = labels.find((label) => label.value === row.original.label)
      const name = renderName(row.original?.customer)
      return (
        <div className="flex space-x-2">
          {/* {label && <Badge variant='outline'>{label.label}</Badge>} */}
          <ContactHoverCard contact={row.original.customer.contact}>
            <span className="truncate text-sm">{name}</span>
          </ContactHoverCard>
        </div>
      )
    },
  },
  {
    accessorKey: 'total',
    minSize: 60,
    maxSize: 70,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
    cell: ({ row }) => {
      // const label = labels.find((label) => label.value === row.original.label)
      return (
        <div className="flex space-x-2 text-sm">
          {formatMoney(row.original.totalPrice || 0, '${{amount_no_decimals}}')}
        </div>
      )
    },
  },
  {
    id: 'Fulfillment Status',
    accessorKey: 'fulfillmentStatus',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Fulfillment Status" />,
    cell: ({ row }) => {
      // const label = labels.find((label) => label.value === row.original.label)
      return (
        <div className="flex space-x-2 text-xs">
          <Badge variant="outline" className="font-normal">
            {orderFulfillmentStatuses[row.original.fulfillmentStatus]}
          </Badge>
        </div>
      )
    },
  },
  {
    id: 'Delivery Status',
    minSize: 90,
    maxSize: 120,
    accessorKey: 'trackings',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Delivery Status" />,
    cell: ({ row }) => {
      // const label = labels.find((label) => label.value === row.original.label)
      return (
        <div className="flex space-x-2 text-xs">
          <Badge variant="outline" className="font-normal">
            In transit
          </Badge>
        </div>
      )
    },
  },
  // {
  //   accessorKey: 'status',
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title='Status' />
  //   ),
  //   cell: ({ row }) => {
  //     const status = statuses.find(
  //       (status) => status.value === row.getValue('status')
  //     )
  //     if (!status) {
  //       return null
  //     }
  //     return (
  //       <div className='flex w-[100px] items-center'>
  //         {status.icon && (
  //           <status.icon className='mr-2 h-4 w-4 text-muted-foreground' />
  //         )}
  //         <span>{status.label}</span>
  //       </div>
  //     )
  //   },
  //   filterFn: (row, id, value) => {
  //     return value.includes(row.getValue(id))
  //   },
  // },
  // {
  //   accessorKey: 'priority',
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title='Priority' />
  //   ),
  //   cell: ({ row }) => {
  //     const priority = priorities.find(
  //       (priority) => priority.value === row.getValue('priority')
  //     )
  //     if (!priority) {
  //       return null
  //     }
  //     return (
  //       <div className='flex items-center'>
  //         {priority.icon && (
  //           <priority.icon className='mr-2 h-4 w-4 text-muted-foreground' />
  //         )}
  //         <span>{priority.label}</span>
  //       </div>
  //     )
  //   },
  //   filterFn: (row, id, value) => {
  //     return value.includes(row.getValue(id))
  //   },
  // },
  {
    id: 'actions',
    minSize: 40,
    maxSize: 40,
    size: 40,
    cell: ({ row }) => <DataTableRowActions row={row} />,
  },
]
