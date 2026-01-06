'use client'

import { type ColumnDef } from '@tanstack/react-table'

import { Badge } from '@auxx/ui/components/badge'
import { Checkbox } from '@auxx/ui/components/checkbox'

import { getProductStatusBadge, labels } from '~/constants/products'
import { DataTableColumnHeader } from '~/components/data-table/data-table-column-header'
import { type Product } from './schema'
import { DataTableRowActions } from './products-data-table-row-actions'
import { titleize, pluralize } from '@auxx/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import React from 'react'

import { Button } from '@auxx/ui/components/button'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'

export const columns: ColumnDef<Product>[] = [
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
    minSize: 30,
    size: 30,
    maxSize: 30,
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
    id: 'image',
    minSize: 50,
    size: 50,
    maxSize: 50,
    // header: ({ table }) => (
    // ),
    cell: ({ row }) => {
      let img: string | undefined | null
      if (row.original.media.length) {
        img = row.original.media[0].previewUrl
      }

      return (
        <Avatar className="rounded-md">
          {img ? <AvatarImage src={img} alt={row.original.title} /> : null}
          <AvatarFallback className="rounded-md">{row.original.title[0]}</AvatarFallback>
        </Avatar>
      )
    },
    enableSorting: false,
    enableHiding: false,
  },

  // {
  //   accessorKey: 'id',
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title='Product' />
  //   ),
  //   cell: ({ row }) => <div className='w-[80px]'>{row.getValue('id')}</div>,
  //   enableSorting: false,
  //   enableHiding: false,
  // },

  {
    minSize: 200,
    accessorKey: 'title',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
    cell: ({ row }) => {
      const label = labels.find((label) => label.value === row.original.title)

      return (
        <div className="flex space-x-2">
          {label && <Badge variant="outline">{label.label}</Badge>}
          <span className="truncate text-sm">{row.getValue('title')}</span>
        </div>
      )
    },
  },
  {
    minSize: 100,
    maxSize: 100,
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => (
      <div className="truncate text-sm">{getProductStatusBadge(row.getValue('status'))}</div>
    ),
    // enableSorting: false,
    // enableHiding: false,
  },
  {
    id: 'inventory',
    minSize: 100,
    // maxSize: 100,
    // accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Inventory" />,
    cell: ({ row }) => {
      let text: string = ''
      let color: string = ''
      if (!row.original.tracksInventory) {
        text = 'Inventory not tracked'
      } else {
        text = `${row.original.totalInventory} in stock`
        text += row.original.variants.length
          ? `for ${row.original.variants.length} ${pluralize(row.original.variants.length, 'variant')}`
          : ''
        if (row.original.totalInventory <= 0) color = 'text-red-800'
      }

      return <div className={cn('truncate text-sm', color)}>{text}</div>
    },
    // enableSorting: false,
    // enableHiding: false,
  },
  {
    minSize: 100,
    accessorKey: 'vendor',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
    cell: ({ row }) => <div className="truncate text-sm">{row.getValue('vendor')}</div>,
    // enableSorting: false,
    // enableHiding: false,
  },
  {
    accessorKey: 'productType',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Product Type" />,
    cell: ({ row }) => <Badge variant="outline">{row.getValue('productType')}</Badge>,
    // enableSorting: false,
    // enableHiding: false,
  },
  {
    minSize: 100,
    accessorKey: 'tags',
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Tags" />,
    cell: ({ row }) => {
      return (
        <div className="w-full">
          <div className="space-x-2">
            {(() => {
              const tags = row.getValue<string[]>('tags') || []
              const maxTags = 2 // Show maximum of 2 tags
              const visibleTags = tags.slice(0, maxTags)
              const remaining = tags.length - maxTags

              return (
                <div className="flex items-center overflow-x-auto whitespace-nowrap">
                  {visibleTags.map((tag: string) => (
                    <Badge key={tag} variant="outline" className="mr-2 shrink-0">
                      {titleize(tag)}
                    </Badge>
                  ))}
                  {remaining > 0 && (
                    <Badge variant="secondary" className="shrink-0">
                      +{remaining} more
                    </Badge>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      )
    },
    // enableSorting: false,
    // enableHiding: false,
  },
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
  },*/
  /* {
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
