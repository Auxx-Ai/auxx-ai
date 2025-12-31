// apps/web/src/components/dynamic-table/components/table-toolbar/column-manager.tsx

'use client'

import { useState, useEffect } from 'react'
import { Columns, Eye, EyeOff, Check, SquareUser } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSortable,
  CommandSortableItem,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { useTableContext } from '../../context/table-context'
import { Tooltip } from '~/components/global/tooltip'

/**
 * Column manager component for managing column visibility and order
 */
export function ColumnManager<TData = any>() {
  const { table, columnLabels } = useTableContext<TData>()
  const [searchTerm, setSearchTerm] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  // Get current column order and visibility
  const columnOrder = table.getState().columnOrder
  const columnVisibility = table.getState().columnVisibility

  // Create ordered column list
  const [orderedColumns, setOrderedColumns] = useState(() => {
    const allColumns = table
      .getAllColumns()
      .filter((col) => col.getCanHide() && col.id !== '_checkbox')
      .map((col) => {
        const header = col.columnDef.header
        const originalName =
          typeof header === 'string' ? header : typeof header === 'function' ? col.id : col.id
        const name = columnLabels?.[col.id] ?? originalName
        const isCustomField = col.id.startsWith('customField_')
        return { id: col.id, name, isVisible: col.getIsVisible(), isCustomField }
      })

    // Sort by column order if exists
    if (columnOrder.length > 0) {
      const orderedCols = columnOrder
        .map((id) => allColumns.find((col) => col.id === id))
        .filter((col): col is NonNullable<typeof col> => col !== undefined)
      const unorderedCols = allColumns.filter((col) => !columnOrder.includes(col.id))
      return [...orderedCols, ...unorderedCols]
    }

    return allColumns
  })

  // Update when table state changes
  useEffect(() => {
    const allColumns = table
      .getAllColumns()
      .filter((col) => col.getCanHide() && col.id !== '_checkbox')
      .map((col) => {
        const header = col.columnDef.header
        const originalName =
          typeof header === 'string' ? header : typeof header === 'function' ? col.id : col.id
        const name = columnLabels?.[col.id] ?? originalName
        const isCustomField = col.id.startsWith('customField_')
        return { id: col.id, name, isVisible: col.getIsVisible(), isCustomField }
      })

    if (columnOrder.length > 0) {
      const orderedCols = columnOrder
        .map((id) => allColumns.find((col) => col.id === id))
        .filter((col): col is NonNullable<typeof col> => col !== undefined)
      const unorderedCols = allColumns.filter((col) => !columnOrder.includes(col.id))
      setOrderedColumns([...orderedCols, ...unorderedCols])
    } else {
      setOrderedColumns(allColumns)
    }
  }, [table, columnOrder, columnVisibility, columnLabels])

  // Handle reorder from CommandSortable
  const handleReorder = (newOrder: string[]) => {
    const newColumns = newOrder
      .map((id) => orderedColumns.find((col) => col.id === id))
      .filter((col): col is NonNullable<typeof col> => col !== undefined)
    setOrderedColumns(newColumns)
    table.setColumnOrder(newOrder)
  }

  // Handle visibility toggle
  const handleVisibilityToggle = (columnId: string) => {
    const column = orderedColumns.find((col) => col.id === columnId)
    if (column) {
      table.getColumn(columnId)?.toggleVisibility(!column.isVisible)
    }
  }

  // Filter columns based on search
  const filteredColumns = orderedColumns.filter((col) =>
    col.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Toggle all columns
  const toggleAll = (checked: boolean) => {
    table.getAllColumns().forEach((column) => {
      if (column.getCanHide() && column.id !== '_checkbox') {
        column.toggleVisibility(checked)
      }
    })
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div>
          <Tooltip content="Edit columns">
            <Button variant="ghost" size="sm">
              <Columns className="size-3" />
              <span className="hidden @lg/controls:block">Columns</span>
            </Button>
          </Tooltip>
        </div>
      </PopoverTrigger>

      <PopoverContent className="w-[250px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search columns..."
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
          <CommandList className="max-h-auto">
            <CommandEmpty>No columns found.</CommandEmpty>
            <CommandGroup>
              <CommandSortable
                items={filteredColumns.map((col) => col.id)}
                onReorder={handleReorder}>
                {filteredColumns.map((column) => (
                  <CommandSortableItem
                    key={column.id}
                    id={column.id}
                    onSelect={() => handleVisibilityToggle(column.id)}>
                    <div className="flex items-center gap-2">
                      <Check
                        className={cn(
                          'size-3 text-zinc-700',
                          column.isVisible ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="truncate text-sm">
                        {column.name || <i className="px-0.5">No name</i>}
                      </span>
                      {column.isCustomField && (
                        <Tooltip content="Custom field">
                          <SquareUser className="size-3 text-muted-foreground" />
                        </Tooltip>
                      )}
                    </div>
                  </CommandSortableItem>
                ))}
              </CommandSortable>
            </CommandGroup>
          </CommandList>
          <CommandGroup className="border-t">
            <CommandItem onSelect={() => toggleAll(true)} className="gap-2">
              <Eye className="size-3" />
              Show all columns
            </CommandItem>
            <CommandItem onSelect={() => toggleAll(false)} className="gap-2">
              <EyeOff className="size-3" />
              Hide all columns
            </CommandItem>
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
