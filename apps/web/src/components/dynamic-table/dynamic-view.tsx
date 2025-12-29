// apps/web/src/components/dynamic-table/dynamic-view.tsx
'use client'

import { useMemo } from 'react'
import { DynamicTable } from './index'
import { KanbanView } from '../kanban'
import { useDynamicTable } from './hooks/use-dynamic-table'
import type { DynamicTableProps, ViewType, KanbanViewConfig } from './types'
// ModelType is inherited from DynamicTableProps via types.ts

/** Select option from SINGLE_SELECT field */
interface SelectOption {
  id: string
  label: string
  color?: string
}

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

  /** Get value for row/field - PASSED FROM PARENT (from syncer.getValue) */
  getValue?: (rowId: string, fieldId: string) => unknown

  /** Callback when card moves in kanban - PASSED FROM PARENT */
  onKanbanCardMove?: (cardId: string, newColumnId: string) => Promise<void>

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
  getValue,
  onKanbanCardMove,
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

  // Get the groupBy field for kanban
  const groupByField = useMemo(() => {
    if (!kanbanConfig?.groupByFieldId || !selectFields) return null
    return selectFields.find((f) => f.id === kanbanConfig.groupByFieldId) ?? null
  }, [kanbanConfig?.groupByFieldId, selectFields])

  // Check if current view is kanban with valid config
  const isKanbanView = viewType === 'kanban' && !!groupByField && !!getValue

  // Render Kanban view
  if (isKanbanView && kanbanConfig && groupByField) {
    return (
      <KanbanView
        data={tableProps.data}
        config={kanbanConfig}
        groupByField={groupByField}
        customFields={customFields ?? []}
        primaryFieldId={kanbanConfig.primaryFieldId ?? primaryFieldId}
        entityLabel={entityLabel}
        onCardMove={onKanbanCardMove}
        onCardClick={onCardClick}
        onAddCard={onAddCard}
        isLoading={tableProps.isLoading}
        getValue={getValue!}
      />
    )
  }

  // Render Table view (default)
  return <DynamicTable {...tableProps}>{children}</DynamicTable>
}
