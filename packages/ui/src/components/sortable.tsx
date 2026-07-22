// packages/ui/src/components/sortable.tsx
'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import * as React from 'react'

export interface SortableListProps {
  /** Item IDs in current order. */
  items: string[]
  /** Called with the full new ID order after a drop. */
  onReorder: (newItems: string[]) => void
  /** Disable sorting interactions (renders a plain container). */
  disabled?: boolean
  /** Rows — each must register itself via `useSortable` with an id from `items`. */
  children: React.ReactNode
  /** Additional class name for the container. */
  className?: string
}

/**
 * Shared vertical drag-sort container: `DndContext` + `SortableContext` with
 * pointer/keyboard sensors, vertical-axis restriction, and `arrayMove` →
 * `onReorder`. Rows own their `useSortable` registration — see
 * `CommandSortableItem` (command.tsx) and `SortableTreeRow` (tree-row.tsx).
 * Flat sibling reordering only — no cross-parent drops.
 */
export function SortableList({
  items,
  onReorder,
  disabled = false,
  children,
  className,
}: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (over && active.id !== over.id) {
        const oldIndex = items.indexOf(String(active.id))
        const newIndex = items.indexOf(String(over.id))
        if (oldIndex !== -1 && newIndex !== -1) {
          onReorder(arrayMove(items, oldIndex, newIndex))
        }
      }
    },
    [items, onReorder]
  )

  if (disabled) {
    return <div className={className}>{children}</div>
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  )
}
