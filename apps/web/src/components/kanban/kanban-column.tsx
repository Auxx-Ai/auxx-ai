// apps/web/src/components/kanban/kanban-column.tsx
'use client'

import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@auxx/ui/lib/utils'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Button } from '@auxx/ui/components/button'
import { ChevronRight, GripVertical, Plus } from 'lucide-react'
import { getColorSwatch, type SelectOptionColor } from '@auxx/lib/custom-fields/client'

/** Props for KanbanColumn component */
interface KanbanColumnProps {
  id: string
  title: string
  color?: string
  count: number
  isCollapsed?: boolean
  isOver?: boolean
  entityLabel?: string
  onAddCard?: () => void
  onAddCalculation?: () => void
  isSortable?: boolean
  children: React.ReactNode
}

/**
 * Kanban column component.
 * Features: color dot, sortable, collapsible, footer, "New X" button.
 */
export function KanbanColumn({
  id,
  title,
  color = 'gray',
  count,
  isCollapsed: initialCollapsed = false,
  isOver,
  entityLabel = 'Record',
  onAddCard,
  onAddCalculation,
  isSortable = false,
  children,
}: KanbanColumnProps) {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed)

  // Droppable for cards
  const { setNodeRef: setDroppableRef, isOver: isDndOver } = useDroppable({
    id,
    data: { type: 'column', columnId: id },
  })

  // Sortable for column reordering
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: { type: 'column' },
    disabled: !isSortable,
  })

  console.log('[KanbanColumn]', {
    id,
    isSortable,
    disabled: !isSortable,
    hasListeners: !!listeners,
    listenersKeys: listeners ? Object.keys(listeners) : [],
    isDragging,
  })

  const style = isSortable
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
      }
    : undefined

  // Use existing color utilities from @auxx/lib
  const colorDot = getColorSwatch(color as SelectOptionColor)
  const isActive = isOver || isDndOver

  // Collapsed state - vertical label
  if (isCollapsed) {
    return (
      <div
        ref={setSortableRef}
        style={style}
        className={cn(
          'w-10 shrink-0 rounded-lg border bg-muted/30 cursor-pointer transition-colors hover:bg-muted/50',
          isActive && 'border-primary bg-primary/5',
          isDragging && 'opacity-50'
        )}
        onClick={() => setIsCollapsed(false)}>
        <div className="flex flex-col items-center py-3 px-1 h-full">
          <ChevronRight className="size-4 mb-2 text-muted-foreground" />
          <div className={cn('size-2.5 rounded-full mb-2', colorDot)} />
          <div
            className="text-xs font-medium text-muted-foreground whitespace-nowrap"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
            {title}
          </div>
          <span className="text-xs text-muted-foreground mt-2">{count}</span>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={setSortableRef}
      style={style}
      className={cn(
        'w-64 shrink-0 rounded-lg border bg-muted/30 flex flex-col transition-colors max-h-full',
        isActive && 'border-primary-300 bg-primary/5',
        isDragging && 'opacity-50'
      )}>
      {/* Column header */}
      <div
        ref={setDroppableRef}
        className="flex items-center gap-2 px-3 py-2.5 border-b group/header">
        {/* Drag handle for sortable columns */}
        {isSortable && (
          <button
            {...attributes}
            {...listeners}
            className="p-0.5 -ml-1 opacity-0 group-hover/header:opacity-100 cursor-grab active:cursor-grabbing touch-none">
            <GripVertical className="size-3.5 text-muted-foreground" />
          </button>
        )}

        {/* Color dot */}
        <div className={cn('size-2.5 rounded-full shrink-0', colorDot)} />

        {/* Title */}
        <span
          className="text-sm font-medium truncate flex-1 cursor-pointer"
          onClick={() => setIsCollapsed(true)}>
          {title}
        </span>

        {/* Count badge */}
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>

        {/* Add button (on hover) */}
        {onAddCard && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5 opacity-0 group-hover/header:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onAddCard()
            }}>
            <Plus className="size-3" />
          </Button>
        )}
      </div>

      {/* Column content - scrollable */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-2">
          {children}

          {/* Empty state with prominent add button */}
          {count === 0 && onAddCard && (
            <button
              onClick={onAddCard}
              className="w-full h-8  items-center border border-dashed rounded-lg text-sm text-muted-foreground hover:border-primary-500 hover:text-primary-500 hover:bg-primary-400/10 transition-colors flex justify-center gap-2">
              <Plus className="size-4" />
              New {entityLabel}
            </button>
          )}
        </div>
      </ScrollArea>

      {/* Column footer - calculations */}
      {onAddCalculation && (
        <div className="border-t px-3 py-2">
          <button
            onClick={onAddCalculation}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            + Add calculation
          </button>
        </div>
      )}
    </div>
  )
}
