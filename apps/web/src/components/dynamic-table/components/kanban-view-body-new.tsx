// apps/web/src/components/dynamic-table/components/kanban-view-body-new.tsx
'use client'

import { useCallback, useMemo, useState, useEffect } from 'react'
import { KanbanView } from '../../kanban'
import { useTableConfig } from '../context/table-config-context'
import { useTableInstance } from '../context/table-instance-context'
import { useViewMetadata } from '../context/view-metadata-context'
import { useActiveView } from '../hooks/use-table-selectors'
import type { ViewConfig, KanbanViewConfig, KanbanRow } from '../types'
import { useTableUIStore } from '../stores/table-ui-store'
import { useResource } from '~/components/resources'
import type { FieldType } from '@auxx/database/types'
/**
 * Kanban view body that integrates with focused contexts.
 * Handles view-level config mutations (column reorder, visibility).
 * NEW VERSION - Uses focused contexts instead of useTableContext.
 */
export function KanbanViewBodyNew<TData extends KanbanRow>() {
  // Get config from focused contexts
  const { tableId, isLoading, entityDefinitionId } = useTableConfig<TData>()
  const { table } = useTableInstance<TData>()
  const {
    selectFields,
    customFields,
    entityLabel,
    onCardClick,
    onAddCard,
    selectedKanbanCardIds,
    onSelectedKanbanCardIdsChange,
  } = useViewMetadata<TData>()

  // Get current view
  const currentView = useActiveView(tableId)

  // Get resource for primaryFieldId derivation
  const { resource } = useResource(entityDefinitionId)

  const updateKanbanConfig = useTableUIStore((state) => state.updateKanbanConfig)

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
  // const groupByFieldForKanban = useMemo(
  //   () => ({
  //     id: groupByField.id,
  //     key: groupByField.id,
  //     label: groupByField.name,
  //     name: groupByField.name,
  //     type: 'enum' as const,
  //     fieldType: (groupByField.type ?? 'SINGLE_SELECT'),
  //     options: groupByField.options,
  //     sortOrder: '0',
  //     active: true,
  //     capabilities: { filterable: true, sortable: true, creatable: true, updatable: true },
  //   }),
  //   [groupByField]
  // )

  return (
    <KanbanView
      data={data}
      config={effectiveConfig}
      groupByField={groupByField}
      customFields={customFields ?? []}
      primaryFieldId={primaryFieldId}
      entityLabel={entityLabel}
      onCardClick={onCardClick}
      onAddCard={onAddCard}
      onColumnReorder={handleColumnReorder}
      isLoading={isLoading}
      onColumnVisibilityChange={handleColumnVisibilityChange}
      entityDefinitionId={entityDefinitionId}
      selectedCardIds={selectedKanbanCardIds}
      onSelectedCardIdsChange={onSelectedKanbanCardIdsChange}
    />
  )
}
