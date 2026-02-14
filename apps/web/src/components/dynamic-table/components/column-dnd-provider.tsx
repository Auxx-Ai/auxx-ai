// apps/web/src/components/dynamic-table/components/column-dnd-provider.tsx

'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import type { Column, Table } from '@tanstack/react-table'
import { useCallback, useMemo, useState } from 'react'
import { useFields } from '~/components/resources/hooks/use-field'
import { getIconForFieldType } from '../custom-field-column-factory'
import type { ExtendedColumnDef } from '../types'
import { decodeColumnId } from '../utils/column-id'

interface ColumnDndProviderProps<TData> {
  table: Table<TData>
  children: React.ReactNode
  /** Visible columns from table - passed from parent to ensure sync */
  visibleColumns: Column<TData, unknown>[]
}

/**
 * Drag overlay content for column reordering.
 * Handles both regular columns and path columns with proper labels/icons.
 */
function ColumnDragOverlay<TData>({
  columnId,
  columnDef,
}: {
  columnId: string
  columnDef: ExtendedColumnDef<TData>
}) {
  // Decode column ID to check if it's a path
  const decoded = useMemo(() => decodeColumnId(columnId), [columnId])
  const isPathColumn = decoded.type === 'path'

  // For path columns, fetch field definitions
  const pathFields = useFields(isPathColumn ? decoded.fieldPath : [])

  // Determine icon: prefer columnDef.icon, fallback to terminal field's type for paths
  const Icon = useMemo(() => {
    if (columnDef.icon) return columnDef.icon
    if (isPathColumn && pathFields.length > 0) {
      const terminalField = pathFields[pathFields.length - 1]
      if (terminalField?.fieldType) {
        return getIconForFieldType(terminalField.fieldType)
      }
    }
    return null
  }, [columnDef.icon, isPathColumn, pathFields])

  // Determine label: prefer columnDef.header string, fallback to path labels
  const label = useMemo(() => {
    if (typeof columnDef.header === 'string' && columnDef.header) return columnDef.header
    if (isPathColumn && pathFields.length > 0) {
      return pathFields
        .map((f) => f?.label ?? '')
        .filter(Boolean)
        .join(' → ')
    }
    return columnId
  }, [columnDef.header, isPathColumn, pathFields, columnId])

  return (
    <div className='bg-primary-200 border border-primary rounded-lg shadow-2xl px-2 py-2 cursor-grabbing'>
      <div className='font-medium text-xs text-zinc-700 flex items-center'>
        {Icon && <Icon className='mr-2 size-3 text-zinc-500' />}
        <span className='font-semibold'>{label}</span>
      </div>
    </div>
  )
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
        className='w-auto'>
        {activeColumnId && activeColumnDef ? (
          <ColumnDragOverlay columnId={activeColumnId} columnDef={activeColumnDef} />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
