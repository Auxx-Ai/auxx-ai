// apps/web/src/components/kanban/kanban-column.tsx
'use client'

import { getColorSwatch, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, EyeOff, GripVertical, Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  type SelectOptionChanges,
  useFieldSelectOptionMutations,
} from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { useFieldSelectOption, useResourceProperty } from '~/components/resources/hooks'
import { useUpdateKanbanConfig } from '../dynamic-table/stores/store-actions'
import { useKanbanConfig } from '../dynamic-table/stores/store-selectors'
import { NO_STATUS_COLUMN_ID } from '../dynamic-table/types'
import { KanbanColumnSettings } from './kanban-column-settings'

/** Props for KanbanColumn component */
interface KanbanColumnProps {
  /** Column ID (option value) */
  columnId: string
  /** ResourceFieldId of the groupBy field */
  resourceFieldId: ResourceFieldId | undefined
  /** Table ID for view config access */
  tableId: string
  /** Number of cards in column */
  count: number
  /** Callback when "New X" is clicked */
  onAddCard?: () => void
  /** Callback when "Add calculation" is clicked */
  onAddCalculation?: () => void
  /** Whether column can be reordered */
  isSortable?: boolean
  /** Column content (cards) */
  children: React.ReactNode
  /** True when cards are being dragged over this column */
  isOver?: boolean
  /** True when this column is the source of the dragged card */
  isSourceColumn?: boolean
  /** True when a column (not a card) is being dragged */
  isDraggingColumn?: boolean
}

/**
 * Kanban column component.
 * Subscribes directly to field options via useFieldSelectOption for reactive updates.
 * Features: color dot, sortable, collapsible, footer, "New X" button, settings popover.
 */
