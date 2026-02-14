// apps/web/src/components/manufacturing/parts/parts-columns.tsx

'use client'

import type { InventoryEntity as Inventory } from '@auxx/database/models'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import {
  Boxes,
  Calculator,
  DollarSign,
  Hash,
  Package,
  PanelRight,
  SquarePen,
  Tag,
  Trash2,
} from 'lucide-react'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { FormattedCell, PrimaryCell } from '~/components/dynamic-table'

/**
 * Part row type for the table
 */
export type PartRow = {
  id: string
  title: string
  sku: string
  description: string | null
  category: string | null
  hsCode: string | null
  shopifyProductLinkId: string | null
  cost: number | null
  inventory: Inventory | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Interface for actions that can be performed on parts
 */
export interface PartColumnActions {
  onViewDetails: (row: PartRow) => void
  onEdit: (row: PartRow) => void
  onDelete: (id: string) => void
  onRecalculateCost: (id: string) => void
}

/**
 * Create table columns for the parts list
 * Uses FormattedCell for consistent cell rendering
 */
export function createPartColumns(actions: PartColumnActions): ExtendedColumnDef<PartRow>[] {
  return [
    {
      accessorKey: 'title',
      id: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <PrimaryCell
          value={row.original.title}
          onTitleClick={() => actions.onViewDetails(row.original)}>
          <DropdownMenuItem onClick={() => actions.onViewDetails(row.original)}>
            <PanelRight />
            View Details
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.onEdit(row.original)}>
            <SquarePen />
            Edit Part
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.onRecalculateCost(row.original.id)}>
            <Calculator />
            Recalculate Cost
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onClick={() => actions.onDelete(row.original.id)}>
            <Trash2 />
            Delete Part
          </DropdownMenuItem>
        </PrimaryCell>
      ),
      enableSorting: true,
      primaryCell: true,
      enableResizing: true,
      enableHiding: false,
      minSize: 200,
      maxSize: 400,
      size: 300,
      columnType: 'text',
      icon: Package,
    },
    {
      accessorKey: 'sku',
      id: 'sku',
      header: 'SKU',
      cell: ({ getValue }) => <FormattedCell value={getValue()} fieldType='TEXT' columnId='sku' />,
      enableSorting: true,
      enableResizing: true,
      size: 120,
      columnType: 'text',
      fieldType: 'TEXT',
      icon: Hash,
    },
    {
      accessorKey: 'category',
      id: 'category',
      header: 'Category',
      cell: ({ row }) => {
        const category = row.original.category
        if (!category) {
          return <FormattedCell value={null} fieldType='TEXT' columnId='category' />
        }
        return (
          <FormattedCell
            value={null}
            fieldType='ITEMS'
            columnId='category'
            items={[{ id: category, name: category }]}
            renderItem={(item: { id: string; name: string }) => (
              <Badge variant='pill' shape='tag'>
                {item.name}
              </Badge>
            )}
          />
        )
      },
      enableSorting: true,
      enableResizing: true,
      size: 150,
      columnType: 'text',
      icon: Tag,
    },
    {
      accessorKey: 'cost',
      id: 'cost',
      header: 'Cost',
      cell: ({ getValue }) => (
        <FormattedCell value={getValue()} fieldType='CURRENCY' columnId='cost' />
      ),
      enableSorting: true,
      enableResizing: true,
      size: 100,
      columnType: 'currency',
      fieldType: 'CURRENCY',
      icon: DollarSign,
    },
    {
      accessorFn: (row) => row.inventory?.quantity ?? null,
      id: 'quantity',
      header: 'Qty',
      cell: ({ row }) => {
        const inventory = row.original.inventory
        if (!inventory) {
          return <FormattedCell value={null} fieldType='NUMBER' columnId='quantity' />
        }
        const isLow =
          inventory.reorderPoint !== null && inventory.quantity <= inventory.reorderPoint
        return (
          <FormattedCell
            value={null}
            fieldType='ITEMS'
            columnId='quantity'
            items={[{ id: String(inventory.quantity), isLow }]}
            renderItem={(item: { id: string; isLow: boolean }) => (
              <span className={item.isLow ? 'text-red-500 font-medium' : ''}>{item.id}</span>
            )}
          />
        )
      },
      enableSorting: true,
      enableResizing: true,
      size: 80,
      columnType: 'number',
      fieldType: 'NUMBER',
      icon: Boxes,
    },
  ]
}
