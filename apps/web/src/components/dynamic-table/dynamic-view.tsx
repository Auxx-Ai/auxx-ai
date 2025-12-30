// apps/web/src/components/dynamic-table/dynamic-view.tsx
'use client'

import { useMemo, useState, useCallback, useEffect } from 'react'
import { DynamicTable } from './index'
import { KanbanView } from '../kanban'
import { type ColumnOptionChanges } from '../kanban/kanban-column-settings'
import { useDynamicTable } from './hooks/use-dynamic-table'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { useCustomField } from '~/components/custom-fields/hooks/use-custom-field'
import type {
  DynamicTableProps,
  ViewType,
  KanbanViewConfig,
  ViewConfig,
} from './types'
import type { ModelType, SelectOption, TargetTimeInStatus } from '@auxx/types/custom-field'

/** Custom field for kanban display */
interface SelectField {
  id: string
  name: string
  type: string
  options?: { options?: SelectOption[] }
}

/** Custom field definition */
interface CustomField {
  id: string
  name: string
  type: string
}

/** Props for DynamicView component */
interface DynamicViewProps<TData> extends DynamicTableProps<TData> {
  /** SINGLE_SELECT fields for kanban grouping (from parent's customFields) */
  selectFields?: SelectField[]

  /** All custom fields for card display (from parent's customFields) */
  customFields?: CustomField[]

  /** Primary display field ID (from resource.display.primaryDisplayField.id) */
  primaryFieldId?: string

  /** Entity label for "New X" buttons (from resource.label) */
  entityLabel?: string

  /** Callback when card is clicked */
  onCardClick?: (card: TData) => void

  /** Callback to add a new card in a column */
  onAddCard?: (columnId: string) => void
  // modelType and entityDefinitionId inherited from DynamicTableProps
}

/**
 * DynamicView - Renders either DynamicTable or KanbanView based on view config.
 * DOES NOT FETCH DATA - receives everything from parent (same as DynamicTable).
 */
