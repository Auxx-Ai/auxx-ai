// apps/web/src/components/dynamic-table/components/table-toolbar/column-manager.tsx

'use client'

import { useState, useMemo, useCallback } from 'react'
import { Columns, Plus, MoreHorizontal, EyeOff, Pencil, Settings2 } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSortable,
  CommandSortableItem,
  CommandSeparator,
  CommandNavigation,
  CommandNavigableItem,
  CommandBreadcrumb,
  useCommandNavigation,
  type NavigationItem,
} from '@auxx/ui/components/command'
import { SmartBreadcrumb, type BreadcrumbSegment } from '@auxx/ui/components/smart-breadcrumb'

import { useTableConfig } from '../../context/table-config-context'
import { useTableInstance } from '../../context/table-instance-context'
import {
  useActiveView,
  useColumnLabels,
  useColumnVisibility,
  useColumnOrder,
  useColumnFormatting,
} from '../../stores/store-selectors'
import {
  useSetColumnVisibility,
  useSetColumnOrder,
  useSetColumnLabel,
  useSetColumnFormatting,
} from '../../stores/store-actions'
import { Tooltip } from '~/components/global/tooltip'
import { EditColumnLabelDialog } from '../dialogs/edit-column-label-dialog'
import { EditColumnFormattingDialog } from '../dialogs/edit-column-formatting-dialog'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { ResourcePickerInnerContent } from '~/components/pickers/resource-picker'
import { decodeColumnId, encodeFieldPathColumnId } from '../../utils/column-id'
import { useFields } from '~/components/resources/hooks/use-field'
import type { ResourcePickerNavigationItem } from '~/components/pickers/resource-picker'
import type { Column } from '@tanstack/react-table'
import type { ExtendedColumnDef, FormattableFieldType } from '../../types'
import { FORMATTABLE_FIELD_TYPES } from '../../types'
import { toResourceFieldId, toFieldId, isFieldPath } from '@auxx/types/field'
import type { FieldReference, FieldPath } from '@auxx/types/field'

/** Base navigation item for "Add column" action */
interface AddColumnNavigationItem extends NavigationItem {
  id: string
  label: string
  type: 'add-column'
}

/** Navigation item type for column manager (union of add-column and relationship drill-down) */
type ColumnNavigationItem = AddColumnNavigationItem | ResourcePickerNavigationItem

/**
 * RootStack - Shows visible columns (sortable, removable)
 */
