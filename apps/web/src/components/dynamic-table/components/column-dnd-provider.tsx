// apps/web/src/components/dynamic-table/components/column-dnd-provider.tsx

'use client'

import { useState, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { Table, Column } from '@tanstack/react-table'
import type { ExtendedColumnDef } from '../types'

interface ColumnDndProviderProps<TData> {
  table: Table<TData>
  children: React.ReactNode
  /** Visible columns from table - passed from parent to ensure sync */
  visibleColumns: Column<TData, unknown>[]
}

/**
 * DndContext specifically for column reordering functionality
 * Handles only header column drag-and-drop operations
 */
export function ColumnDndProvider<TData>({
  table,
  children,
  visibleColumns,
}: ColumnDndProviderProps<TData>) {
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null)

  // Column-specific sensors with smaller activation distance for headers
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Get column IDs from visible columns - always in sync
  const orderedColumnIds = visibleColumns.map((col) => col.id)

  // Handle column drag start
  const handleColumnDragStart = useCallback((event: DragStartEvent) => {
    setActiveColumnId(event.active.id as string)
  }, [])

  // Handle column drag end
  const handleColumnDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) {
        setActiveColumnId(null)
        return
      }

      // Handle column reordering
      const oldIndex = orderedColumnIds.indexOf(active.id as string)
      const newIndex = orderedColumnIds.indexOf(over.id as string)

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(orderedColumnIds, oldIndex, newIndex)
        table.setColumnOrder(newOrder)
      }

      setActiveColumnId(null)
    },
    [orderedColumnIds, table]
  )
  // Get active column for drag overlay
  const activeColumn = activeColumnId ? table.getColumn(activeColumnId) : null
  const activeColumnDef = activeColumn?.columnDef as ExtendedColumnDef | undefined
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleColumnDragStart}
      onDragEnd={handleColumnDragEnd}>
      <SortableContext items={orderedColumnIds} strategy={horizontalListSortingStrategy}>
        {children}
      </SortableContext>

      {/* Column drag overlay */}
      <DragOverlay
        dropAnimation={null}
        adjustScale={false}
        style={{ width: 'auto' }}
        className="w-auto">
        {activeColumnId && activeColumnDef ? (
          <div className="bg-primary-200 border border-primary rounded-lg shadow-2xl px-2 py-2 cursor-grabbing">
            <div className="font-medium text-xs text-zinc-700 flex items-center">
              {activeColumnDef.icon && (
                <activeColumnDef.icon className="mr-2 size-3 text-zinc-500" />
              )}
              <span className="font-semibold">
                {typeof activeColumnDef.header === 'string'
                  ? activeColumnDef.header
                  : activeColumnId}
              </span>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