export function DynamicView<TData extends Record<string, any>>({
  selectFields,
  customFields,
  primaryFieldId,
  entityLabel,
  onCardClick,
  onAddCard,
  children,
  ...tableProps
}: DynamicViewProps<TData> & { children?: React.ReactNode }) {
  // Use existing hook to get table state including currentView
  const tableState = useDynamicTable(tableProps)
  const { currentView } = tableState

  // Derive view type from current view config
  const viewType: ViewType = (currentView?.config as any)?.viewType ?? 'table'
  const kanbanConfig: KanbanViewConfig | undefined = (currentView?.config as any)?.kanban

  // Local state for optimistic column reordering
  const [localColumnOrder, setLocalColumnOrder] = useState<string[] | null>(null)

  // Reset local state when view changes
  useEffect(() => {
    setLocalColumnOrder(null)
  }, [currentView?.id])

  // Mutation for updating view config
  const updateView = api.tableView.update.useMutation()

  // Effective column order: local state takes precedence for instant feedback
  const effectiveColumnOrder = localColumnOrder ?? kanbanConfig?.columnOrder ?? []

  /** Handle kanban column reorder with optimistic updates */
  const handleKanbanColumnReorder = useCallback(
    async (newColumnOrder: string[]) => {
      // 1. Optimistic update - instant feedback
      setLocalColumnOrder(newColumnOrder)

      // 2. Persist in background
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
              // Rollback on error
              setLocalColumnOrder(null)
              toastError({ title: 'Failed to save column order', description: error.message })
            },
            // Don't clear localColumnOrder on success - keep optimistic state
            // until view changes (handled by useEffect) or component unmounts
          }
        )
      }
    },
    [currentView, updateView]
  )

  // Custom field management hook for updating select options
  const { update: updateField } = useCustomField({
    modelType: (tableProps.modelType ?? 'contact') as ModelType,
    entityDefinitionId: tableProps.entityDefinitionId,
  })

  // Get current options from groupByField for merging updates
  const getCurrentOptions = useCallback((): SelectOption[] => {
    if (!kanbanConfig?.groupByFieldId || !selectFields) return []
    const field = selectFields.find((f) => f.id === kanbanConfig.groupByFieldId)
    return field?.options?.options ?? []
  }, [kanbanConfig?.groupByFieldId, selectFields])

  /** Handle column option changes (unified callback - called when dropdown closes) */
  const handleColumnChange = useCallback(
    (columnId: string, changes: ColumnOptionChanges) => {
      if (!kanbanConfig?.groupByFieldId) return
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
        { id: kanbanConfig.groupByFieldId, options: updatedOptions },
        {
          onError: (error) => {
            toastError({ title: 'Failed to update stage', description: error.message })
          },
        }
      )
    },
    [kanbanConfig?.groupByFieldId, getCurrentOptions, updateField]
  )

  /** Handle creating a new column */
  const handleColumnCreate = useCallback(
    (option: { label: string; color: string }) => {
      console.log('Creating column', option)
      if (!kanbanConfig?.groupByFieldId) return
      const currentOptions = getCurrentOptions()

      const newOption: SelectOption = {
        label: option.label,
        value: option.label, // Use label as value (same pattern as options-editor)
        color: option.color,
      }

      updateField.mutate(
        { id: kanbanConfig.groupByFieldId, options: [...currentOptions, newOption] },
        {
          onError: (error) => {
            toastError({ title: 'Failed to add stage', description: error.message })
          },
        }
      )
    },
    [kanbanConfig?.groupByFieldId, getCurrentOptions, updateField]
  )

  /** Handle column visibility change (view-level setting) */
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

  /** Handle column delete */
  const handleColumnDelete = useCallback(
    (columnId: string) => {
      if (!kanbanConfig?.groupByFieldId) return
      const currentOptions = getCurrentOptions()
      const updatedOptions = currentOptions.filter((opt) => opt.value !== columnId)
      updateField.mutate(
        { id: kanbanConfig.groupByFieldId, options: updatedOptions },
        {
          onError: (error) => {
            toastError({ title: 'Failed to delete stage', description: error.message })
          },
        }
      )
    },
    [kanbanConfig?.groupByFieldId, getCurrentOptions, updateField]
  )

  // Get the groupBy field for kanban
  const groupByField = useMemo(() => {
    if (!kanbanConfig?.groupByFieldId || !selectFields) return null
    return selectFields.find((f) => f.id === kanbanConfig.groupByFieldId) ?? null
  }, [kanbanConfig?.groupByFieldId, selectFields])

  // Check if current view is kanban with valid config
  const isKanbanView = viewType === 'kanban' && !!groupByField

  // Build effective kanban config with optimistic column order
  const effectiveKanbanConfig = useMemo(() => {
    if (!kanbanConfig) return undefined
    return {
      ...kanbanConfig,
      columnOrder: effectiveColumnOrder,
    }
  }, [kanbanConfig, effectiveColumnOrder])

  // Render Kanban view
  if (isKanbanView && effectiveKanbanConfig && groupByField) {
    return (
      <KanbanView
        data={tableProps.data}
        config={effectiveKanbanConfig}
        groupByField={groupByField}
        customFields={customFields ?? []}
        primaryFieldId={effectiveKanbanConfig.primaryFieldId ?? primaryFieldId}
        entityLabel={entityLabel}
        onCardClick={onCardClick}
        onAddCard={onAddCard}
        onColumnReorder={handleKanbanColumnReorder}
        isLoading={tableProps.isLoading}
        // Column settings callbacks
        onColumnChange={handleColumnChange}
        onColumnCreate={handleColumnCreate}
        onColumnVisibilityChange={handleColumnVisibilityChange}
        onColumnDelete={handleColumnDelete}
        // Self-contained props - KanbanView reads from store directly
        resourceType={tableProps.modelType === 'entity' ? 'entity' : 'contact'}
        entityDefinitionId={tableProps.entityDefinitionId}
        modelType={(tableProps.modelType ?? 'contact') as ModelType}
      />
    )
  }

  // Render Table view (default)
  return <DynamicTable {...tableProps}>{children}</DynamicTable>
}
