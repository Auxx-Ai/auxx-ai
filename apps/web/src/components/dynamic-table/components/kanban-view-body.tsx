// apps/web/src/components/dynamic-table/components/kanban-view-body.tsx
'use client'

import { useCallback, useMemo, useState, useEffect } from 'react'
import { KanbanView } from '../../kanban'
import { useTableContext } from '../context/table-context'
import type { ViewConfig, KanbanViewConfig, KanbanRow } from '../types'
import type { ModelType } from '@auxx/types/custom-field'
import { useViewStore } from '../stores/view-store'
import { getModelType } from '@auxx/types/resource'

/**
 * Kanban view body that integrates with TableContext.
 * Handles view-level config mutations (column reorder, visibility).
 * Uses the same data as the table view through context.
 */
export function KanbanViewBody<TData extends KanbanRow>() {
  const {
    table,
    currentView,
    selectFields,
    customFields,
    primaryFieldId,
    entityLabel,
    onCardClick,
    onAddCard,
    isLoading,
    entityDefinitionId,
    selectedKanbanCardIds,
    onSelectedKanbanCardIdsChange,
  } = useTableContext<TData>()

  // Derive modelType from entityDefinitionId
  const modelType = useMemo(
    () => (entityDefinitionId ? getModelType(entityDefinitionId) : ('contact' as ModelType)),
    [entityDefinitionId]
  )

  const updateKanbanConfig = useViewStore((state) => state.updateKanbanConfig)

  // Get kanban config from current view
  const kanbanConfig = useMemo(() => {
    return (currentView?.config as ViewConfig)?.kanban ?? null
  }, [currentView])

  // Local state for optimistic column reordering
  const [localColumnOrder, setLocalColumnOrder] = useState<string[] | null>(null)

  // Reset local state when view changes
  useEffect(() => {
    setLocalColumnOrder(null)
  }, [currentView?.id])

  // Effective column order
  const effectiveColumnOrder = localColumnOrder ?? kanbanConfig?.columnOrder ?? []

  // Get groupBy field
  const groupByField = useMemo(() => {
    if (!kanbanConfig?.groupByFieldId || !selectFields) return null
    return selectFields.find((f) => f.id === kanbanConfig.groupByFieldId) ?? null
  }, [kanbanConfig?.groupByFieldId, selectFields])

  // Handle column reorder with optimistic updates
  const handleColumnReorder = useCallback(
    (newColumnOrder: string[]) => {
      setLocalColumnOrder(newColumnOrder)

      if (currentView?.id) {
        updateKanbanConfig(currentView.id, { columnOrder: newColumnOrder })
      }
    },
    [currentView?.id, updateKanbanConfig]
  )

  // Handle column visibility change
  const handleColumnVisibilityChange = useCallback(
    (columnId: string, visible: boolean) => {
      if (!currentView?.id || !kanbanConfig) return

      const currentSettings = kanbanConfig.columnSettings ?? {}
      updateKanbanConfig(currentView.id, {
        columnSettings: {
          ...currentSettings,
          [columnId]: { ...currentSettings[columnId], isVisible: visible },
        },
      })
    },
    [currentView?.id, kanbanConfig, updateKanbanConfig]
  )

  // If no valid kanban config, don't render
  if (!kanbanConfig || !groupByField) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Kanban view requires a valid groupBy field configuration.
      </div>
    )
  }

  // Build effective config with optimistic column order
  const effectiveConfig = useMemo(
    () => ({
      ...kanbanConfig,
      columnOrder: effectiveColumnOrder,
    }),
    [kanbanConfig, effectiveColumnOrder]
  )

  // Get data from table rows
  const data = table.getRowModel().rows.map((row) => row.original) as TData[]

  // Convert selectField to format expected by KanbanView (CustomField type)
  const groupByFieldForKanban = useMemo(
    () => ({
      id: groupByField.id,
      key: groupByField.id,
      label: groupByField.name,
      name: groupByField.name,
      type: 'enum' as const,
      fieldType: (groupByField.type ?? 'SINGLE_SELECT') as import('@auxx/database/types').FieldType,
      options: groupByField.options,
      sortOrder: '0',
      active: true,
      capabilities: { filterable: true, sortable: true, creatable: true, updatable: true },
    }),
    [groupByField]
  )

  return (
    <KanbanView
      data={data}
      config={effectiveConfig}
      groupByField={groupByFieldForKanban}
      customFields={customFields ?? []}
      primaryFieldId={effectiveConfig.primaryFieldId ?? primaryFieldId}
      entityLabel={entityLabel}
      onCardClick={onCardClick}
      onAddCard={onAddCard}
      onColumnReorder={handleColumnReorder}
      isLoading={isLoading}
      onColumnVisibilityChange={handleColumnVisibilityChange}
      resourceType={modelType === 'entity' ? 'entity' : 'contact'}
      entityDefinitionId={entityDefinitionId}
      modelType={(modelType ?? 'contact') as ModelType}
      selectedCardIds={selectedKanbanCardIds}
      onSelectedCardIdsChange={onSelectedKanbanCardIdsChange}
    />
  )
}
