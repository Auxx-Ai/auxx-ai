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
import { showCelebrationConfetti } from '~/components/subscriptions/show-confetti'
import { NO_STATUS_COLUMN_ID, type KanbanViewConfig } from '../dynamic-table/types'
import type { SelectOption as RawSelectOption, TargetTimeInStatus } from '@auxx/types/custom-field'

/** Normalized option for kanban columns (with id instead of value) */
interface KanbanColumn {
  id: string
  label: string
  color?: string
  /** Target time for items to remain in this status */
  targetTimeInStatus?: TargetTimeInStatus
  /** Trigger celebration animation when cards move to this column */
  celebration?: boolean
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
    options?: KanbanColumn[]
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

  /** Column settings callbacks */
  onColumnLabelChange?: (columnId: string, label: string) => void
  onColumnColorChange?: (columnId: string, color: string) => void
  onColumnTargetTimeChange?: (columnId: string, time: TargetTimeInStatus | null) => void
  onColumnCelebrationChange?: (columnId: string, enabled: boolean) => void
  onColumnVisibilityChange?: (columnId: string, visible: boolean) => void
  onColumnDelete?: (columnId: string) => void
}

/**
 * Kanban board view component.
 * Features: sortable columns, color dots, quick actions, last activity, celebration.
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
  // Column settings callbacks
  onColumnLabelChange,
  onColumnColorChange,
  onColumnTargetTimeChange,
  onColumnCelebrationChange,
  onColumnVisibilityChange,
  onColumnDelete,
}: KanbanViewProps<TData>) {
  const [activeItem, setActiveItem] = useState<{
    type: DragItemType
    id: string
    data?: TData | SelectOption
  } | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)

  /** Toggle card selection */
  const handleCardSelectChange = useCallback((cardId: string, selected: boolean) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev)
      if (selected) {
        next.add(cardId)
      } else {
        next.delete(cardId)
      }
      return next
    })
  }, [])

  // Get options from the groupBy field - normalize value -> id
  const allColumns: SelectOption[] = useMemo(() => {
    const rawOptions: RawSelectOption[] = groupByField.options?.options ?? []
    // Normalize: map 'value' to 'id' for consistent usage
    const normalizedOptions: SelectOption[] = rawOptions.map((o) => ({
      id: o.value,
      label: o.label,
      color: o.color,
      targetTimeInStatus: o.targetTimeInStatus,
      celebration: o.celebration,
    }))
    // Use custom column order if defined, otherwise use field option order
    if (config.columnOrder?.length) {
      return config.columnOrder
        .map((id) => normalizedOptions.find((o) => o.id === id))
        .filter(Boolean) as SelectOption[]
    }
    return normalizedOptions
  }, [groupByField.options, config.columnOrder])

  // Filter columns by visibility settings
  const columns = useMemo(() => {
    return allColumns.filter((col) => {
      const settings = config.columnSettings?.[col.id]
      return settings?.isVisible !== false
    })
  }, [allColumns, config.columnSettings])

  // Column IDs for sortable context
  const columnIds = useMemo(() => [NO_STATUS_COLUMN_ID, ...columns.map((c) => c.id)], [columns])

  // Group data by column
  const columnData = useMemo(() => {
    const grouped: Record<string, TData[]> = {}

    // Initialize all columns (including empty ones)
    columns.forEach((col) => {
      grouped[col.id] = []
    })

    // Add "No Status" column for items without a value
    grouped[NO_STATUS_COLUMN_ID] = []

    // Group items
    data.forEach((item) => {
      const fieldValue = getValue(item.id, config.groupByFieldId)
      const columnId = fieldValue ? String(fieldValue) : NO_STATUS_COLUMN_ID

      if (grouped[columnId]) {
        grouped[columnId].push(item)
      } else {
        grouped[NO_STATUS_COLUMN_ID] && grouped[NO_STATUS_COLUMN_ID].push(item)
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

      if (type === 'column') {
        const column = columns.find((c) => c.id === active.id)
        if (column) {
          setActiveItem({ type: 'column', id: String(active.id), data: column })
        }
      } else {
        const card = data.find((d) => d.id === active.id)
        if (card) {
          setActiveItem({ type: 'card', id: String(active.id), data: card })
        }
      }
    },
    [data, columns]
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

      setActiveItem(null)
      setOverId(null)

      if (!over) {
        return
      }

      const activeId = active.id.toString()
      const targetOverId = over.id.toString()

      // Column reordering
      if (activeType === 'column' && onColumnReorder) {
        const oldIndex = columnIds.indexOf(activeId)
        const newIndex = columnIds.indexOf(targetOverId)
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const newOrder = arrayMove(columnIds, oldIndex, newIndex).filter(
            (id) => id !== NO_STATUS_COLUMN_ID
          )
          await onColumnReorder(newOrder)
        }
        return
      }

      // Card operations
      const overColumn = [...columns, { id: NO_STATUS_COLUMN_ID }].find(
        (c) => c.id === targetOverId
      )
      const overCard = data.find((d) => d.id === targetOverId)

      // Helper to check if target column has celebration enabled
      const shouldCelebrate = (targetColumnId: string): boolean => {
        const targetColumn = columns.find((c) => c.id === targetColumnId)
        return targetColumn?.celebration === true
      }

      if (overColumn) {
        // Dropped directly on a column
        const activeCard = data.find((d) => d.id === activeId)
        if (activeCard && onCardMove) {
          const currentColumnId = String(
            getValue(activeCard.id, config.groupByFieldId) ?? NO_STATUS_COLUMN_ID
          )

          if (currentColumnId !== overColumn.id) {
            // Check for celebration before moving
            if (shouldCelebrate(overColumn.id)) {
              showCelebrationConfetti()
            }
            await onCardMove(activeId, overColumn.id === NO_STATUS_COLUMN_ID ? '' : overColumn.id)
          }
        }
      } else if (overCard) {
        // Dropped on another card
        const overCardColumnId = String(
          getValue(overCard.id, config.groupByFieldId) ?? NO_STATUS_COLUMN_ID
        )

        const activeCard = data.find((d) => d.id === activeId)
        if (activeCard) {
          const activeCardColumnId = String(
            getValue(activeCard.id, config.groupByFieldId) ?? NO_STATUS_COLUMN_ID
          )

          if (activeCardColumnId !== overCardColumnId) {
            if (onCardMove) {
              // Check for celebration before moving
              if (shouldCelebrate(overCardColumnId)) {
                showCelebrationConfetti()
              }
              await onCardMove(
                activeId,
                overCardColumnId === NO_STATUS_COLUMN_ID ? '' : overCardColumnId
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
                id={NO_STATUS_COLUMN_ID}
                title="No stage"
                color="gray"
                count={columnData[NO_STATUS_COLUMN_ID]?.length ?? 0}
                isCollapsed={config.collapsedColumns?.includes(NO_STATUS_COLUMN_ID)}
                isOver={overId === NO_STATUS_COLUMN_ID}
                entityLabel={entityLabel}
                onAddCard={onAddCard ? () => onAddCard(NO_STATUS_COLUMN_ID) : undefined}
                isSortable={false}>
                <SortableContext
                  items={(columnData[NO_STATUS_COLUMN_ID] ?? []).map((c) => c.id)}
                  strategy={verticalListSortingStrategy}>
                  {(columnData[NO_STATUS_COLUMN_ID] ?? []).map((card, index) => (
                    <KanbanCard
                      key={card.id}
                      id={card.id}
                      index={index}
                      title={String(getPrimaryValue(card) ?? 'Untitled')}
                      fields={cardFields}
                      updatedAt={card.updatedAt}
                      getValue={(fieldId) => getValue(card.id, fieldId)}
                      onClick={() => onCardClick?.(card)}
                      isSelected={selectedCardIds.has(card.id)}
                      onSelectChange={(selected) => handleCardSelectChange(card.id, selected)}
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
                  isSortable
                  // Settings props
                  targetTimeInStatus={column.targetTimeInStatus}
                  celebration={column.celebration}
                  isVisible={config.columnSettings?.[column.id]?.isVisible !== false}
                  // Settings callbacks
                  onLabelChange={
                    onColumnLabelChange
                      ? (label) => onColumnLabelChange(column.id, label)
                      : undefined
                  }
                  onColorChange={
                    onColumnColorChange
                      ? (color) => onColumnColorChange(column.id, color)
                      : undefined
                  }
                  onTargetTimeChange={
                    onColumnTargetTimeChange
                      ? (time) => onColumnTargetTimeChange(column.id, time)
                      : undefined
                  }
                  onCelebrationChange={
                    onColumnCelebrationChange
                      ? (enabled) => onColumnCelebrationChange(column.id, enabled)
                      : undefined
                  }
                  onVisibilityChange={
                    onColumnVisibilityChange
                      ? (visible) => onColumnVisibilityChange(column.id, visible)
                      : undefined
                  }
                  onDelete={onColumnDelete ? () => onColumnDelete(column.id) : undefined}>
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
                        isSelected={selectedCardIds.has(card.id)}
                        onSelectChange={(selected) => handleCardSelectChange(card.id, selected)}
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
