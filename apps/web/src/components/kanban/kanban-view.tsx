// apps/web/src/components/kanban/kanban-view.tsx
'use client'

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  pointerWithin,
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
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { ScrollArea, ScrollBar } from '@auxx/ui/components/scroll-area'
import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { KanbanColumn } from './kanban-column'
import { KanbanCard } from './kanban-card'
import { KanbanColumnSettings, type ColumnOptionChanges } from './kanban-column-settings'
import { showCelebrationConfetti } from '~/components/subscriptions/show-confetti'
import { useStackedDragOverlay } from '~/hooks/use-stacked-drag-overlay'
import {
  NO_STATUS_COLUMN_ID,
  type KanbanViewConfig,
  type KanbanRow,
  type KanbanSelectOption,
  type CustomField,
  type KanbanDragItemType,
} from '../dynamic-table/types'
import type { SelectOption as RawSelectOption, TargetTimeInStatus, ModelType } from '@auxx/types/custom-field'
import {
  useCustomFieldValueStore,
  buildValueKey,
  type ResourceType,
} from '~/stores/custom-field-value-store'
import { useSaveFieldValue } from '~/hooks/use-save-field-value'
import { useCustomField } from '~/components/custom-fields/hooks/use-custom-field'
import { toastError } from '@auxx/ui/components/toast'
import { formatToRawValue } from '@auxx/lib/field-values/client'
import { FieldType } from '@auxx/database/enums'

/**
 * Extract raw value from TypedFieldValue using centralized formatter.
 * Used for column grouping and drag operations.
 */
function extractRawValue(value: unknown): unknown {
  if (value == null) return null
  // Use SINGLE_SELECT since kanban groups by select fields
  return formatToRawValue(value, FieldType.SINGLE_SELECT)
}


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
  /** Callback when columns are reordered (view-level) */
  onColumnReorder?: (columnIds: string[]) => Promise<void>
  /** Callback when a card is clicked */
  onCardClick?: (card: TData) => void
  /** Callback when "New X" is clicked in a column */
  onAddCard?: (columnId: string) => void
  /** Loading state */
  isLoading?: boolean

  /** View-level visibility change (modifies view config, not field options) */
  onColumnVisibilityChange?: (columnId: string, visible: boolean) => void

  /** Resource type for store key building */
  resourceType: ResourceType
  /** Entity definition ID (required for 'entity' resourceType) */
  entityDefinitionId?: string
  /** Model type for useSaveFieldValue */
  modelType: ModelType

  /** Selected card IDs (controlled mode - state lives in parent) */
  selectedCardIds?: Set<string>
  /** Callback when selected card IDs change */
  onSelectedCardIdsChange?: (ids: Set<string>) => void
}

/** Props for KanbanDragOverlay component */
interface KanbanDragOverlayProps<TData extends KanbanRow> {
  activeItem: {
    type: KanbanDragItemType
    id: string
    data?: TData | KanbanSelectOption
    sourceColumnId?: string
    draggedCards?: TData[]
    dragWidth?: number
  } | null
  cardFields: CustomField[]
  /** Resource type for store subscription */
  resourceType: ResourceType
  /** Entity definition ID (required for 'entity' resourceType) */
  entityDefId?: string
  /** Primary field ID for card title */
  primaryFieldId?: string
}

/**
 * Drag overlay component for kanban cards.
 * Renders stacked cards when multiple are selected.
 */
