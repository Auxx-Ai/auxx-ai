// apps/web/src/components/dynamic-table/components/kanban-view-body.tsx
'use client'

import { useCallback, useMemo, useState, useEffect } from 'react'
import { KanbanView } from '../../kanban'
import { useTableConfig } from '../context/table-config-context'
import { useTableInstance } from '../context/table-instance-context'
import { useViewMetadata } from '../context/view-metadata-context'
import { useActiveView, useKanbanConfig } from '../stores/store-selectors'
import { useUpdateKanbanConfig } from '../stores/store-actions'
import type { KanbanRow } from '../types'
import { useResource } from '~/components/resources'
/**
 * Kanban view body that integrates with focused contexts.
 * Handles view-level config mutations (column reorder, visibility).
 */
export function KanbanViewBody<TData extends KanbanRow>() {
  // Get config from focused contexts
  const { tableId, isLoading, entityDefinitionId } = useTableConfig<TData>()
  const { table } = useTableInstance<TData>()
  const {
    selectFields,
    customFields,
    onCardClick,
    onAddCard,
    selectedKanbanCardIds,
    onSelectedKanbanCardIdsChange,
  } = useViewMetadata<TData>()

  // Get current view and kanban config from centralized selectors/actions
  const currentView = useActiveView(tableId)
  const kanbanConfig = useKanbanConfig(tableId) ?? null
  const updateKanbanConfig = useUpdateKanbanConfig(tableId)

  // Get resource for primaryFieldId derivation
  const { resource } = useResource(entityDefinitionId)

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

  // Derive primaryFieldId from viewConfig or resource
  const primaryFieldId = useMemo(() => {
    // Priority 1: View config
    if (kanbanConfig?.primaryFieldId) return kanbanConfig.primaryFieldId

    // Priority 2: Resource display field
    return resource?.display.primaryDisplayField?.id
  }, [kanbanConfig?.primaryFieldId, resource])

  // Handle column reorder with optimistic updates
  const handleColumnReorder = useCallback(
    (newColumnOrder: string[]) => {
      setLocalColumnOrder(newColumnOrder)
      updateKanbanConfig({ columnOrder: newColumnOrder })
    },
    [updateKanbanConfig]
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

  return (
    <KanbanView
      data={data}
      config={effectiveConfig}
      groupByField={groupByField}
      customFields={customFields ?? []}
      primaryFieldId={primaryFieldId}
      onCardClick={onCardClick}
      onAddCard={onAddCard}
      onColumnReorder={handleColumnReorder}
      isLoading={isLoading}
      entityDefinitionId={entityDefinitionId}
      tableId={tableId}
      selectedCardIds={selectedKanbanCardIds}
      onSelectedCardIdsChange={onSelectedKanbanCardIdsChange}
    />
  )
}
