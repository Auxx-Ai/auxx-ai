// apps/web/src/components/dynamic-table/components/header-cell.tsx

'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Filter,
  EyeOff,
  ArrowUpDown,
  Pin,
  PinOff,
  Pencil,
  Settings2,
  Plus,
} from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@auxx/ui/components/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import { getSortOptionsForFieldType, SORT_OPTIONS } from '../utils/constants'
import { useTableConfig } from '../context/table-config-context'
import { useViewMetadata } from '../context/view-metadata-context'
import { useDynamicTableStore } from '../stores/dynamic-table-store'
import {
  useTableFilters,
  useColumnLabels,
  useColumnFormatting,
  useColumnPinning,
} from '../stores/store-selectors'
import { useSetFilters } from '../stores/store-actions'
import { EditColumnLabelDialog } from './dialogs/edit-column-label-dialog'
import { EditColumnFormattingDialog } from './dialogs/edit-column-formatting-dialog'
import type { Header } from '@tanstack/react-table'
import type { ExtendedColumnDef, ColumnFormatting, FormattableFieldType } from '../types'
import { FORMATTABLE_FIELD_TYPES } from '../types'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { FieldType } from '@auxx/database/types'

interface HeaderCellProps<TData> {
  header: Header<TData, unknown>
  isDragging?: boolean
}

/**
 * Dropdown menu for header cell options (sorting, filtering, hiding)
 * Migrated to use split contexts and stores
 */
function HeaderCellOptionsDropdown<TData>({
  column,
  columnDef,
  isSorted,
  sortOptions,
  canSort,
  canFilter,
  canHide,
  filters,
  setFilters,
  headerContent,
  originalLabel,
  columnLabels,
  setColumnLabel,
  columnFormatting,
  setColumnFormatting,
  pinnedColumnId,
  setPinnedColumn,
}: {
  column: Header<TData, unknown>['column']
  columnDef: ExtendedColumnDef<TData>
  isSorted: false | 'asc' | 'desc'
  sortOptions: (typeof SORT_OPTIONS)[FieldType]
  canSort: boolean
  canFilter: boolean
  canHide: boolean
  filters: ConditionGroup[]
  setFilters: (filters: ConditionGroup[]) => void
  headerContent: string
  originalLabel: string
  columnLabels: Record<string, string>
  setColumnLabel: (columnId: string, label: string | null) => void
  columnFormatting: Record<string, ColumnFormatting>
  setColumnFormatting: (columnId: string, formatting: ColumnFormatting | null) => void
  pinnedColumnId: string | null
  setPinnedColumn: (columnId: string | null) => void
}) {
  const [showLabelDialog, setShowLabelDialog] = useState(false)
  const [showFormattingDialog, setShowFormattingDialog] = useState(false)

  const isPinned = pinnedColumnId === column.id
  const canPin = column.id !== '_checkbox' // Don't allow pinning special columns

  // Check if this column supports formatting
  const fieldType = columnDef.fieldType
  const isFormattable =
    fieldType && (FORMATTABLE_FIELD_TYPES as readonly string[]).includes(fieldType)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'flex-none inline-flex items-center justify-center rounded-md text-sm transition-colors font-medium disabled:pointer-events-none disabled:opacity-60 disabled:bg-primary-50 gap-2 relative bg-primary-100 dark:bg-background dark:text-sidebar-foreground hover:bg-primary-200 p-0 size-5'
          )}
          aria-label={`Sort options for ${headerContent}`}>
          <ChevronDown className="size-3 flex-none" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[180px]">
        {canSort && (
          <>
            {sortOptions!.map((option) => {
              const OptionIcon = option.icon
              const isActive = isSorted === option.value

              return (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => {
                    if (isActive) {
                      column.clearSorting()
                    } else {
                      column.toggleSorting(option.value === 'desc')
                    }
                  }}
                  className={cn(isActive && 'bg-accent')}>
                  <OptionIcon />
                  {option.label}
                </DropdownMenuItem>
              )
            })}

            {isSorted && (
              <DropdownMenuItem onClick={() => column.clearSorting()}>
                <ArrowUpDown />
                Clear sorting
              </DropdownMenuItem>
            )}
          </>
        )}

        {canSort && (canPin || canFilter || canHide) && <DropdownMenuSeparator />}

        {canPin && (
          <DropdownMenuItem
            onClick={() => {
              if (isPinned) {
                setPinnedColumn(null)
              } else {
                setPinnedColumn(column.id)
              }
            }}>
            {isPinned ? (
              <>
                <PinOff />
                Unpin column
              </>
            ) : (
              <>
                <Pin />
                Pin column
              </>
            )}
          </DropdownMenuItem>
        )}

        {canPin && (canFilter || canHide) && <DropdownMenuSeparator />}

        {canFilter && (
          <DropdownMenuItem
            onClick={() => {
              // Add a new filter group with a condition for this column
              const newGroup: ConditionGroup = {
                id: crypto.randomUUID(),
                logicalOperator: 'AND',
                conditions: [
                  {
                    id: crypto.randomUUID(),
                    fieldId: column.id,
                    operator: 'contains',
                    value: '',
                  },
                ],
              }
              setFilters([...filters, newGroup])
            }}>
            <Filter />
            Filter column
          </DropdownMenuItem>
        )}

        {canHide && (
          <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
            <EyeOff />
            Hide this column
          </DropdownMenuItem>
        )}

        {canHide && <DropdownMenuSeparator />}

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

      <EditColumnLabelDialog
        open={showLabelDialog}
        onOpenChange={setShowLabelDialog}
        columnId={column.id}
        originalLabel={originalLabel}
        currentLabel={columnLabels[column.id]}
        onSave={(label) => setColumnLabel(column.id, label)}
      />

      {isFormattable && (
        <EditColumnFormattingDialog
          open={showFormattingDialog}
          onOpenChange={setShowFormattingDialog}
          columnId={column.id}
          columnLabel={headerContent}
          fieldType={fieldType as FormattableFieldType}
          currentFormatting={columnFormatting[column.id]}
          defaultFormatting={columnDef.defaultFormatting}
          onSave={(formatting) => setColumnFormatting(column.id, formatting)}
        />
      )}
    </DropdownMenu>
  )
}

