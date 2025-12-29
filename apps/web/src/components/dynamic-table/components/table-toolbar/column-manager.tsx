// apps/web/src/components/dynamic-table/components/table-toolbar/column-manager.tsx

'use client'

import { useState, useEffect } from 'react'
import { Columns, GripVertical, Eye, EyeOff, Check, SquareUser } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@auxx/ui/lib/utils'
import { useTableContext } from '../../context/table-context'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { Tooltip } from '~/components/global/tooltip'

interface SortableColumnItemProps {
  column: { id: string; name: string; isVisible: boolean; isCustomField?: boolean }
  onToggle: (checked: boolean) => void
}

/**
 * Sortable column item component
 */
function SortableColumnItem({ column, onToggle }: SortableColumnItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
  })

  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <CommandItem
      ref={setNodeRef}
      style={style}
      className={cn(
        'px-1',
        // 'flex items-center justify-between px-2 py-1.5 w-full cursor-pointer hover:bg-accent rounded-sm',
        isDragging && 'opacity-50'
      )}
      onSelect={() => {
        onToggle(!column.isVisible)
      }}>
      <div className="flex items-center gap-2 flex-1">
        <Check
          className={cn('size-3 text-zinc-700', column.isVisible ? 'opacity-100' : 'opacity-0')}
        />
        <span className="text-sm truncate">{column.name || <i className="px-0.5">No name</i>}</span>
        {column.isCustomField && (
          <Tooltip content="Custom field">
            <SquareUser className="size-3 text-muted-foreground" />
          </Tooltip>
        )}
      </div>

      <span
        className="size-5 cursor-move shrink-0 flex items-center justify-center"
        aria-label={`Reorder ${column.name} column`}
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}>
        <GripVertical className="size-3" />
      </span>
    </CommandItem>
  )
}

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

  // Sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = orderedColumns.findIndex((col) => col.id === active.id)
      const newIndex = orderedColumns.findIndex((col) => col.id === over.id)

      const newOrder = arrayMove(orderedColumns, oldIndex, newIndex)
      setOrderedColumns(newOrder)

      // Update table column order
      table.setColumnOrder(newOrder.map((col) => col.id))
    }
  }

  // Handle visibility toggle
  const handleVisibilityToggle = (columnId: string, checked: boolean) => {
    table.getColumn(columnId)?.toggleVisibility(checked)
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

      <PopoverContent className="w-[250px] p-0 " align="start">
        <Command>
          <CommandInput
            placeholder="Search columns..."
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
          <CommandList className="max-h-auto">
            <CommandEmpty>No columns found.</CommandEmpty>
            <CommandGroup>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis]}
                onDragEnd={handleDragEnd}>
                <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden p-1">
                  <SortableContext
                    items={filteredColumns.map((col) => col.id)}
                    strategy={verticalListSortingStrategy}>
                    {filteredColumns.map((column) => (
                      <SortableColumnItem
                        column={column}
                        key={column.id}
                        onToggle={(checked) => handleVisibilityToggle(column.id, checked)}
                      />
                    ))}
                  </SortableContext>
                </div>
              </DndContext>
            </CommandGroup>
          </CommandList>
          <CommandGroup className="border-t">
            <CommandItem onSelect={() => toggleAll(true)} className=" gap-2">
              <Eye className="size-3" />
              Show all columns
            </CommandItem>
            <CommandItem onSelect={() => toggleAll(false)} className=" gap-2">
              <EyeOff className="size-3" />
              Hide all columns
            </CommandItem>
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
