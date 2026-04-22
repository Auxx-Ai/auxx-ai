// apps/web/src/components/dynamic-table/components/table-toolbar/column-manager.tsx

'use client'

import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandBreadcrumb,
  CommandDescription,
  CommandGroup,
  CommandList,
  CommandNavigableItem,
  CommandNavigation,
  CommandSeparator,
  CommandSortable,
  CommandSortableItem,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { type BreadcrumbSegment, SmartBreadcrumb } from '@auxx/ui/components/smart-breadcrumb'
import type { Column } from '@tanstack/react-table'
import { Columns, EyeOff, MoreHorizontal, Pencil, Plus, Settings2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { Tooltip } from '~/components/global/tooltip'
import { useFields } from '~/components/resources/hooks/use-field'
import { useTableConfig } from '../../context/table-config-context'
import { useTableInstance } from '../../context/table-instance-context'
import {
  useSetColumnFormatting,
  useSetColumnLabel,
  useSetColumnOrder,
  useSetColumnVisibility,
} from '../../stores/store-actions'
import {
  useActiveView,
  useColumnFormatting,
  useColumnLabels,
  useColumnOrder,
  useColumnVisibility,
} from '../../stores/store-selectors'
import type { ExtendedColumnDef, FormattableFieldType } from '../../types'
import { FORMATTABLE_FIELD_TYPES } from '../../types'
import { decodeColumnId } from '../../utils/column-id'
import { doesColumnFieldExist } from '../../utils/field-exists'
import { EditColumnFormattingDialog } from '../dialogs/edit-column-formatting-dialog'
import { EditColumnLabelDialog } from '../dialogs/edit-column-label-dialog'
import { AddColumnStack, type ColumnNavigationItem } from './add-column-stack'

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

    // Filter to visible only (uses TanStack state which includes defaultVisible merging)
    const visible = allColumns.filter((col) => col.getIsVisible())

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

  // Filter out ghost columns (fields that no longer exist)
  const validVisibleColumns = useMemo(() => {
    return visibleColumns.filter((col) => {
      // Keep non-field columns (like special columns without colon)
      if (!col.id.includes(':')) return true
      return doesColumnFieldExist(col.id)
    })
  }, [visibleColumns])

  // Detect which columns are paths (for field metadata lookup)
  const pathColumnIds = useMemo(() => {
    return validVisibleColumns
      .filter((col) => {
        const decoded = decodeColumnId(col.id)
        return decoded.type === 'path'
      })
      .flatMap((col) => {
        const decoded = decodeColumnId(col.id)
        return decoded.type === 'path' ? decoded.fieldPath : []
      })
  }, [validVisibleColumns])

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

  return (
    <CommandList>
      {/* Visible Columns Group - Sortable */}
      <CommandGroup heading='Visible Columns'>
        {validVisibleColumns.length === 0 ? (
          <CommandDescription>No visible columns</CommandDescription>
        ) : (
          <CommandSortable items={validVisibleColumns.map((c) => c.id)} onReorder={handleReorder}>
            {validVisibleColumns.map((column) => {
              const display = getColumnDisplay(column)

              return (
                <CommandSortableItem key={column.id} id={column.id} className='py-0 pe-0.5'>
                  <span className='truncate flex-1 flex items-center'>
                    {display.type === 'breadcrumb' ? (
                      <SmartBreadcrumb
                        segments={display.segments}
                        mode='display'
                        size='sm'
                        className='flex-1 min-w-0'
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
            type='button'
            onClick={(e) => e.stopPropagation()}
            className='shrink-0 size-6.5 flex items-center justify-center rounded-md hover:bg-accent transition-colors'>
            <MoreHorizontal className='size-3.5' />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align='end' className='w-[180px]'>
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
              <Button variant='ghost' size='sm'>
                <Columns className='size-3' />
                <span className='hidden @lg/controls:block'>Columns</span>
              </Button>
            </Tooltip>
          </div>
        </PopoverTrigger>

        <PopoverContent className='w-[280px] p-0' align='start'>
          <CommandNavigation<ColumnNavigationItem>>
            <Command shouldFilter={false}>
              <CommandBreadcrumb rootLabel='Columns' />
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
          entityDefinitionId={entityDefinitionId}
          onSuccess={(field) => {
            // Auto-add new field to visible columns
            const fieldColumnId = toResourceFieldId(entityDefinitionId, toFieldId(field.id))
            setColumnVisibility({
              ...(columnVisibility ?? {}),
              [fieldColumnId]: true,
            })
            if (!columnOrder?.includes(fieldColumnId)) {
              setColumnOrder([...(columnOrder ?? []), fieldColumnId])
            }
          }}
        />
      )}
    </>
  )
}