/**
 * Table header cell with sorting menu and column actions
 * Migrated to use split contexts and stores instead of monolithic TableContext
 */
export function HeaderCell<TData>({ header, isDragging = false }: HeaderCellProps<TData>) {
  const column = header.column
  const columnDef = header.column.columnDef as ExtendedColumnDef<TData>

  // ─── CONTEXTS & STORES ──────────────────────────────────────────────────────
  const { tableId } = useTableConfig<TData>()
  const { onAddNew, entityLabel } = useViewMetadata<TData>()

  // Use granular selectors instead of getMergedConfig
  const columnLabels = useColumnLabels(tableId)
  const columnFormatting = useColumnFormatting(tableId)
  const columnPinning = useColumnPinning(tableId)
  const pinnedColumnId = columnPinning?.left?.[0] ?? null

  // Get filters using granular selector
  const filters = useTableFilters(tableId)

  // Get action setters from store
  const updateViewConfig = useDynamicTableStore((state) => state.updateViewConfig)
  const updateSessionConfig = useDynamicTableStore((state) => state.updateSessionConfig)

  // ─── ACTIONS ────────────────────────────────────────────────────────────────
  const setFilters = useSetFilters(tableId)

  const setColumnLabel = useCallback(
    (columnId: string, label: string | null) => {
      // Get current labels from unified store (not from closure)
      const store = useDynamicTableStore.getState()
      const viewId = store.activeViewIds[tableId]
      const currentLabels = viewId
        ? (store.viewConfigs[viewId]?.columnLabels ?? {})
        : (store.sessionConfigs[tableId]?.columnLabels ?? {})

      const updates = label
        ? { columnLabels: { ...currentLabels, [columnId]: label } }
        : (() => {
            const { [columnId]: _, ...rest } = currentLabels
            return { columnLabels: rest }
          })()

      if (viewId) {
        updateViewConfig(viewId, updates)
      } else {
        updateSessionConfig(tableId, updates)
      }
    },
    [tableId, updateViewConfig, updateSessionConfig]
  )

  const setColumnFormatting = useCallback(
    (columnId: string, formatting: ColumnFormatting | null) => {
      // Get current formatting from unified store (not from closure)
      const store = useDynamicTableStore.getState()
      const viewId = store.activeViewIds[tableId]
      const currentFormatting = viewId
        ? (store.viewConfigs[viewId]?.columnFormatting ?? {})
        : (store.sessionConfigs[tableId]?.columnFormatting ?? {})

      const updates = formatting
        ? { columnFormatting: { ...currentFormatting, [columnId]: formatting } }
        : (() => {
            const { [columnId]: _, ...rest } = currentFormatting
            return { columnFormatting: rest }
          })()

      if (viewId) {
        updateViewConfig(viewId, updates)
      } else {
        updateSessionConfig(tableId, updates)
      }
    },
    [tableId, updateViewConfig, updateSessionConfig]
  )

  const setPinnedColumn = useCallback(
    (columnId: string | null) => {
      const store = useDynamicTableStore.getState()
      const viewId = store.activeViewIds[tableId]

      // When unpinning, clear all pinning
      if (columnId === null) {
        const updates = { columnPinning: undefined }
        if (viewId) {
          updateViewConfig(viewId, updates)
        } else {
          updateSessionConfig(tableId, updates)
        }
        return
      }

      // When pinning, include all columns up to and including the target column
      // This prevents the pinned column from jumping to the front
      const allColumnIds = header.headerGroup.headers.map((h) => h.column.id)
      const targetIndex = allColumnIds.findIndex((id) => id === columnId)
      if (targetIndex === -1) return

      const leftColumns = allColumnIds.slice(0, targetIndex + 1)
      const updates = { columnPinning: { left: leftColumns } }

      if (viewId) {
        updateViewConfig(viewId, updates)
      } else {
        updateSessionConfig(tableId, updates)
      }
    },
    [tableId, header.headerGroup.headers, updateViewConfig, updateSessionConfig]
  )

  // ─── DERIVED STATE ──────────────────────────────────────────────────────────
  const sortOptions = getSortOptionsForFieldType(columnDef.fieldType)
  const Icon = columnDef.icon

  // Get current sort state
  const isSorted = column.getIsSorted()
  const canSort = columnDef.enableSorting !== false && column.getCanSort()
  const canFilter = columnDef.enableFiltering !== false
  const canHide = column.getCanHide()

  // Get header content from column definition (custom label takes precedence)
  const originalLabel = typeof columnDef.header === 'string' ? columnDef.header : column.id
  const headerContent = columnLabels[column.id] ?? originalLabel

  // Show "New" button only for primary columns with onAddNew callback
  const isPrimaryColumn = columnDef.primaryCell === true
  const showNewButton = isPrimaryColumn && onAddNew

  return (
    <div
      className={cn(
        'font-medium text-xs flex flex-col text-zinc-600 select-none',
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      )}>
      {/* Sort menu (visible on hover) */}
      {(canSort || canFilter || canHide) && (
        <div className="pointer-events-auto absolute inset-y-0 right-1 z-20 flex items-start pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <HeaderCellOptionsDropdown
            column={column}
            columnDef={columnDef}
            isSorted={isSorted}
            sortOptions={sortOptions}
            canSort={canSort}
            canFilter={canFilter}
            canHide={canHide}
            filters={filters}
            setFilters={setFilters}
            headerContent={headerContent}
            originalLabel={originalLabel}
            columnLabels={columnLabels}
            setColumnLabel={setColumnLabel}
            columnFormatting={columnFormatting}
            setColumnFormatting={setColumnFormatting}
            pinnedColumnId={pinnedColumnId}
            setPinnedColumn={setPinnedColumn}
          />
        </div>
      )}
      <div className="font-medium text-xs pl-3 flex text-zinc-600 dark:text-sidebar-foreground select-none z-10">
        <div className="header-title w-full truncate flex items-center gap-1">
          {/* Column type icon */}
          {Icon && <Icon className="mr-1 inline-block size-3 text-zinc-400" />}

          {/* Column name */}
          <span className="font-medium text-xs">{headerContent}</span>

          {/* New button (only for primary column with onAddNew) */}
          {showNewButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-1 bg-primary-100 dark:bg-background hover:bg-primary-200 size-5 rounded-md"
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddNew()
                  }}
                  aria-label={`New ${entityLabel || ''}`}>
                  <Plus className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>New {entityLabel || ''}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
