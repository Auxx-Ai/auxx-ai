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

import { useTableContext } from '../../context/table-context'
import { useViewStore, useActiveViewConfig } from '../../stores/view-store'
import { Tooltip } from '~/components/global/tooltip'
import { EditColumnLabelDialog } from '../edit-column-label-dialog'
import { EditColumnFormattingDialog } from '../edit-column-formatting-dialog'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import type { Column } from '@tanstack/react-table'
import type { ExtendedColumnDef, ColumnFormatting, FormattableFieldType } from '../../types'
import { FORMATTABLE_FIELD_TYPES } from '../../types'
import { toResourceFieldId, toFieldId } from '@auxx/types/field'

/** Navigation item type for column manager */
interface ColumnNavigationItem extends NavigationItem {
  id: string
  label: string
  type: 'add-column'
}

/**
 * RootStack - Shows visible columns (sortable, removable)
 */
function RootStack<TData = any>() {
  const { push } = useCommandNavigation<ColumnNavigationItem>()
  const { currentView, table, columnLabels, tableId } = useTableContext<TData>()
  const updateViewConfig = useViewStore((state) => state.updateViewConfig)
  const updateSessionView = useViewStore((state) => state.updateSessionView)
  const viewConfig = useActiveViewConfig(tableId)

  // Get visible columns (ordered)
  const visibleColumns = useMemo(() => {
    // Get all hideable columns
    const allColumns = table
      .getAllColumns()
      .filter((col) => col.getCanHide() && col.id !== '_checkbox')

    // Filter to visible only
    const visible = allColumns.filter((col) => {
      const visibility = viewConfig?.columnVisibility?.[col.id]
      return visibility !== false // undefined or true = visible
    })

    // Apply column order if exists
    const columnOrder = viewConfig?.columnOrder ?? []
    if (columnOrder.length === 0) {
      return visible // No order defined, use natural order
    }

    // Sort by columnOrder, append unordered columns at end
    const ordered = columnOrder
      .map((id) => visible.find((col) => col.id === id))
      .filter((col): col is NonNullable<typeof col> => col !== undefined)

    const unordered = visible.filter((col) => !columnOrder.includes(col.id))

    return [...ordered, ...unordered]
  }, [table, viewConfig])

  // Handle column reorder
  const handleReorder = useCallback(
    (newOrder: string[]) => {
      if (currentView?.id) {
        // Saved view mode - update via view store
        updateViewConfig(currentView.id, { columnOrder: newOrder })
      } else {
        // Session mode - update session view
        updateSessionView(tableId, { columnOrder: newOrder })
      }
    },
    [currentView?.id, tableId, updateViewConfig, updateSessionView]
  )

  // Handle remove column
  const handleRemoveColumn = useCallback(
    (columnId: string) => {
      const currentVisibility = viewConfig?.columnVisibility ?? {}
      const changes = {
        columnVisibility: {
          ...currentVisibility,
          [columnId]: false,
        },
      }

      if (currentView?.id) {
        // Saved view mode
        updateViewConfig(currentView.id, changes)
      } else {
        // Session mode
        updateSessionView(tableId, changes)
      }
    },
    [currentView?.id, tableId, viewConfig?.columnVisibility, updateViewConfig, updateSessionView]
  )

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
            {visibleColumns.map((column) => (
              <CommandSortableItem key={column.id} id={column.id} className="py-0 pe-0.5">
                <span className="truncate flex-1 flex items-center">{getColumnName(column)}</span>
                <ColumnOptionsDropdown<TData>
                  column={column}
                  onRemove={() => handleRemoveColumn(column.id)}
                />
              </CommandSortableItem>
            ))}
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
  const { columnLabels, setColumnLabel, columnFormatting, setColumnFormatting } =
    useTableContext<TData>()
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
          onSave={(formatting) => setColumnFormatting(column.id, formatting)}
        />
      )}
    </>
  )
}

/**
 * AddColumnStack - Shows hidden columns (searchable, addable)
 */
function AddColumnStack<TData = any>({ onCreateField }: { onCreateField: () => void }) {
  const { currentView, table, columnLabels, tableId, entityDefinitionId } = useTableContext<TData>()
  const updateViewConfig = useViewStore((state) => state.updateViewConfig)
  const updateSessionView = useViewStore((state) => state.updateSessionView)
  const viewConfig = useActiveViewConfig(tableId)
  const [search, setSearch] = useState('')

  // Get hidden columns
  const hiddenColumns = useMemo(() => {
    // Get all hideable columns
    const allColumns = table
      .getAllColumns()
      .filter((col) => col.getCanHide() && col.id !== '_checkbox')

    // Filter to hidden only
    return allColumns.filter((col) => {
      const visibility = viewConfig?.columnVisibility?.[col.id]
      return visibility === false // Explicitly hidden
    })
  }, [table, viewConfig])

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
      const currentVisibility = viewConfig?.columnVisibility ?? {}
      const currentOrder = viewConfig?.columnOrder ?? []

      const changes = {
        columnVisibility: {
          ...currentVisibility,
          [columnId]: true,
        },
        columnOrder: currentOrder.includes(columnId) ? currentOrder : [...currentOrder, columnId], // Append to end
      }

      if (currentView?.id) {
        // Saved view mode
        updateViewConfig(currentView.id, changes)
      } else {
        // Session mode
        updateSessionView(tableId, changes)
      }
    },
    [currentView?.id, tableId, viewConfig, updateViewConfig, updateSessionView]
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

  // Render based on navigation
  if (current?.type === 'add-column') {
    return <AddColumnStack<TData> onCreateField={onCreateField} />
  }

  // Root stack
  return <RootStack<TData> />
}

/**
 * Column manager component for managing column visibility and order
 */
export function ColumnManager<TData = any>() {
  const [isOpen, setIsOpen] = useState(false)
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false)
  const { currentView, entityDefinitionId, tableId } = useTableContext<TData>()

  // View store hooks for auto-showing new field
  const updateViewConfig = useViewStore((state) => state.updateViewConfig)
  const updateSessionView = useViewStore((state) => state.updateSessionView)
  const viewConfig = useActiveViewConfig(tableId)

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
          const currentVisibility = viewConfig?.columnVisibility ?? {}
          const currentOrder = viewConfig?.columnOrder ?? []

          const changes = {
            columnVisibility: {
              ...currentVisibility,
              [fieldColumnId]: true, // Show the new field
            },
            columnOrder: currentOrder.includes(fieldColumnId)
              ? currentOrder
              : [...currentOrder, fieldColumnId], // Add to end
          }

          if (currentView?.id) {
            updateViewConfig(currentView.id, changes)
          } else {
            updateSessionView(tableId, changes)
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
      viewConfig,
      currentView,
      updateViewConfig,
      updateSessionView,
      tableId,
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