function RootStack<TData = any>() {
  const { push } = useCommandNavigation<ColumnNavigationItem>()
  const { tableId } = useTableConfig()
  const { table } = useTableInstance<TData>()
  const columnLabels = useColumnLabels(tableId)
  const columnVisibility = useColumnVisibility(tableId)
  const columnOrder = useColumnOrder(tableId)
  const setColumnOrder = useSetColumnOrder(tableId)
  const setColumnVisibility = useSetColumnVisibility(tableId)

  // Get visible columns (ordered)
  const visibleColumns = useMemo(() => {
    // Get all hideable columns
    const allColumns = table
      .getAllColumns()
      .filter((col) => col.getCanHide() && col.id !== '_checkbox')

    // Filter to visible only
    const visible = allColumns.filter((col) => {
      const visibility = columnVisibility?.[col.id]
      return visibility !== false // undefined or true = visible
    })

    // Apply column order if exists
    if (!columnOrder || columnOrder.length === 0) {
      return visible // No order defined, use natural order
    }

    // Sort by columnOrder, append unordered columns at end
    const ordered = columnOrder
      .map((id) => visible.find((col) => col.id === id))
      .filter((col): col is NonNullable<typeof col> => col !== undefined)

    const unordered = visible.filter((col) => !columnOrder.includes(col.id))

    return [...ordered, ...unordered]
  }, [table, columnVisibility, columnOrder])

  // Detect which columns are paths (for field metadata lookup)
  const pathColumnIds = useMemo(() => {
    return visibleColumns
      .filter((col) => {
        const decoded = decodeColumnId(col.id)
        return decoded.type === 'path'
      })
      .map((col) => {
        const decoded = decodeColumnId(col.id)
        return decoded.type === 'path' ? decoded.fieldPath : []
      })
      .flat()
  }, [visibleColumns])

  // Get field metadata for all path fields (for breadcrumb labels)
  const pathFields = useFields(pathColumnIds)
  const pathFieldMap = useMemo(() => {
    const map = new Map<string, string>()
    pathColumnIds.forEach((rfId, index) => {
      if (pathFields[index]) {
        map.set(rfId, pathFields[index]!.label)
      }
    })
    return map
  }, [pathColumnIds, pathFields])

  // Handle column reorder
  const handleReorder = useCallback(
    (newOrder: string[]) => {
      setColumnOrder(newOrder)
    },
    [setColumnOrder]
  )

  // Handle remove column
  const handleRemoveColumn = useCallback(
    (columnId: string) => {
      setColumnVisibility({
        ...(columnVisibility ?? {}),
        [columnId]: false,
      })
    },
    [columnVisibility, setColumnVisibility]
  )

  // Get column name or breadcrumb segments
  const getColumnDisplay = useCallback(
    (
      column: Column<TData, unknown>
    ): { type: 'text'; label: string } | { type: 'breadcrumb'; segments: BreadcrumbSegment[] } => {
      // Custom label takes precedence
      const customLabel = columnLabels?.[column.id]
      if (customLabel) {
        return { type: 'text', label: customLabel }
      }

      // Check if it's a path column
      const decoded = decodeColumnId(column.id)
      if (decoded.type === 'path') {
        const segments: BreadcrumbSegment[] = decoded.fieldPath.map((rfId) => ({
          id: rfId,
          label: pathFieldMap.get(rfId) ?? rfId,
        }))
        return { type: 'breadcrumb', segments }
      }

      // Direct field - use header or fallback to id
      const header = column.columnDef.header
      if (typeof header === 'string') {
        return { type: 'text', label: header }
      }

      return { type: 'text', label: column.id }
    },
    [columnLabels, pathFieldMap]
  )
  console.log('column manager: ', columnLabels, pathFieldMap)
  return (
    <CommandList>
      {/* Visible Columns Group - Sortable */}
      <CommandGroup heading="Visible Columns">
        {visibleColumns.length === 0 ? (
          <div className="text-sm text-muted-foreground px-2 py-6 text-center">
            No visible columns
          </div>
        ) : (
          <CommandSortable items={visibleColumns.map((c) => c.id)} onReorder={handleReorder}>
            {visibleColumns.map((column) => {
              const display = getColumnDisplay(column)
              return (
                <CommandSortableItem key={column.id} id={column.id} className="py-0 pe-0.5">
                  <span className="truncate flex-1 flex items-center">
                    {display.type === 'breadcrumb' ? (
                      <SmartBreadcrumb
                        segments={display.segments}
                        mode="display"
                        size="sm"
                        className="flex-1 min-w-0"
                      />
                    ) : (
                      display.label
                    )}
                  </span>
                  <ColumnOptionsDropdown<TData>
                    column={column}
                    onRemove={() => handleRemoveColumn(column.id)}
                  />
                </CommandSortableItem>
              )
            })}
          </CommandSortable>
        )}
      </CommandGroup>

      <CommandSeparator />

      {/* Add Column Button */}
      <CommandGroup>
        <CommandNavigableItem
          item={{ id: 'add-column', label: 'Add column', type: 'add-column' }}
          hasChildren
          onSelect={() => push({ id: 'add-column', label: 'Add column', type: 'add-column' })}>
          <Plus />
          <span>Add column</span>
        </CommandNavigableItem>
      </CommandGroup>
    </CommandList>
  )
}

/**
 * Dropdown menu for column options in the column manager
 */
function ColumnOptionsDropdown<TData = any>({
  column,
  onRemove,
}: {
  column: Column<TData, unknown>
  onRemove: () => void
}) {
  const { tableId } = useTableConfig()
  const columnLabels = useColumnLabels(tableId)
  const columnFormatting = useColumnFormatting(tableId)
  const setColumnLabel = useSetColumnLabel(tableId)
  const setColumnFormatting = useSetColumnFormatting(tableId)

  const [showLabelDialog, setShowLabelDialog] = useState(false)
  const [showFormattingDialog, setShowFormattingDialog] = useState(false)

  const columnDef = column.columnDef as ExtendedColumnDef<TData>

  // Get column label
  const originalLabel = typeof columnDef.header === 'string' ? columnDef.header : column.id
  const currentLabel = columnLabels[column.id] ?? originalLabel

  // Check if this column supports formatting
  const fieldType = columnDef.fieldType
  const isFormattable =
    fieldType && (FORMATTABLE_FIELD_TYPES as readonly string[]).includes(fieldType)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 size-6.5 flex items-center justify-center rounded-md hover:bg-accent transition-colors">
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-[180px]">
          <DropdownMenuItem onClick={onRemove}>
            <EyeOff />
            Hide this column
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => setShowLabelDialog(true)}>
            <Pencil />
            Edit column label
          </DropdownMenuItem>

          {isFormattable && (
            <DropdownMenuItem onClick={() => setShowFormattingDialog(true)}>
              <Settings2 />
              Format column
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditColumnLabelDialog
        open={showLabelDialog}
        onOpenChange={setShowLabelDialog}
        columnId={column.id}
        originalLabel={originalLabel}
        currentLabel={currentLabel}
        onSave={(label) => setColumnLabel(column.id, label)}
      />

      {isFormattable && (
        <EditColumnFormattingDialog
          open={showFormattingDialog}
          onOpenChange={setShowFormattingDialog}
          columnId={column.id}
          columnLabel={currentLabel}
          fieldType={fieldType as FormattableFieldType}
          currentFormatting={columnFormatting[column.id]}
          defaultFormatting={columnDef.defaultFormatting}
          onSave={(formatting) =>
            setColumnFormatting({ ...columnFormatting, [column.id]: formatting })
          }
        />
      )}
    </>
  )
}

