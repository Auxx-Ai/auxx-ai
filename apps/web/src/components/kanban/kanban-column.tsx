// apps/web/src/components/kanban/kanban-column.tsx
'use client'

import { useState, useCallback } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@auxx/ui/lib/utils'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Button } from '@auxx/ui/components/button'
import { ChevronRight, EyeOff, GripVertical, Plus } from 'lucide-react'
import { getColorSwatch, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { KanbanColumnSettings, type ColumnOptionChanges } from './kanban-column-settings'
import { NO_STATUS_COLUMN_ID, type TargetTimeInStatus } from '../dynamic-table/types'
import { Badge } from '@auxx/ui/components/badge'

/** Props for KanbanColumn component */
interface KanbanColumnProps {
  id: string
  title: string
  color?: string
  count: number
  isCollapsed?: boolean
  isOver?: boolean
  /** True when this column is the source of the dragged card */
  isSourceColumn?: boolean
  /** True when a column (not a card) is being dragged */
  isDraggingColumn?: boolean
  entityLabel?: string
  onAddCard?: () => void
  onAddCalculation?: () => void
  isSortable?: boolean
  children: React.ReactNode

  /** Settings props */
  targetTimeInStatus?: TargetTimeInStatus
  celebration?: boolean
  isVisible?: boolean

  /** Unified settings callback */
  onChange?: (changes: ColumnOptionChanges) => void
  /** View-level visibility change */
  onVisibilityChange?: (visible: boolean) => void
  /** Delete callback */
  onDelete?: () => void
}

/**
 * Kanban column component.
 * Features: color dot, sortable, collapsible, footer, "New X" button, settings popover.
 */
export function KanbanColumn({
  id,
  title,
  color = 'gray',
  count,
  isCollapsed: initialCollapsed = false,
  isOver,
  isSourceColumn,
  isDraggingColumn,
  entityLabel = 'Record',
  onAddCard,
  onAddCalculation,
  isSortable = false,
  children,
  // Settings props
  targetTimeInStatus,
  celebration,
  isVisible,
  // Settings callbacks
  onChange,
  onVisibilityChange,
  onDelete,
}: KanbanColumnProps) {
  const isNoStatusColumn = id === NO_STATUS_COLUMN_ID
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed)

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

  // Droppable for card drops
  const { setNodeRef: setDroppableRef, isOver: isDndOver } = useDroppable({
    id,
    data: { type: 'column' },
  })

  // Combine refs onto same element for both sortable (column reorder) and droppable (card drops)
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setSortableRef(node)
      setDroppableRef(node)
    },
    [setSortableRef, setDroppableRef]
  )

  // Restrict column drag to horizontal only
  const style = isSortable
    ? {
        transform: transform
          ? CSS.Transform.toString({ ...transform, y: 0 })
          : undefined,
        transition,
      }
    : undefined

  // Use existing color utilities from @auxx/lib
  const colorDot = getColorSwatch(color as SelectOptionColor)
  // Only highlight when cards are dragged over, not when columns are being reordered
  const isActive = (isOver || isDndOver) && !isSourceColumn && !isDraggingColumn
  // Collapsed state - vertical label
  if (isCollapsed) {
    return (
      <div ref={setNodeRef} style={style} className="shrink-0 pr-3">
        <div
          className={cn(
            'w-10 h-full rounded-lg border bg-muted/30 cursor-pointer hover:bg-muted/50',
            isActive && 'border-info bg-info/10',
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
            <Badge variant="pill" size="xs" className="mt-2">
              {count}
            </Badge>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style} className="shrink-0 pr-3 max-h-full">
      <div
        className={cn(
          'group/kanban-col w-64 h-full rounded-2xl border border-transparent bg-muted/30 flex flex-col max-h-full',
          isActive && 'border-info bg-info/10',
          isDragging && 'border-primary-200 bg-primary-200 backdrop-blur-sm shadow-lg z-50'
        )}>
        {/* Column header */}
        {(() => {
          const headerContent = (
            <div
              className={cn(
                'flex items-center px-3 py-2.5 border-b',
                !isNoStatusColumn && 'group/header cursor-pointer hover:bg-muted/50 transition-colors'
              )}>
              <div className={cn('size-3.5 rounded-full shrink-0 me-2', colorDot)} />
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className="text-sm font-medium truncate">{title}</span>
                <Badge variant="pill" size="xs">
                  {count}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-5 opacity-0 group-hover/kanban-col:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsCollapsed(true)
                }}
                onPointerDown={(e) => e.stopPropagation()}>
                <EyeOff className="size-3" />
              </Button>
              {onAddCard && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-5 opacity-0 group-hover/kanban-col:opacity-100"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddCard()
                  }}>
                  <Plus className="size-3" />
                </Button>
              )}
              {isSortable && (
                <button
                  {...attributes}
                  {...listeners}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    listeners?.onPointerDown?.(e)
                  }}
                  className="p-0.5 -mr-1 opacity-0 group-hover/kanban-col:opacity-100 cursor-grab active:cursor-grabbing touch-none">
                  <GripVertical className="size-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          )

          if (isNoStatusColumn) {
            return headerContent
          }

          return (
            <KanbanColumnSettings
              columnId={id}
              label={title}
              color={color}
              targetTimeInStatus={targetTimeInStatus}
              celebration={celebration}
              isVisible={isVisible}
              mode="full"
              onChange={onChange}
              onVisibilityChange={onVisibilityChange}
              onDelete={onDelete}>
              {headerContent}
            </KanbanColumnSettings>
          )
        })()}

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
    </div>
  )
}
