// apps/web/src/components/manufacturing/parts/parts-columns.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Package,
  Tag,
  Hash,
  DollarSign,
  Boxes,
  MoreVertical,
  PanelRight,
  SquarePen,
  Trash2,
  Calculator,
} from 'lucide-react'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { FormattedCell } from '~/components/dynamic-table'
import type { InventoryEntity as Inventory } from '@auxx/database/models'

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
 * Props for PartTitleCell component
 */
interface PartTitleCellProps {
  part: PartRow
  onViewDetails: (row: PartRow) => void
  onEdit: (row: PartRow) => void
  onDelete: (id: string) => void
  onRecalculateCost: (id: string) => void
}

/**
 * Part title cell component with integrated actions
 * Shows the part title as clickable link and actions dropdown on hover
 */
function PartTitleCell({
  part,
  onViewDetails,
  onEdit,
  onDelete,
  onRecalculateCost,
}: PartTitleCellProps) {
  return (
    <div className="flex items-center justify-between w-full pl-3 pr-2 text-sm group/title">
      <button
        className="text-left underline decoration-muted-foreground/50 hover:decoration-primary truncate max-w-[calc(100%-40px)] font-medium"
        onClick={(e) => {
          e.stopPropagation()
          onViewDetails(part)
        }}>
        {part.title || 'Untitled'}
      </button>

      <div onClick={(e) => e.stopPropagation()} className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-6 p-0 opacity-0 group-hover/title:opacity-100 transition-opacity data-[state=open]:opacity-100!">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onViewDetails(part)}>
              <PanelRight />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(part)}>
              <SquarePen />
              Edit Part
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRecalculateCost(part.id)}>
              <Calculator />
              Recalculate Cost
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(part.id)}>
              <Trash2 />
              Delete Part
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
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
        <PartTitleCell
          part={row.original}
          onViewDetails={actions.onViewDetails}
          onEdit={actions.onEdit}
          onDelete={actions.onDelete}
          onRecalculateCost={actions.onRecalculateCost}
        />
      ),
      enableSorting: true,
      defaultPinned: true,
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
      cell: ({ getValue }) => <FormattedCell value={getValue()} fieldType="TEXT" columnId="sku" />,
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
          return <FormattedCell value={null} fieldType="TEXT" columnId="category" />
        }
        return (
          <FormattedCell
            value={null}
            fieldType="ITEMS"
            columnId="category"
            items={[{ id: category, name: category }]}
            renderItem={(item: { id: string; name: string }) => (
              <Badge variant="pill" shape="tag">
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
        <FormattedCell value={getValue()} fieldType="CURRENCY" columnId="cost" />
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
          return <FormattedCell value={null} fieldType="NUMBER" columnId="quantity" />
        }
        const isLow =
          inventory.reorderPoint !== null && inventory.quantity <= inventory.reorderPoint
        return (
          <FormattedCell
            value={null}
            fieldType="ITEMS"
            columnId="quantity"
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
