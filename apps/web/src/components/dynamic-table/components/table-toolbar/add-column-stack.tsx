// apps/web/src/components/dynamic-table/components/table-toolbar/add-column-stack.tsx

'use client'

import type { FieldPath, FieldReference } from '@auxx/types/field'
import { isFieldPath } from '@auxx/types/field'
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  type NavigationItem,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import type { Column } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { FieldPickerNavigationItem } from '~/components/pickers/field-picker'
import { FieldPickerInnerContent } from '~/components/pickers/field-picker'
import { useTableConfig } from '../../context/table-config-context'
import { useTableInstance } from '../../context/table-instance-context'
import { useSetColumnOrder, useSetColumnVisibility } from '../../stores/store-actions'
import { useColumnLabels, useColumnOrder, useColumnVisibility } from '../../stores/store-selectors'
import { encodeFieldPathColumnId } from '../../utils/column-id'

/** Base navigation item for "Add column" action */
export interface AddColumnNavigationItem extends NavigationItem {
  id: string
  label: string
  type: 'add-column'
}

/** Navigation item type for column manager (union of add-column and relationship drill-down) */
export type ColumnNavigationItem = AddColumnNavigationItem | FieldPickerNavigationItem

/**
 * Props for AddColumnStack.
 *
 * `onFieldAdded` is called after a field is added as a column. Used to close
 * the containing popover when the stack is rendered standalone (e.g. from the
 * header "+" button). When unset, the stack falls back to `pop()` — which is
 * what ColumnManager wants (go back to the root "visible columns" list).
 */
interface AddColumnStackProps {
  onCreateField: () => void
  onFieldAdded?: () => void
}

/**
 * AddColumnStack - Shows available fields to add as columns.
 * Uses FieldPickerInnerContent with external navigation to avoid nested breadcrumbs.
 */
export function AddColumnStack({ onCreateField, onFieldAdded }: AddColumnStackProps) {
  const { tableId, entityDefinitionId } = useTableConfig()
  const { table } = useTableInstance()
  const columnVisibility = useColumnVisibility(tableId)
  const columnOrder = useColumnOrder(tableId)
  const setColumnVisibility = useSetColumnVisibility(tableId)
  const setColumnOrder = useSetColumnOrder(tableId)
  const { stack, current, push, pop } = useCommandNavigation<ColumnNavigationItem>()

  // Exclude columns that are currently visible. Read via tanstack's
  // getIsVisible() because the zustand columnVisibility map is sparse — it
  // only contains user overrides, not defaultVisible: true columns. tanstack's
  // state is the merge of defaults + overrides (see use-dynamic-table.tsx's
  // mergedColumnVisibility), so it's the authoritative source for "visible".
  // columnVisibility stays in the dep list to keep the memo reactive to
  // store updates (which flow into tanstack state).
  // biome-ignore lint/correctness/useExhaustiveDependencies: columnVisibility drives getIsVisible via tanstack state
  const visibleColumnIds = useMemo(() => {
    return table
      .getAllColumns()
      .filter((col) => col.getIsVisible() && col.id !== '_checkbox')
      .map((col) => col.id)
  }, [table, columnVisibility])

  // Handle field selection - add as column
  const handleSelectField = useCallback(
    (fieldReference: FieldReference) => {
      // Encode the field reference as a column ID
      // For paths: "product:vendor::vendor:name"
      // For direct fields: "contact:email"
      const columnId: string = isFieldPath(fieldReference)
        ? encodeFieldPathColumnId(fieldReference as FieldPath)
        : (fieldReference as string)

      // Make column visible
      setColumnVisibility({
        ...(columnVisibility ?? {}),
        [columnId]: true,
      })

      // Add to column order at the END (after all current visible columns)
      if (!columnOrder?.includes(columnId)) {
        // Ensure all currently visible columns are in order first, then add new one
        const existingOrder = columnOrder ?? []
        const unorderedVisible = visibleColumnIds.filter((id) => !existingOrder.includes(id))
        setColumnOrder([...existingOrder, ...unorderedVisible, columnId])
      }

      if (onFieldAdded) {
        onFieldAdded()
      } else {
        pop()
      }
    },
    [
      columnVisibility,
      columnOrder,
      visibleColumnIds,
      setColumnVisibility,
      setColumnOrder,
      pop,
      onFieldAdded,
    ]
  )

  // Filter stack to only include FieldPickerNavigationItem items (for relationship drill-down)
  const fieldPickerStack = useMemo(() => {
    return stack.filter((item): item is FieldPickerNavigationItem => 'resourceFieldId' in item)
  }, [stack])

  // Get current item for resource picker (only if it's a relationship navigation item)
  const fieldPickerCurrent = useMemo((): FieldPickerNavigationItem | null => {
    if (!current) return null
    if ('resourceFieldId' in current) return current as FieldPickerNavigationItem
    return null
  }, [current])

  // External navigation adapter for FieldPickerInnerContent
  const externalNavigation = useMemo(
    () => ({
      push: (item: FieldPickerNavigationItem) => push(item),
      pop,
      stack: fieldPickerStack,
      current: fieldPickerCurrent,
      // "At root" for the resource picker means we're at the add-column entry
      // (no relationship has been drilled into yet)
      isAtRoot: fieldPickerStack.length === 0,
    }),
    [push, pop, fieldPickerStack, fieldPickerCurrent]
  )

  // Fallback if no entityDefinitionId (non-resource table)
  if (!entityDefinitionId) {
    return <LegacyAddColumnStack onCreateField={onCreateField} />
  }

  return (
    <FieldPickerInnerContent
      entityDefinitionId={entityDefinitionId}
      excludeFields={visibleColumnIds}
      mode='single'
      closeOnSelect={false} // navigation is managed via onFieldAdded / pop()
      onSelect={handleSelectField}
      onCreateField={onCreateField}
      searchPlaceholder='Search fields...'
      externalNavigation={externalNavigation}
    />
  )
}

