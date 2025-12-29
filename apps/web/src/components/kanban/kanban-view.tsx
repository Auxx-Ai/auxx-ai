// apps/web/src/components/kanban/kanban-view.tsx
'use client'

import { useCallback, useMemo, useState, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { ScrollArea, ScrollBar } from '@auxx/ui/components/scroll-area'
import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { KanbanColumn } from './kanban-column'
import { KanbanCard } from './kanban-card'
import type { KanbanViewConfig } from '../dynamic-table/types'

/** Option from SINGLE_SELECT field (raw from DB) */
interface RawSelectOption {
  value: string
  label: string
  color?: string
}

/** Normalized option for kanban columns */
interface SelectOption {
  id: string
  label: string
  color?: string
}

/** Generic row data with customFieldValues */
interface KanbanRow {
  id: string
  updatedAt?: string | Date
  customFieldValues?: Array<{
    fieldId: string
    value: unknown
  }>
  [key: string]: unknown
}

/** Custom field definition */
interface CustomField {
  id: string
  name: string
  type: string
  options?: {
    options?: SelectOption[]
  }
}

/** Drag item type */
type DragItemType = 'card' | 'column'

/** Props for KanbanView component */
interface KanbanViewProps<TData extends KanbanRow> {
  /** Data rows to display */
  data: TData[]
  /** Kanban configuration */
  config: KanbanViewConfig
  /** Custom field used for grouping (SINGLE_SELECT) */
  groupByField: CustomField
  /** All custom fields for card display */
  customFields: CustomField[]
  /** Primary display field ID */
  primaryFieldId?: string
  /** Entity label (singular) for "New X" buttons */
  entityLabel?: string
  /** Callback when a card is moved to a new column */
  onCardMove?: (cardId: string, newColumnId: string) => Promise<void>
  /** Callback when cards are reordered within a column */
  onCardReorder?: (columnId: string, cardIds: string[]) => Promise<void>
  /** Callback when columns are reordered */
  onColumnReorder?: (columnIds: string[]) => Promise<void>
  /** Callback when a card is clicked */
  onCardClick?: (card: TData) => void
  /** Callback when "New X" is clicked in a column */
  onAddCard?: (columnId: string) => void
  /** Callback to add a new stage/column */
  onAddColumn?: () => void
  /** Loading state */
  isLoading?: boolean
  /** Get value for a field */
  getValue: (rowId: string, fieldId: string) => unknown
}

/**
 * Kanban board view component.
 * Features: sortable columns, color dots, quick actions, last activity.
 */
export function KanbanView<TData extends KanbanRow>({
  data,
  config,
  groupByField,
  customFields,
  primaryFieldId,
  entityLabel = 'Record',
  onCardMove,
  onCardReorder,
  onColumnReorder,
  onCardClick,
  onAddCard,
  onAddColumn,
  isLoading,
  getValue,
}: KanbanViewProps<TData>) {
  const [activeItem, setActiveItem] = useState<{
    type: DragItemType
    id: string
    data?: TData | SelectOption
  } | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Get options from the groupBy field - normalize value -> id
  const columns: SelectOption[] = useMemo(() => {
    const rawOptions: RawSelectOption[] = groupByField.options?.options ?? []
    // Normalize: map 'value' to 'id' for consistent usage
    const normalizedOptions: SelectOption[] = rawOptions.map((o) => ({
      id: o.value,
      label: o.label,
      color: o.color,
    }))
    console.log('[KanbanView] normalized options:', normalizedOptions)
    // Use custom column order if defined, otherwise use field option order
    if (config.columnOrder?.length) {
      return config.columnOrder
        .map((id) => normalizedOptions.find((o) => o.id === id))
        .filter(Boolean) as SelectOption[]
    }
    return normalizedOptions
  }, [groupByField.options, config.columnOrder])

  // Column IDs for sortable context
  const columnIds = useMemo(() => ['__no_status__', ...columns.map((c) => c.id)], [columns])

  // Group data by column
  const columnData = useMemo(() => {
    const grouped: Record<string, TData[]> = {}

    // Initialize all columns (including empty ones)
    columns.forEach((col) => {
      grouped[col.id] = []
    })

    // Add "No Status" column for items without a value
    grouped['__no_status__'] = []

    // Group items
    data.forEach((item) => {
      const fieldValue = getValue(item.id, config.groupByFieldId)
      const columnId = fieldValue ? String(fieldValue) : '__no_status__'

      if (grouped[columnId]) {
        grouped[columnId].push(item)
      } else {
        grouped['__no_status__'].push(item)
      }
    })

    return grouped
  }, [data, columns, config.groupByFieldId, getValue])

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  /** Handle drag start */
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event
      const type = active.data.current?.type as DragItemType

      console.log('[DragStart]', {
        activeId: active.id,
        activeType: type,
        activeDataCurrent: active.data.current,
        columnsAvailable: columns.map((c) => c.id),
        columnIds,
      })

      if (type === 'column') {
        const column = columns.find((c) => c.id === active.id)
        console.log('[DragStart] Column match:', { column, searchingFor: active.id })
        if (column) {
          setActiveItem({ type: 'column', id: String(active.id), data: column })
        } else {
          console.warn('[DragStart] No column found for id:', active.id)
        }
      } else {
        const card = data.find((d) => d.id === active.id)
        if (card) {
          setActiveItem({ type: 'card', id: String(active.id), data: card })
        }
      }
    },
    [data, columns, columnIds]
  )

  /** Handle drag over */
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event
    setOverId(over?.id?.toString() ?? null)
  }, [])

  /** Handle drag end */
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      const activeType = active.data.current?.type as DragItemType

      console.log('[DragEnd]', {
        activeId: active.id,
        activeType,
        activeDataCurrent: active.data.current,
        overId: over?.id,
        overDataCurrent: over?.data.current,
        columnIds,
      })

      setActiveItem(null)
      setOverId(null)

      if (!over) {
        console.log('[DragEnd] No over target, returning')
        return
      }

      const activeId = active.id.toString()
      const targetOverId = over.id.toString()

      // Column reordering
      if (activeType === 'column' && onColumnReorder) {
        const oldIndex = columnIds.indexOf(activeId)
        const newIndex = columnIds.indexOf(targetOverId)
        console.log('[DragEnd] Column reorder attempt:', {
          activeId,
          targetOverId,
          oldIndex,
          newIndex,
          columnIds,
          onColumnReorderExists: !!onColumnReorder,
        })
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const newOrder = arrayMove(columnIds, oldIndex, newIndex).filter(
            (id) => id !== '__no_status__'
          )
          console.log('[DragEnd] Calling onColumnReorder with:', newOrder)
          await onColumnReorder(newOrder)
        } else {
          console.log('[DragEnd] Column reorder skipped - indices invalid or same position')
        }
        return
      }

      // Card operations
      const overColumn = [...columns, { id: '__no_status__' }].find((c) => c.id === targetOverId)
      const overCard = data.find((d) => d.id === targetOverId)

      if (overColumn) {
        // Dropped directly on a column
        const activeCard = data.find((d) => d.id === activeId)
        if (activeCard && onCardMove) {
          const currentColumnId = String(
            getValue(activeCard.id, config.groupByFieldId) ?? '__no_status__'
          )

          if (currentColumnId !== overColumn.id) {
            await onCardMove(activeId, overColumn.id === '__no_status__' ? '' : overColumn.id)
          }
        }
      } else if (overCard) {
        // Dropped on another card
        const overCardColumnId = String(
          getValue(overCard.id, config.groupByFieldId) ?? '__no_status__'
        )

        const activeCard = data.find((d) => d.id === activeId)
        if (activeCard) {
          const activeCardColumnId = String(
            getValue(activeCard.id, config.groupByFieldId) ?? '__no_status__'
          )

          if (activeCardColumnId !== overCardColumnId) {
            if (onCardMove) {
              await onCardMove(
                activeId,
                overCardColumnId === '__no_status__' ? '' : overCardColumnId
              )
            }
          } else if (onCardReorder) {
            const columnCards = columnData[activeCardColumnId] ?? []
            const oldIndex = columnCards.findIndex((c) => c.id === activeId)
            const newIndex = columnCards.findIndex((c) => c.id === targetOverId)

            if (oldIndex !== newIndex) {
              const newOrder = arrayMove(columnCards, oldIndex, newIndex).map((c) => c.id)
              await onCardReorder(activeCardColumnId, newOrder)
            }
          }
        }
      }
    },
    [
      columns,
      data,
      columnData,
      columnIds,
      config.groupByFieldId,
      getValue,
      onCardMove,
      onCardReorder,
      onColumnReorder,
    ]
  )

  /** Handle drag cancel */
  const handleDragCancel = useCallback(() => {
    setActiveItem(null)
    setOverId(null)
  }, [])

  // Get primary display value for a card
  const getPrimaryValue = useCallback(
    (card: TData) => {
      if (!primaryFieldId) return card.id
      return getValue(card.id, primaryFieldId)
    },
    [primaryFieldId, getValue]
  )

  // Get card fields to display (exclude primary and groupBy)
  const cardFields = useMemo(() => {
    if (config.cardFields?.length) {
      return config.cardFields
        .map((id) => customFields.find((f) => f.id === id))
        .filter(Boolean) as CustomField[]
    }
    return customFields
      .filter((f) => f.id !== primaryFieldId && f.id !== config.groupByFieldId)
      .slice(0, 2)
  }, [config.cardFields, customFields, primaryFieldId, config.groupByFieldId])

  if (isLoading) {
    return (
      <div className="flex gap-4 p-4 overflow-x-auto h-full">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="w-64 shrink-0 rounded-lg border bg-muted/30 p-3 animate-pulse">
            <div className="flex items-center gap-2 mb-4">
              <div className="size-3 rounded-full bg-muted" />
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="h-4 w-6 bg-muted rounded" />
            </div>
            <div className="space-y-2">
              <div className="h-20 bg-muted rounded" />
              <div className="h-20 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}>
        <ScrollArea className="h-full">
          <div ref={containerRef} className="flex gap-3 p-4 min-w-max flex-1">
            {/* Sortable columns */}
            <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
              {/* No Status column (always first, not sortable) */}
              <KanbanColumn
                id="__no_status__"
                title="No stage"
                color="gray"
                count={columnData['__no_status__']?.length ?? 0}
                isCollapsed={config.collapsedColumns?.includes('__no_status__')}
                isOver={overId === '__no_status__'}
                entityLabel={entityLabel}
                onAddCard={onAddCard ? () => onAddCard('__no_status__') : undefined}
                isSortable={false}>
                <SortableContext
                  items={(columnData['__no_status__'] ?? []).map((c) => c.id)}
                  strategy={verticalListSortingStrategy}>
                  {(columnData['__no_status__'] ?? []).map((card, index) => (
                    <KanbanCard
                      key={card.id}
                      id={card.id}
                      index={index}
                      title={String(getPrimaryValue(card) ?? 'Untitled')}
                      fields={cardFields}
                      updatedAt={card.updatedAt}
                      getValue={(fieldId) => getValue(card.id, fieldId)}
                      onClick={() => onCardClick?.(card)}
                    />
                  ))}
                </SortableContext>
              </KanbanColumn>

              {/* Regular columns (sortable) */}
              {columns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  id={column.id}
                  title={column.label}
                  color={column.color}
                  count={columnData[column.id]?.length ?? 0}
                  isCollapsed={config.collapsedColumns?.includes(column.id)}
                  isOver={overId === column.id}
                  entityLabel={entityLabel}
                  onAddCard={onAddCard ? () => onAddCard(column.id) : undefined}
                  isSortable>
                  <SortableContext
                    items={(columnData[column.id] ?? []).map((c) => c.id)}
                    strategy={verticalListSortingStrategy}>
                    {(columnData[column.id] ?? []).map((card, index) => (
                      <KanbanCard
                        key={card.id}
                        id={card.id}
                        index={index}
                        title={String(getPrimaryValue(card) ?? 'Untitled')}
                        fields={cardFields}
                        updatedAt={card.updatedAt}
                        getValue={(fieldId) => getValue(card.id, fieldId)}
                        onClick={() => onCardClick?.(card)}
                      />
                    ))}
                  </SortableContext>
                </KanbanColumn>
              ))}
            </SortableContext>

            {/* Add Stage button */}
            {onAddColumn && (
              <div className="shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-lg border border-dashed hover:border-primary hover:bg-primary/5"
                  onClick={onAddColumn}>
                  <Plus className="size-5 text-muted-foreground" />
                </Button>
              </div>
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        {/* Drag overlay */}
        <DragOverlay>
          {activeItem?.type === 'card' && activeItem.data && (
            <KanbanCard
              id={activeItem.id}
              index={0}
              title={String(getPrimaryValue(activeItem.data as TData) ?? 'Untitled')}
              fields={cardFields}
              getValue={(fieldId) => getValue((activeItem.data as TData).id, fieldId)}
              isDragging
            />
          )}
          {activeItem?.type === 'column' && activeItem.data && (
            <div className="w-64 h-20 rounded-lg border-2 border-primary bg-primary/10 flex items-center justify-center">
              <span className="font-medium">{(activeItem.data as SelectOption).label}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