export function KanbanColumn({
  columnId,
  resourceFieldId,
  tableId,
  count,
  onAddCard,
  onAddCalculation,
  isSortable = false,
  children,
  isOver,
  isSourceColumn,
  isDraggingColumn,
}: KanbanColumnProps) {
  const isNoStatusColumn = columnId === NO_STATUS_COLUMN_ID

  // Derive entityDefinitionId from resourceFieldId
  const entityDefinitionId = resourceFieldId
    ? parseResourceFieldId(resourceFieldId).entityDefinitionId
    : undefined

  // Subscribe to this column's option data (reactive!)
  const option = useFieldSelectOption(resourceFieldId, columnId)

  // Get entity label for "New X" button
  const entityLabel = useResourceProperty(entityDefinitionId, 'label') ?? 'Record'

  // Get mutations for option changes
  const { updateOption, deleteOption } = useFieldSelectOptionMutations(resourceFieldId)

  // Get view config for visibility and collapsed state
  const kanbanConfig = useKanbanConfig(tableId)
  const isVisible = kanbanConfig?.columnSettings?.[columnId]?.isVisible !== false
  const initialCollapsed = kanbanConfig?.collapsedColumns?.includes(columnId) ?? false
  const updateKanbanConfig = useUpdateKanbanConfig(tableId)

  // Local collapsed state (UI-only, could be persisted to view config if needed)
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed)

  // Derive display values from option (or defaults for No Status column)
  const title = isNoStatusColumn ? 'No stage' : (option?.label ?? columnId)
  const color = isNoStatusColumn ? 'gray' : (option?.color ?? 'gray')
  const targetTimeInStatus = option?.targetTimeInStatus
  const celebration = option?.celebration

  // Sortable for column reordering
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: columnId,
    data: { type: 'column' },
    disabled: !isSortable,
  })

  // Droppable for card drops
  const { setNodeRef: setDroppableRef, isOver: isDndOver } = useDroppable({
    id: columnId,
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
        transform: transform ? CSS.Transform.toString({ ...transform, y: 0 }) : undefined,
        transition,
      }
    : undefined

  // Use existing color utilities from @auxx/lib
  const colorDot = getColorSwatch(color as SelectOptionColor)
  // Only highlight when cards are dragged over, not when columns are being reordered
  const isActive = (isOver || isDndOver) && !isSourceColumn && !isDraggingColumn

  /** Handle option changes (label, color, time, celebration) */
  const handleChange = useCallback(
    (changes: SelectOptionChanges) => {
      updateOption(columnId, changes)
    },
    [columnId, updateOption]
  )

  /** Handle visibility change (view-level setting) */
  const handleVisibilityChange = useCallback(
    (visible: boolean) => {
      updateKanbanConfig({
        columnSettings: {
          ...kanbanConfig?.columnSettings,
          [columnId]: { ...kanbanConfig?.columnSettings?.[columnId], isVisible: visible },
        },
      })
    },
    [columnId, kanbanConfig?.columnSettings, updateKanbanConfig]
  )

  /** Handle column deletion */
  const handleDelete = useCallback(() => {
    deleteOption(columnId)
  }, [columnId, deleteOption])

  // Don't render non-existent options (except No Status column)
  if (!isNoStatusColumn && !option) return null

  // Collapsed state - vertical label
  if (isCollapsed) {
    return (
      <div ref={setNodeRef} style={style} className='shrink-0 pr-3'>
        <div
          className={cn(
            'w-10 h-full rounded-lg border bg-muted/30 cursor-pointer hover:bg-muted/50',
            isActive && 'border-info bg-info/10',
            isDragging && 'opacity-50'
          )}
          onClick={() => setIsCollapsed(false)}>
          <div className='flex flex-col items-center py-3 px-1 h-full'>
            <ChevronRight className='size-4 mb-2 text-muted-foreground' />
            <div className={cn('size-2.5 rounded-full mb-2', colorDot)} />
            <div
              className='text-xs font-medium text-muted-foreground whitespace-nowrap'
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              {title}
            </div>
            <Badge variant='pill' size='xs' className='mt-2'>
              {count}
            </Badge>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style} className='shrink-0 pr-3 max-h-full'>
      <div
        className={cn(
          'group/kanban-col w-64 h-full rounded-lg border border-transparent bg-muted/30 flex flex-col max-h-full',
          isActive && 'border-info bg-info/10',
          isDragging && 'border-primary-200 bg-primary-200 backdrop-blur-sm shadow-lg z-50'
        )}>
        {/* Column header */}
        {(() => {
          const headerContent = (
            <div
              className={cn(
                'flex items-center px-3 py-2.5 border-b',
                !isNoStatusColumn &&
                  'group/header cursor-pointer hover:bg-muted/50 transition-colors'
              )}>
              <div className={cn('size-3.5 rounded-full shrink-0 me-2', colorDot)} />
              <div className='flex-1 min-w-0 flex items-center gap-2'>
                <span className='text-sm font-medium truncate'>{title}</span>
                <Badge variant='pill' size='xs'>
                  {count}
                </Badge>
              </div>
              <Button
                variant='ghost'
                size='icon-xs'
                className='size-5 opacity-0 group-hover/kanban-col:opacity-100'
                onClick={(e) => {
                  e.stopPropagation()
                  setIsCollapsed(true)
                }}
                onPointerDown={(e) => e.stopPropagation()}>
                <EyeOff className='size-3' />
              </Button>
              {onAddCard && (
                <Button
                  variant='ghost'
                  size='icon-xs'
                  className='size-5 opacity-0 group-hover/kanban-col:opacity-100'
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddCard()
                  }}>
                  <Plus className='size-3' />
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
                  className='p-0.5 -mr-1 opacity-0 group-hover/kanban-col:opacity-100 cursor-grab active:cursor-grabbing touch-none'>
                  <GripVertical className='size-3.5 text-muted-foreground' />
                </button>
              )}
            </div>
          )

          if (isNoStatusColumn) {
            return headerContent
          }

          return (
            <KanbanColumnSettings
              columnId={columnId}
              resourceFieldId={resourceFieldId}
              mode='full'
              onVisibilityChange={handleVisibilityChange}
              onDelete={handleDelete}>
              {headerContent}
            </KanbanColumnSettings>
          )
        })()}

        {/* Column content - scrollable */}
        <ScrollArea className='flex-1 min-h-0'>
          <div className='p-2 space-y-2'>
            {children}

            {/* Empty state with prominent add button */}
            {count === 0 && onAddCard && (
              <button
                onClick={onAddCard}
                className='w-full h-8  items-center border border-dashed rounded-lg text-sm text-muted-foreground hover:border-primary-500 hover:text-primary-500 hover:bg-primary-400/10 transition-colors flex justify-center gap-2'>
                <Plus className='size-4' />
                New {entityLabel}
              </button>
            )}
          </div>
        </ScrollArea>

        {/* Column footer - calculations */}
        {onAddCalculation && (
          <div className='border-t px-3 py-2'>
            <button
              onClick={onAddCalculation}
              className='text-xs text-muted-foreground hover:text-foreground transition-colors'>
              + Add calculation
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