function KanbanDragOverlay<TData extends KanbanRow>({
  activeItem,
  cardFields,
  resourceType,
  entityDefId,
  primaryFieldId,
}: KanbanDragOverlayProps<TData>) {
  const draggedCards = activeItem?.draggedCards ?? []
  const { getItemStyle, indices, showBadge, totalCount } = useStackedDragOverlay({
    count: draggedCards.length,
  })
  if (!activeItem) return null

  // Column drag: no overlay, let the actual element move
  if (activeItem.type === 'column') return null

  // Card drag overlay with stacking for multi-select
  if (activeItem.type === 'card' && draggedCards.length > 0) {
    return (
      <DragOverlay dropAnimation={null}>
        <div className="relative cursor-grabbing">
          {showBadge && (
            <span
              className="absolute z-10 inline-flex size-5 items-center justify-center rounded-full bg-info text-[10px] font-medium leading-none text-white"
              style={{ right: '-8px', top: '-8px' }}>
              {totalCount}
            </span>
          )}
          <div className="relative">
            {indices.map((itemIndex, renderIndex) => {
              const card = draggedCards[itemIndex]
              if (!card) return null
              return (
                <div
                  key={card.id}
                  className="pointer-events-none"
                  style={{
                    ...getItemStyle(renderIndex),
                    width: activeItem?.dragWidth,
                  }}>
                  <KanbanCard
                    id={card.id}
                    fields={cardFields}
                    resourceType={resourceType}
                    entityDefId={entityDefId}
                    primaryFieldId={primaryFieldId}
                    editable={false}
                    isDragging
                  />
                </div>
              )
            })}
          </div>
        </div>
      </DragOverlay>
    )
  }

  return null
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
  onColumnReorder,
  onCardClick,
  onAddCard,
  isLoading,
  // View-level callback (modifies view config, not field options)
  onColumnVisibilityChange,
  // Self-contained props
  resourceType,
  entityDefinitionId,
  modelType,
  // Controlled selection (optional - falls back to internal state)
  selectedCardIds: controlledSelectedCardIds,
  onSelectedCardIdsChange,
}: KanbanViewProps<TData>) {
  const [activeItem, setActiveItem] = useState<{
    type: KanbanDragItemType
    id: string
    data?: TData | KanbanSelectOption
    sourceColumnId?: string
    /** Cards being dragged (for multi-select) */
    draggedCards?: TData[]
    /** Width of the dragged card for consistent overlay sizing */
    dragWidth?: number
  } | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [internalSelectedCardIds, setInternalSelectedCardIds] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)

  // Use controlled or internal state
  const selectedCardIds = controlledSelectedCardIds ?? internalSelectedCardIds
  const setSelectedCardIds = onSelectedCardIdsChange ?? setInternalSelectedCardIds
  // Track pending options for optimistic updates (prevents race conditions on rapid creates)
  const [pendingOptions, setPendingOptions] = useState<RawSelectOption[]>([])

  // Subscribe to store values - this IS reactive (component re-renders when groupBy values change)
  const storeValues = useCustomFieldValueStore((s) => s.values)

  // Create reactive getValue from store
  const getValue = useCallback(
    (rowId: string, fieldId: string): unknown => {
      const key = buildValueKey(resourceType, rowId, fieldId, entityDefinitionId)
      return storeValues[key]
    },
    [storeValues, resourceType, entityDefinitionId]
  )

  // Field metadata provider for relationship sync (required by hook, but kanban only changes SINGLE_SELECT)
  const getFieldMetadata = useCallback(
    (fieldId: string) => {
      const field = customFields.find((f) => f.id === fieldId)
      if (!field) return undefined
      return {
        type: field.fieldType!,
        relationship: field.options?.relationship as {
          isInverse?: boolean
          inverseFieldId?: string
          relationshipType?: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
          relatedEntityDefinitionId?: string
          relatedModelType?: string
        },
      }
    },
    [customFields]
  )

  // useSaveFieldValue for internal card moves with optimistic updates
  const { saveBulkValues } = useSaveFieldValue({
    resourceType,
    entityDefId: entityDefinitionId,
    modelType,
    getFieldMetadata,
  })

  // useCustomField for column option mutations (label, color, etc.)
  const { update: updateField } = useCustomField({
    modelType,
    entityDefinitionId,
  })

  /** Get current options from groupByField for mutations (includes pending optimistic options) */
  const getCurrentOptions = useCallback((): RawSelectOption[] => {
    const baseOptions = groupByField.options?.options ?? []
    // Merge pending options that aren't already in base (by value)
    const baseValues = new Set(baseOptions.map((o) => o.value))
    const newPending = pendingOptions.filter((o) => !baseValues.has(o.value))
    return [...baseOptions, ...newPending]
  }, [groupByField.options, pendingOptions])

  // Clear pending options when groupByField.options changes (refetch completed)
  useEffect(() => {
    if (pendingOptions.length > 0) {
      const baseValues = new Set((groupByField.options?.options ?? []).map((o) => o.value))
      // Remove pending options that are now in the base options
      const stillPending = pendingOptions.filter((o) => !baseValues.has(o.value))
      if (stillPending.length !== pendingOptions.length) {
        setPendingOptions(stillPending)
      }
    }
  }, [groupByField.options, pendingOptions])

  /** Handle column option changes (label, color, time, celebration) */
  const handleColumnChange = useCallback(
    (columnId: string, changes: ColumnOptionChanges) => {
      const currentOptions = getCurrentOptions()
      const updatedOptions = currentOptions.map((opt) => {
        if (opt.value !== columnId) return opt
        return {
          ...opt,
          ...(changes.label !== undefined && { label: changes.label }),
          ...(changes.color !== undefined && { color: changes.color }),
          ...(changes.targetTimeInStatus !== undefined && {
            targetTimeInStatus: changes.targetTimeInStatus ?? undefined,
          }),
          ...(changes.celebration !== undefined && { celebration: changes.celebration }),
        }
      })
      updateField.mutate(
        { id: config.groupByFieldId, options: updatedOptions },
        {
          onError: (error) => {
            toastError({ title: 'Failed to update stage', description: error.message })
          },
        }
      )
    },
    [getCurrentOptions, config.groupByFieldId, updateField]
  )

  /** Handle creating a new column */
  const handleColumnCreate = useCallback(
    (option: { label: string; color: string }) => {
      const currentOptions = getCurrentOptions()
      const newOption: RawSelectOption = {
        label: option.label,
        value: option.label, // Use label as value (same pattern as options-editor)
        color: option.color,
      }
      // Optimistic update: add to pending so rapid creates don't lose options
      setPendingOptions((prev) => [...prev, newOption])
      updateField.mutate(
        { id: config.groupByFieldId, options: [...currentOptions, newOption] },
        {
          onError: (error) => {
            // Rollback: remove from pending on error
            setPendingOptions((prev) => prev.filter((o) => o.value !== newOption.value))
            toastError({ title: 'Failed to add stage', description: error.message })
          },
        }
      )
    },
    [getCurrentOptions, config.groupByFieldId, updateField]
  )

  /** Handle deleting a column */
  const handleColumnDelete = useCallback(
    (columnId: string) => {
      const currentOptions = getCurrentOptions()
      const updatedOptions = currentOptions.filter((opt) => opt.value !== columnId)
      updateField.mutate(
        { id: config.groupByFieldId, options: updatedOptions },
        {
          onError: (error) => {
            toastError({ title: 'Failed to delete stage', description: error.message })
          },
        }
      )
    },
    [getCurrentOptions, config.groupByFieldId, updateField]
  )

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

  // Get options from the groupBy field - normalize value -> id (includes pending options)
  const allColumns: KanbanSelectOption[] = useMemo(() => {
    const rawOptions: RawSelectOption[] = groupByField.options?.options ?? []
    // Merge pending options that aren't already in base (by value)
    const baseValues = new Set(rawOptions.map((o) => o.value))
    const newPending = pendingOptions.filter((o) => !baseValues.has(o.value))
    const mergedOptions = [...rawOptions, ...newPending]
    // Normalize: map 'value' to 'id' for consistent usage
    const normalizedOptions: KanbanSelectOption[] = mergedOptions.map((o) => ({
      id: o.value,
      label: o.label,
      color: o.color,
      targetTimeInStatus: o.targetTimeInStatus,
      celebration: o.celebration,
    }))
    // If no column order defined, use field option order
    if (!config.columnOrder?.length) {
      return normalizedOptions
    }
    // Use column order for ordering, but include ALL options
    // Options in columnOrder appear first (in that order), then any new options are appended
    const orderedColumns = config.columnOrder
      .map((id) => normalizedOptions.find((o) => o.id === id))
      .filter(Boolean) as KanbanSelectOption[]
    const orderedIds = new Set(config.columnOrder)
    const unorderedColumns = normalizedOptions.filter((o) => !orderedIds.has(o.id))
    return [...orderedColumns, ...unorderedColumns]
  }, [groupByField.options, config.columnOrder, pendingOptions])

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

    // Initialize ALL columns (including hidden ones)
    // This ensures items keep their correct grouping even when column is hidden
    allColumns.forEach((col) => {
      grouped[col.id] = []
    })

    // Add "No Status" column for items without a value
    grouped[NO_STATUS_COLUMN_ID] = []

    // Group items - extract raw value from TypedFieldValue for column matching
    data.forEach((item) => {
      const fieldValue = getValue(item.id, config.groupByFieldId)
      const rawValue = extractRawValue(fieldValue)
      const columnId = rawValue ? String(rawValue) : NO_STATUS_COLUMN_ID

      if (grouped[columnId]) {
        grouped[columnId].push(item)
      } else {
        // Only items with truly invalid/deleted column values go to No Stage
        grouped[NO_STATUS_COLUMN_ID] && grouped[NO_STATUS_COLUMN_ID].push(item)
      }
    })

    return grouped
  }, [data, allColumns, config.groupByFieldId, getValue])

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  /** Handle drag start */
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active, activatorEvent } = event
      const type = active.data.current?.type as KanbanDragItemType
      // Find the card element from the clicked target and get its width
      const targetElement = activatorEvent.target as HTMLElement
      const cardElement = targetElement?.closest('[data-kanban-card]') as HTMLElement | null
      const dragWidth = cardElement?.offsetWidth

      if (type === 'column') {
        const column = columns.find((c) => c.id === active.id)
        if (column) {
          setActiveItem({ type: 'column', id: String(active.id), data: column })
        }
      } else {
        const card = data.find((d) => d.id === active.id)
        if (card) {
          const sourceColumnId = String(extractRawValue(getValue(card.id, config.groupByFieldId)) ?? NO_STATUS_COLUMN_ID)

          // If dragged card is selected, drag all selected cards
          // Otherwise, just drag the single card
          const draggedIds = selectedCardIds.has(String(active.id))
            ? Array.from(selectedCardIds)
            : [String(active.id)]

          const draggedCards = draggedIds
            .map((id) => data.find((d) => d.id === id))
            .filter(Boolean) as TData[]

          setActiveItem({
            type: 'card',
            id: String(active.id),
            data: card,
            sourceColumnId,
            draggedCards,
            dragWidth,
          })
        }
      }
    },
    [data, columns, getValue, config.groupByFieldId, selectedCardIds]
  )

  /** Handle drag over */
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event
    setOverId(over?.id?.toString() ?? null)
  }, [])

  /** Handle drag end - supports multi-select with internal saveValue */
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      const activeType = active.data.current?.type as KanbanDragItemType

      // Capture dragged cards BEFORE clearing state
      const draggedCards = activeItem?.draggedCards ?? []

      setActiveItem(null)
      setOverId(null)

      if (!over) return

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

      // Card to column drop - handles multi-select with internal saveValue
      if (activeType === 'card' && draggedCards.length > 0) {
        const targetColumnId = targetOverId
        const newValue = targetColumnId === NO_STATUS_COLUMN_ID ? null : targetColumnId

        // Filter cards that need moving (not already in target column)
        const cardsToMove = draggedCards.filter((card) => {
          const currentValue = extractRawValue(getValue(card.id, config.groupByFieldId))
          const currentColumnId = currentValue ? String(currentValue) : NO_STATUS_COLUMN_ID
          return currentColumnId !== targetColumnId
        })

        if (cardsToMove.length === 0) return

        // Show celebration once (not per card)
        const targetColumn = columns.find((c) => c.id === targetColumnId)
        if (targetColumn?.celebration) {
          showCelebrationConfetti()
        }

        // Move all cards in single API call with optimistic updates
        saveBulkValues(
          cardsToMove.map((card) => card.id),
          config.groupByFieldId,
          newValue
        )

        // Clear selection after drop
        setSelectedCardIds(new Set())
      }
    },
    [activeItem, columns, columnIds, config.groupByFieldId, getValue, onColumnReorder, saveBulkValues]
  )

  /** Handle drag cancel */
  const handleDragCancel = useCallback(() => {
    setActiveItem(null)
    setOverId(null)
  }, [])

  // Get card fields to display - only explicitly configured fields (no defaults)
  const cardFields = useMemo(() => {
    if (!config.cardFields?.length) return []
    return config.cardFields
      .map((id) => customFields.find((f) => f.id === id))
      .filter((f): f is CustomField => f !== undefined)
  }, [config.cardFields, customFields])

  // Track which cards are being dragged (for placeholder styling on multi-select)
  const draggingCardIds = useMemo(() => {
    if (!activeItem?.draggedCards) return new Set<string>()
    return new Set(activeItem.draggedCards.map((c) => c.id))
  }, [activeItem?.draggedCards])

  // Mass select mode: when any card is selected, clicking cards toggles selection
  const massSelectMode = selectedCardIds.size > 0

  if (isLoading) {
    return (
      <div className="flex gap-4 p-2 overflow-x-auto h-full">
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
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}>
        <ScrollArea className="h-full">
          <div ref={containerRef} className="flex p-2 min-w-max flex-1 h-full">
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
                isSourceColumn={activeItem?.sourceColumnId === NO_STATUS_COLUMN_ID}
                isDraggingColumn={activeItem?.type === 'column'}
                entityLabel={entityLabel}
                onAddCard={onAddCard ? () => onAddCard(NO_STATUS_COLUMN_ID) : undefined}
                isSortable={false}>
                {(columnData[NO_STATUS_COLUMN_ID] ?? []).map((card) => (
                  <KanbanCard
                    key={card.id}
                    id={card.id}
                    fields={cardFields}
                    updatedAt={card.updatedAt}
                    resourceType={resourceType}
                    entityDefId={entityDefinitionId}
                    primaryFieldId={primaryFieldId}
                    onClick={() => onCardClick?.(card)}
                    isSelected={selectedCardIds.has(card.id)}
                    onSelectChange={(selected) => handleCardSelectChange(card.id, selected)}
                    isBeingDragged={draggingCardIds.has(card.id)}
                    massSelectMode={massSelectMode}
                  />
                ))}
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
                  isSourceColumn={activeItem?.sourceColumnId === column.id}
                  isDraggingColumn={activeItem?.type === 'column'}
                  entityLabel={entityLabel}
                  onAddCard={onAddCard ? () => onAddCard(column.id) : undefined}
                  isSortable
                  // Settings props
                  targetTimeInStatus={column.targetTimeInStatus}
                  celebration={column.celebration}
                  isVisible={config.columnSettings?.[column.id]?.isVisible !== false}
                  // Settings callbacks (internal handlers)
                  onChange={(changes) => handleColumnChange(column.id, changes)}
                  onVisibilityChange={
                    onColumnVisibilityChange
                      ? (visible) => onColumnVisibilityChange(column.id, visible)
                      : undefined
                  }
                  onDelete={() => handleColumnDelete(column.id)}>
                  {(columnData[column.id] ?? []).map((card) => (
                    <KanbanCard
                      key={card.id}
                      id={card.id}
                      fields={cardFields}
                      updatedAt={card.updatedAt}
                      resourceType={resourceType}
                      entityDefId={entityDefinitionId}
                      primaryFieldId={primaryFieldId}
                      onClick={() => onCardClick?.(card)}
                      isSelected={selectedCardIds.has(card.id)}
                      onSelectChange={(selected) => handleCardSelectChange(card.id, selected)}
                      isBeingDragged={draggingCardIds.has(card.id)}
                      massSelectMode={massSelectMode}
                    />
                  ))}
                </KanbanColumn>
              ))}
            </SortableContext>

            {/* Add Stage button with create dropdown */}
            <div className="shrink-0">
              <KanbanColumnSettings mode="create" onCreate={handleColumnCreate}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-xl border border-dashed hover:border-primary-300 hover:bg-primary-100">
                  <Plus className="size-5 text-muted-foreground" />
                </Button>
              </KanbanColumnSettings>
            </div>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        {/* Drag overlay */}
        <KanbanDragOverlay
          activeItem={activeItem}
          cardFields={cardFields}
          resourceType={resourceType}
          entityDefId={entityDefinitionId}
          primaryFieldId={primaryFieldId}
        />
      </DndContext>
    </div>
  )
}