/**
 * AddColumnStack - Shows available fields to add as columns.
 * Uses ResourcePickerInnerContent with external navigation to avoid nested breadcrumbs.
 */
function AddColumnStack({ onCreateField }: { onCreateField: () => void }) {
  const { tableId, entityDefinitionId } = useTableConfig()
  const columnVisibility = useColumnVisibility(tableId)
  const columnOrder = useColumnOrder(tableId)
  const setColumnVisibility = useSetColumnVisibility(tableId)
  const setColumnOrder = useSetColumnOrder(tableId)
  const { stack, current, push, pop } = useCommandNavigation<ColumnNavigationItem>()

  // Get visible column IDs to exclude from picker
  const visibleColumnIds = useMemo(() => {
    if (!columnVisibility) return []
    return Object.entries(columnVisibility)
      .filter(([_, visible]) => visible !== false)
      .map(([id]) => id)
  }, [columnVisibility])

  // Handle field selection - add as column
  const handleSelectField = useCallback(
    (fieldReference: FieldReference) => {
      // Encode the field reference as a column ID
      // For paths: "product:vendor::vendor:name"
      // For direct fields: "contact:email"
      const columnId: string = isFieldPath(fieldReference)
        ? encodeFieldPathColumnId(fieldReference as FieldPath)
        : (fieldReference as string)

      console.log('Adding column with ID:', columnId, fieldReference)
      // Make column visible
      setColumnVisibility({
        ...(columnVisibility ?? {}),
        [columnId]: true,
      })

      // Add to column order if not already there
      if (!columnOrder?.includes(columnId)) {
        setColumnOrder([...(columnOrder ?? []), columnId])
      }

      // Go back to root stack
      pop()
    },
    [columnVisibility, columnOrder, setColumnVisibility, setColumnOrder, pop]
  )

  // Filter stack to only include ResourcePickerNavigationItem items (for relationship drill-down)
  const resourcePickerStack = useMemo(() => {
    return stack.filter((item): item is ResourcePickerNavigationItem => 'resourceFieldId' in item)
  }, [stack])

  // Get current item for resource picker (only if it's a relationship navigation item)
  const resourcePickerCurrent = useMemo((): ResourcePickerNavigationItem | null => {
    if (!current) return null
    if ('resourceFieldId' in current) return current as ResourcePickerNavigationItem
    return null
  }, [current])

  // External navigation adapter for ResourcePickerInnerContent
  const externalNavigation = useMemo(
    () => ({
      push: (item: ResourcePickerNavigationItem) => push(item),
      pop,
      stack: resourcePickerStack,
      current: resourcePickerCurrent,
      // "At root" for the resource picker means we're at "Add column" level
      // (no relationship has been drilled into yet)
      isAtRoot: resourcePickerStack.length === 0,
    }),
    [push, pop, resourcePickerStack, resourcePickerCurrent]
  )

  // Fallback if no entityDefinitionId (non-resource table)
  if (!entityDefinitionId) {
    return <LegacyAddColumnStack onCreateField={onCreateField} />
  }
  console.log('AddColumnStack render with visibleColumnIds:', visibleColumnIds)

  return (
    <ResourcePickerInnerContent
      entityDefinitionId={entityDefinitionId}
      excludeFields={visibleColumnIds}
      mode="single"
      closeOnSelect={false} // We handle navigation via pop()
      onSelect={handleSelectField}
      onCreateField={onCreateField}
      searchPlaceholder="Search fields..."
      externalNavigation={externalNavigation}
    />
  )
}

/**
 * LegacyAddColumnStack - Fallback for tables without entityDefinitionId.
 * Shows hidden columns from TanStack Table.
 */
