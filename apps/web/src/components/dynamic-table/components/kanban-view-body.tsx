// apps/web/src/components/dynamic-table/components/kanban-view-body.tsx
'use client'

import { toRecordId } from '@auxx/lib/resources/client'
import { toResourceFieldId } from '@auxx/types/field'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useResource } from '~/components/resources'
import { fieldValueFetchQueue } from '~/components/resources/store/field-value-fetch-queue'
import { KanbanView } from '../../kanban'
import { useTableConfig } from '../context/table-config-context'
import { useTableInstance } from '../context/table-instance-context'
import { useViewMetadata } from '../context/view-metadata-context'
import { useUpdateKanbanConfig } from '../stores/store-actions'
import { useActiveView, useKanbanConfig } from '../stores/store-selectors'
import type { KanbanRow } from '../types'
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentView?.id triggers reset on view switch
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

  // Derive primaryFieldId from viewConfig or resource - convert to ResourceFieldId
  const primaryFieldId = useMemo(() => {
    if (!entityDefinitionId) return undefined
    // Priority 1: View config - convert to ResourceFieldId
    const configFieldId = kanbanConfig?.primaryFieldId
    if (configFieldId) {
      return toResourceFieldId(entityDefinitionId, configFieldId)
    }
    // Priority 2: Resource display field
    const displayFieldId = resource?.display.primaryDisplayField?.id
    if (displayFieldId) {
      return toResourceFieldId(entityDefinitionId, displayFieldId)
    }
    return undefined
  }, [kanbanConfig?.primaryFieldId, resource, entityDefinitionId])

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
      <div className='flex items-center justify-center h-64 text-muted-foreground'>
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

  // Queue fetch for groupByField values (kanban grouping requires these)
  useEffect(() => {
    if (!kanbanConfig?.groupByFieldId || !entityDefinitionId) return

    const data = table.getRowModel().rows.map((row) => row.original) as TData[]
    if (data.length === 0) return

    const groupByFieldRef = toResourceFieldId(entityDefinitionId, kanbanConfig.groupByFieldId)

    // Queue fetches for all records' groupByField values
    fieldValueFetchQueue.queueFetchBatch(
      data.map((record) => ({
        recordId: toRecordId(entityDefinitionId, record.id),
        fieldRef: groupByFieldRef,
      }))
    )
  }, [kanbanConfig?.groupByFieldId, entityDefinitionId, table])

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
