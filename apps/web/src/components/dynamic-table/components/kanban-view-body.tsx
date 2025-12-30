// apps/web/src/components/dynamic-table/components/kanban-view-body.tsx
'use client'

import { useCallback, useMemo, useState, useEffect } from 'react'
import { KanbanView } from '../../kanban'
import { useTableContext } from '../context/table-context'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import type { ViewConfig, KanbanViewConfig, KanbanRow } from '../types'
import type { ModelType } from '@auxx/types/custom-field'

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
    modelType,
    entityDefinitionId,
    selectedKanbanCardIds,
    onSelectedKanbanCardIdsChange,
  } = useTableContext<TData>()

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

  // Mutation for updating view config
  const updateView = api.tableView.update.useMutation()

  // Effective column order
  const effectiveColumnOrder = localColumnOrder ?? kanbanConfig?.columnOrder ?? []

  // Get groupBy field
  const groupByField = useMemo(() => {
    if (!kanbanConfig?.groupByFieldId || !selectFields) return null
    return selectFields.find((f) => f.id === kanbanConfig.groupByFieldId) ?? null
  }, [kanbanConfig?.groupByFieldId, selectFields])

  // Handle column reorder with optimistic updates
  const handleColumnReorder = useCallback(
    async (newColumnOrder: string[]) => {
      setLocalColumnOrder(newColumnOrder)

      if (currentView?.id) {
        const updatedConfig: ViewConfig = {
          ...(currentView.config as ViewConfig),
          kanban: {
            ...(currentView.config as ViewConfig).kanban!,
            columnOrder: newColumnOrder,
          },
        }

        updateView.mutate(
          { id: currentView.id, config: updatedConfig },
          {
            onError: (error) => {
              setLocalColumnOrder(null)
              toastError({ title: 'Failed to save column order', description: error.message })
            },
          }
        )
      }
    },
    [currentView, updateView]
  )

  // Handle column visibility change
  const handleColumnVisibilityChange = useCallback(
    (columnId: string, visible: boolean) => {
      if (!currentView?.id || !kanbanConfig) return

      const currentSettings = kanbanConfig.columnSettings ?? {}
      const updatedConfig: ViewConfig = {
        ...(currentView.config as ViewConfig),
        kanban: {
          ...kanbanConfig,
          columnSettings: {
            ...currentSettings,
            [columnId]: { ...currentSettings[columnId], isVisible: visible },
          },
        },
      }

      updateView.mutate(
        { id: currentView.id, config: updatedConfig },
        {
          onError: (error) => {
            toastError({ title: 'Failed to update column visibility', description: error.message })
          },
        }
      )
    },
    [currentView, kanbanConfig, updateView]
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

  // Convert selectField to format expected by KanbanView
  const groupByFieldForKanban = useMemo(
    () => ({
      id: groupByField.id,
      name: groupByField.name,
      type: groupByField.type ?? 'SINGLE_SELECT',
      options: groupByField.options,
    }),
    [groupByField]
  )

  // Convert customFields to format expected by KanbanView
  const customFieldsForKanban = useMemo(
    () =>
      (customFields ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
      })),
    [customFields]
  )

  return (
    <KanbanView
      data={data}
      config={effectiveConfig}
      groupByField={groupByFieldForKanban}
      customFields={customFieldsForKanban}
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