function LegacyAddColumnStack<TData = any>({ onCreateField }: { onCreateField: () => void }) {
  const { tableId, entityDefinitionId } = useTableConfig()
  const { table } = useTableInstance<TData>()
  const columnLabels = useColumnLabels(tableId)
  const columnVisibility = useColumnVisibility(tableId)
  const columnOrder = useColumnOrder(tableId)
  const setColumnVisibility = useSetColumnVisibility(tableId)
  const setColumnOrder = useSetColumnOrder(tableId)
  const [search, setSearch] = useState('')

  // Get hidden columns
  const hiddenColumns = useMemo(() => {
    // Get all hideable columns
    const allColumns = table
      .getAllColumns()
      .filter((col) => col.getCanHide() && col.id !== '_checkbox')

    // Filter to hidden only
    return allColumns.filter((col) => {
      const visibility = columnVisibility?.[col.id]
      return visibility === false // Explicitly hidden
    })
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

      // Add to column order if not already there
      if (!columnOrder?.includes(columnId)) {
        setColumnOrder([...(columnOrder ?? []), columnId])
      }
    },
    [columnVisibility, columnOrder, setColumnVisibility, setColumnOrder]
  )

  return (
    <>
      <CommandInput
        placeholder="Search columns..."
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

/**
 * ColumnManagerContent - Router for navigation stacks
 */
function ColumnManagerContent<TData = any>({ onCreateField }: { onCreateField: () => void }) {
  const { current } = useCommandNavigation<ColumnNavigationItem>()

  // Check if we're in "add column" mode or drilling into a relationship
  const isInAddColumnMode =
    current?.type === 'add-column' || (current && 'resourceFieldId' in current)

  // Render based on navigation
  if (isInAddColumnMode) {
    return <AddColumnStack onCreateField={onCreateField} />
  }

  // Root stack
  return <RootStack<TData> />
}

/**
 * Column manager component for managing column visibility and order.
 */
export function ColumnManager<TData = any>() {
  const [isOpen, setIsOpen] = useState(false)
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false)
  const { tableId, entityDefinitionId } = useTableConfig()
  const currentView = useActiveView(tableId)
  const columnVisibility = useColumnVisibility(tableId)
  const columnOrder = useColumnOrder(tableId)
  const setColumnVisibility = useSetColumnVisibility(tableId)
  const setColumnOrder = useSetColumnOrder(tableId)

  // Custom field mutations hook (handles invalidation & toasts automatically)
  const { create: createField, isPending } = useCustomFieldMutations({ entityDefinitionId })

  // Handler for saving new field with auto-show behavior
  const handleSaveField = useCallback(
    async (fieldData: any) => {
      if (!entityDefinitionId) return

      try {
        // Create field (mutation hook handles invalidation and toasts)
        const newField = await createField.mutateAsync(fieldData)

        // AUTO-ADD: Automatically show new field in table
        if (newField?.id) {
          const fieldColumnId = toResourceFieldId(entityDefinitionId, toFieldId(newField.id))

          // Update visibility
          setColumnVisibility({
            ...(columnVisibility ?? {}),
            [fieldColumnId]: true, // Show the new field
          })

          // Add to column order if not already there
          if (!columnOrder?.includes(fieldColumnId)) {
            setColumnOrder([...(columnOrder ?? []), fieldColumnId])
          }
        }

        // Close dialog
        setIsFieldDialogOpen(false)
      } catch (error) {
        // Error toast already handled by useCustomFieldMutations
        // Keep dialog open for retry
        console.error('Failed to create field:', error)
      }
    },
    [
      createField,
      entityDefinitionId,
      columnVisibility,
      columnOrder,
      setColumnVisibility,
      setColumnOrder,
    ]
  )

  // Handler to open field dialog and close popover
  const handleCreateFieldClick = useCallback(() => {
    setIsOpen(false) // Close popover
    setIsFieldDialogOpen(true) // Open dialog
  }, [])

  // Note: Always enabled! Works in both saved view and session mode
  const tooltipContent = currentView ? `Edit columns (${currentView.name})` : 'Edit columns'

  return (
    <>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <div>
            <Tooltip content={tooltipContent}>
              <Button variant="ghost" size="sm">
                <Columns className="size-3" />
                <span className="hidden @lg/controls:block">Columns</span>
              </Button>
            </Tooltip>
          </div>
        </PopoverTrigger>

        <PopoverContent className="w-[280px] p-0" align="start">
          <CommandNavigation<ColumnNavigationItem>>
            <Command shouldFilter={false}>
              <CommandBreadcrumb rootLabel="Columns" />
              <ColumnManagerContent<TData> onCreateField={handleCreateFieldClick} />
            </Command>
          </CommandNavigation>
        </PopoverContent>
      </Popover>

      {/* Custom Field Dialog */}
      {isFieldDialogOpen && entityDefinitionId && (
        <CustomFieldDialog
          open={isFieldDialogOpen}
          onOpenChange={setIsFieldDialogOpen}
          onSave={handleSaveField}
          isPending={isPending}
          entityDefinitionId={entityDefinitionId}
          currentResourceId={entityDefinitionId}
        />
      )}
    </>
  )
}
