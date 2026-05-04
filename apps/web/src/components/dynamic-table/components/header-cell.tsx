// apps/web/src/components/dynamic-table/components/header-cell.tsx

'use client'

import type { FieldType } from '@auxx/database/types'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { isAiEligible } from '@auxx/lib/custom-fields/client'
import { toRecordId } from '@auxx/lib/resources/client'
import type { AiOptions } from '@auxx/types/custom-field'
import {
  buildFieldValueKey,
  type FieldId,
  type FieldReference,
  parseResourceFieldId,
  type ResourceFieldId,
} from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { type BreadcrumbSegment, SmartBreadcrumb } from '@auxx/ui/components/smart-breadcrumb'
import { toastInfo } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils/generateId'
import type { Header, Row, Table } from '@tanstack/react-table'
import {
  ArrowUpDown,
  ChevronDown,
  EyeOff,
  Filter,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { Tooltip } from '~/components/global/tooltip'
import { SparkleIcon } from '~/components/kopilot/ui/sparkle-icon'
import { useRunAiBulkGenerate } from '~/components/resources/hooks/run-ai-bulk-generate'
import { useField, useFields } from '~/components/resources/hooks/use-field'
import { useFieldValueStore } from '~/components/resources/store/field-value-store'
import { useConfirm } from '~/hooks/use-confirm'
import { useTableConfig } from '../context/table-config-context'
import { useTableInstance } from '../context/table-instance-context'
import { useViewMetadata } from '../context/view-metadata-context'
import { getIconForFieldType } from '../custom-field-column-factory'
import {
  useSetColumnLabel,
  useSetFilters,
  useSetPinnedColumn,
  useSetSingleColumnFormatting,
} from '../stores/store-actions'
import {
  useColumnFormatting,
  useColumnLabels,
  useColumnPinning,
  useTableFilters,
} from '../stores/store-selectors'
import type { ColumnFormatting, ExtendedColumnDef, FormattableFieldType } from '../types'
import { FORMATTABLE_FIELD_TYPES } from '../types'
import { decodeColumnId } from '../utils/column-id'
import { getSortOptionsForFieldType, type SORT_OPTIONS } from '../utils/constants'
import { EditColumnFormattingDialog } from './dialogs/edit-column-formatting-dialog'
import { EditColumnLabelDialog } from './dialogs/edit-column-label-dialog'

interface HeaderCellProps<TData> {
  header: Header<TData, unknown>
  isDragging?: boolean
}

/**
 * A cell is "missing" when it has no value (undefined/null/empty string/empty
 * array) AND is not currently generating AND has no AI result marker. A
 * previous AI error counts as missing — retrying is the expected behavior.
 */
function isMissingCell(value: unknown, aiStatus: string | undefined): boolean {
  const isEmpty =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  return isEmpty && aiStatus !== 'generating' && aiStatus !== 'result'
}

/**
 * Enumerate rows in the currently loaded view that should be targeted by
 * "Fill missing" vs "Regenerate all". Reads the field-value store imperatively
 * — no subscription, since this runs inside a click handler.
 */
function collectAiTargetRowIds<TData>(
  rows: Row<TData>[],
  entityDefinitionId: string,
  fieldRef: FieldReference,
  mode: 'fill-missing' | 'regenerate-all'
): { rowIds: string[]; nonEmptyCount: number } {
  const { values, aiStates } = useFieldValueStore.getState()
  const rowIds: string[] = []
  let nonEmptyCount = 0

  for (const row of rows) {
    const recordId = toRecordId(entityDefinitionId, row.id)
    const key = buildFieldValueKey(recordId, fieldRef)
    const value = values[key]
    const status = aiStates[key]?.status

    // Skip rows that already have an in-flight AI job either way — the
    // server would dedupe but this saves a wasted quota attempt.
    if (status === 'generating') continue

    const isEmpty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)

    if (mode === 'fill-missing') {
      if (isMissingCell(value, status)) rowIds.push(row.id)
    } else {
      rowIds.push(row.id)
      if (!isEmpty) nonEmptyCount++
    }
  }

  return { rowIds, nonEmptyCount }
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
  effectiveFieldType,
  terminalDefaultFormatting,
  aiMenuEnabled,
  aiField,
  aiFieldRef,
  table,
  entityDefinitionId,
  editableField,
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
  effectiveFieldType: FieldType | undefined
  terminalDefaultFormatting: Record<string, unknown> | undefined
  aiMenuEnabled: boolean
  aiField: { id: FieldId; fieldType: FieldType } | null
  aiFieldRef: FieldReference | null
  table: Table<TData>
  entityDefinitionId: string | undefined
  editableField: ResourceFieldId | null
}) {
  const [showLabelDialog, setShowLabelDialog] = useState(false)
  const [showFormattingDialog, setShowFormattingDialog] = useState(false)
  const [showEditFieldDialog, setShowEditFieldDialog] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const runAiBulkGenerate = useRunAiBulkGenerate()

  // For path columns the editable field belongs to a different entity than
  // the table's. Derive the owning entityDefinitionId from the field id itself
  // so the destroy mutation invalidates the right scope.
  const editableFieldEntityDefinitionId = useMemo(
    () => (editableField ? parseResourceFieldId(editableField).entityDefinitionId : undefined),
    [editableField]
  )
  const { destroy: destroyField } = useCustomFieldMutations({
    entityDefinitionId: editableFieldEntityDefinitionId,
  })

  const handleDeleteField = useCallback(async () => {
    if (!editableField) return
    const ok = await confirm({
      title: `Delete "${headerContent}"?`,
      description:
        'This permanently removes the field and its values from every record. This action cannot be undone.',
      confirmText: 'Delete field',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    destroyField.mutate({ resourceFieldId: editableField })
  }, [editableField, confirm, headerContent, destroyField])

  const handleFillMissing = useCallback(() => {
    if (!aiMenuEnabled || !aiField || !aiFieldRef || !entityDefinitionId) return
    const rows = table.getRowModel().rows
    const { rowIds } = collectAiTargetRowIds(rows, entityDefinitionId, aiFieldRef, 'fill-missing')
    if (rowIds.length === 0) {
      toastInfo({ title: 'No empty cells in this view' })
      return
    }
    runAiBulkGenerate(rowIds, aiField, entityDefinitionId)
  }, [aiMenuEnabled, aiField, aiFieldRef, entityDefinitionId, table, runAiBulkGenerate])

  const handleRegenerateAll = useCallback(async () => {
    if (!aiMenuEnabled || !aiField || !aiFieldRef || !entityDefinitionId) return
    const rows = table.getRowModel().rows
    const { rowIds, nonEmptyCount } = collectAiTargetRowIds(
      rows,
      entityDefinitionId,
      aiFieldRef,
      'regenerate-all'
    )
    if (rowIds.length === 0) return

    if (nonEmptyCount > 0) {
      const ok = await confirm({
        title: `Regenerate ${rowIds.length} ${rowIds.length === 1 ? 'cell' : 'cells'}?`,
        description: `${nonEmptyCount} ${
          nonEmptyCount === 1 ? 'already has' : 'already have'
        } a value and will be overwritten.`,
        confirmText: 'Regenerate',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!ok) return
    }

    runAiBulkGenerate(rowIds, aiField, entityDefinitionId)
  }, [aiMenuEnabled, aiField, aiFieldRef, entityDefinitionId, table, runAiBulkGenerate, confirm])

  const isPinned = pinnedColumnId === column.id
  const canPin = column.id !== '_checkbox' // Don't allow pinning special columns

  // Check if this column supports formatting (uses effectiveFieldType for path columns)
  const isFormattable =
    effectiveFieldType &&
    (FORMATTABLE_FIELD_TYPES as readonly string[]).includes(effectiveFieldType)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className={cn(
            'flex-none inline-flex items-center justify-center rounded-md text-sm transition-colors font-medium disabled:pointer-events-none disabled:opacity-60 disabled:bg-primary-50 gap-2 relative bg-primary-100 dark:bg-background dark:text-sidebar-foreground hover:bg-primary-200 p-0 size-5'
          )}
          aria-label={`Sort options for ${headerContent}`}>
          <ChevronDown className='size-3 flex-none' />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align='start' className='w-[180px]'>
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
                id: generateId(),
                logicalOperator: 'AND',
                conditions: [
                  {
                    id: generateId(),
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

        {aiMenuEnabled && <DropdownMenuSeparator />}

        {aiMenuEnabled && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SparkleIcon />
              AI
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={handleFillMissing}>
                <SparkleIcon />
                Fill missing
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleRegenerateAll}>
                <RefreshCw />
                Regenerate all
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {(canHide || aiMenuEnabled) && <DropdownMenuSeparator />}

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

        {editableField && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowEditFieldDialog(true)}>
              <Wand2 />
              Edit field
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleDeleteField}
              variant='destructive'
              disabled={destroyField.isPending}>
              <Trash2 />
              Delete field
            </DropdownMenuItem>
          </>
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
          fieldType={effectiveFieldType as FormattableFieldType}
          currentFormatting={columnFormatting[column.id]}
          defaultFormatting={columnDef.defaultFormatting ?? terminalDefaultFormatting}
          onSave={(formatting) => setColumnFormatting(column.id, formatting)}
        />
      )}

      {editableField && (
        <CustomFieldDialog
          open={showEditFieldDialog}
          onOpenChange={setShowEditFieldDialog}
          resourceFieldId={editableField}
        />
      )}

      <ConfirmDialog />
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
  const { tableId, entityDefinitionId } = useTableConfig<TData>()
  const { onAddNew, entityLabel } = useViewMetadata<TData>()
  const { table } = useTableInstance<TData>()

  // Use granular selectors instead of getMergedConfig
  const columnLabels = useColumnLabels(tableId)
  const columnFormatting = useColumnFormatting(tableId)
  const columnPinning = useColumnPinning(tableId)
  const pinnedColumnId = columnPinning?.left?.[0] ?? null

  // Get filters using granular selector
  const filters = useTableFilters(tableId)

  // Get column IDs getter for pinning (stable reference via useCallback)
  const getAllColumnIds = useCallback(
    () => header.headerGroup.headers.map((h) => h.column.id),
    [header.headerGroup.headers]
  )

  // ─── FIELD PATH DETECTION ────────────────────────────────────────────────────
  // Decode column ID to check if it's a path
  const decoded = useMemo(() => decodeColumnId(column.id), [column.id])
  const isPathColumn = decoded.type === 'path'

  // For path columns, get all field definitions for breadcrumb
  const pathFields = useFields(isPathColumn ? decoded.fieldPath : [])

  // For direct fields, fetch field metadata (used for icon fallback + AI gate).
  const directFieldId = !isPathColumn ? decoded.resourceFieldId : undefined
  const directField = useField(directFieldId)

  // Build breadcrumb segments for path columns
  const breadcrumbSegments = useMemo((): BreadcrumbSegment[] => {
    if (!isPathColumn) return []

    return decoded.fieldPath.map((resourceFieldId, index) => ({
      id: resourceFieldId,
      label: pathFields[index]?.label ?? resourceFieldId,
    }))
  }, [isPathColumn, decoded, pathFields])

  // Extract terminal field metadata for path columns
  const terminalFieldMeta = useMemo(() => {
    if (!isPathColumn || pathFields.length === 0) return null
    const terminalField = pathFields[pathFields.length - 1]
    if (!terminalField) return null

    return {
      fieldType: terminalField.fieldType,
      defaultFormatting: terminalField.options, // Field options become default formatting
    }
  }, [isPathColumn, pathFields])

  // Effective fieldType: from columnDef or terminal field for paths
  const effectiveFieldType = columnDef.fieldType ?? terminalFieldMeta?.fieldType

  // ─── AI MENU GATE ─────────────────────────────────────────────────────────
  // Hide the AI submenu unless this is a direct, AI-enabled custom field.
  // Mirrors the overlay gate in custom-field-cell.tsx.
  const aiMenuEnabled =
    !isPathColumn &&
    directField?.id != null &&
    directField.fieldType != null &&
    isAiEligible(directField.fieldType) &&
    (directField.options as { ai?: AiOptions } | null | undefined)?.ai?.enabled === true

  const aiField = useMemo<{ id: FieldId; fieldType: FieldType } | null>(() => {
    if (!aiMenuEnabled || !directField?.id || !directField.fieldType) return null
    return { id: directField.id, fieldType: directField.fieldType }
  }, [aiMenuEnabled, directField?.id, directField?.fieldType])

  const aiFieldRef: FieldReference | null =
    aiMenuEnabled && !isPathColumn ? (decoded.resourceFieldId as ResourceFieldId) : null

  // ─── EDITABLE CUSTOM FIELD GATE ────────────────────────────────────────────
  // Show "Edit field" / "Delete field" only when the column maps to a non-system
  // custom field. For path columns, target the terminal field (which lives on
  // a different entity definition — the dialog auto-derives that from the
  // resourceFieldId itself).
  const editableField = useMemo<ResourceFieldId | null>(() => {
    if (isPathColumn) {
      const terminal = pathFields[pathFields.length - 1]
      if (!terminal || terminal.isSystem) return null
      return terminal.resourceFieldId
    }
    if (!directField || directField.isSystem) return null
    return directField.resourceFieldId
  }, [isPathColumn, pathFields, directField])

  // ─── ACTIONS (use centralized action hooks) ────────────────────────────────
  const setFilters = useSetFilters(tableId)
  const setColumnLabel = useSetColumnLabel(tableId)
  const setColumnFormatting = useSetSingleColumnFormatting(tableId)
  const setPinnedColumn = useSetPinnedColumn(tableId, getAllColumnIds)

  // ─── DERIVED STATE ──────────────────────────────────────────────────────────
  const sortOptions = getSortOptionsForFieldType(effectiveFieldType)

  // Get icon: prefer columnDef.icon, fallback to field's type for dynamic columns
  const Icon = useMemo(() => {
    if (columnDef.icon) return columnDef.icon
    // For path columns, derive icon from terminal field's fieldType
    if (isPathColumn && pathFields.length > 0) {
      const terminalField = pathFields[pathFields.length - 1]
      if (terminalField?.fieldType) {
        return getIconForFieldType(terminalField.fieldType)
      }
    }
    // For direct fields without icon, derive from field metadata
    if (directField?.fieldType) {
      return getIconForFieldType(directField.fieldType)
    }
    return undefined
  }, [columnDef.icon, isPathColumn, pathFields, directField])

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

  // Determine if we should show breadcrumb (path column without custom label)
  const showBreadcrumb = isPathColumn && !columnLabels[column.id] && breadcrumbSegments.length > 0

  return (
    <div
      className={cn(
        'font-medium text-xs flex flex-col text-zinc-600 select-none',
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      )}>
      {/* Sort menu (visible on hover) */}
      {(canSort || canFilter || canHide) && (
        <div className='pointer-events-auto absolute inset-y-0 right-1 z-20 flex items-start pt-0.5 opacity-100 sm:opacity-0 transition-opacity sm:group-hover:opacity-100'>
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
            effectiveFieldType={effectiveFieldType}
            terminalDefaultFormatting={terminalFieldMeta?.defaultFormatting}
            aiMenuEnabled={aiMenuEnabled}
            aiField={aiField}
            aiFieldRef={aiFieldRef}
            table={table}
            entityDefinitionId={entityDefinitionId}
            editableField={editableField}
          />
        </div>
      )}
      <div className='font-medium text-xs pl-3 flex text-zinc-600 dark:text-sidebar-foreground select-none z-10'>
        <div className='header-title w-full truncate flex items-center gap-1'>
          {/* Column type icon */}
          {Icon && <Icon className='mr-1 inline-block size-3 text-zinc-400' />}

          {/* SmartBreadcrumb for paths, text for direct fields */}
          {showBreadcrumb ? (
            <Tooltip content={breadcrumbSegments.map((s) => s.label).join(' › ')} side='top'>
              <span className='flex-1 min-w-0 flex items-center'>
                <SmartBreadcrumb segments={breadcrumbSegments} mode='display' size='sm' />
              </span>
            </Tooltip>
          ) : (
            <span className='font-medium text-xs'>{headerContent}</span>
          )}

          {/* AI-enabled indicator */}
          {aiMenuEnabled && (
            <Tooltip content='AI autofill' side='top'>
              <Sparkles className='size-3.5 text-quartz fill-quartz *:nth-2:text-purple-400 *:nth-3:text-purple-400' />
            </Tooltip>
          )}

          {/* New button (only for primary column with onAddNew) */}
          {showNewButton && (
            <Tooltip content={`New ${entityLabel || ''}`} side='top'>
              <Button
                variant='ghost'
                size='icon-xs'
                className='ml-1 bg-primary-100 dark:bg-background hover:bg-primary-200 size-5 rounded-md'
                onClick={(e) => {
                  e.stopPropagation()
                  onAddNew()
                }}
                aria-label={`New ${entityLabel || ''}`}>
                <Plus className='size-3' />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