/**
 * LegacyAddColumnStack - Fallback for tables without entityDefinitionId.
 * Shows hidden columns from TanStack Table.
 */
export function LegacyAddColumnStack<TData = any>({
  onCreateField,
}: {
  onCreateField: () => void
}) {
  const { tableId, entityDefinitionId } = useTableConfig()
  const { table } = useTableInstance<TData>()
  const columnLabels = useColumnLabels(tableId)
  const columnVisibility = useColumnVisibility(tableId)
  const columnOrder = useColumnOrder(tableId)
  const setColumnVisibility = useSetColumnVisibility(tableId)
  const setColumnOrder = useSetColumnOrder(tableId)
  const [search, setSearch] = useState('')

  // Get visible column IDs (for ensuring order when adding new columns)
  const visibleColumnIds = useMemo(() => {
    if (!columnVisibility) return []
    return Object.entries(columnVisibility)
      .filter(([_, visible]) => visible !== false)
      .map(([id]) => id)
  }, [columnVisibility])

  // Get hidden columns
  const hiddenColumns = useMemo(() => {
    // Get all hideable columns
    const allColumns = table
      .getAllColumns()
      .filter((col) => col.getCanHide() && col.id !== '_checkbox')

    // Filter to hidden only (uses TanStack state which includes defaultVisible merging)
    return allColumns.filter((col) => !col.getIsVisible())
  }, [table, columnVisibility])

  // Get column name
  const getColumnName = useCallback(
    (column: Column<TData, unknown>) => {
      const label = columnLabels?.[column.id]
      if (label) return label

      const header = column.columnDef.header
      if (typeof header === 'string') return header

      return column.id
    },
    [columnLabels]
  )

  // Filter by search
  const filteredColumns = useMemo(() => {
    if (!search) return hiddenColumns
    const query = search.toLowerCase()
    return hiddenColumns.filter((col) => {
      const name = getColumnName(col)
      return name.toLowerCase().includes(query)
    })
  }, [hiddenColumns, search, getColumnName])

  // Handle add column
  const handleAddColumn = useCallback(
    (columnId: string) => {
      setColumnVisibility({
        ...(columnVisibility ?? {}),
        [columnId]: true,
      })

      // Add to column order at the END (after all current visible columns)
      if (!columnOrder?.includes(columnId)) {
        // Ensure all currently visible columns are in order first, then add new one
        const existingOrder = columnOrder ?? []
        const unorderedVisible = visibleColumnIds.filter((id) => !existingOrder.includes(id))
        setColumnOrder([...existingOrder, ...unorderedVisible, columnId])
      }
    },
    [columnVisibility, columnOrder, visibleColumnIds, setColumnVisibility, setColumnOrder]
  )

  return (
    <>
      <CommandInput
        placeholder='Search columns...'
        value={search}
        onValueChange={setSearch}
        autoFocus={true}
      />
      <CommandList>
        <CommandEmpty>No hidden columns found.</CommandEmpty>
        {filteredColumns.length > 0 && (
          <CommandGroup>
            {filteredColumns.map((column) => (
              <CommandItem
                key={column.id}
                value={column.id}
                onSelect={() => handleAddColumn(column.id)}>
                {getColumnName(column)}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Create Field Button - only show if entity definition exists */}
        {entityDefinitionId && (
          <>
            {filteredColumns.length > 0 && <CommandSeparator />}
            <CommandGroup>
              <CommandItem onSelect={onCreateField}>
                <Plus />
                Create field
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </>
  )
}
