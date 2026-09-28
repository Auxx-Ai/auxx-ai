// apps/web/src/components/dynamic-table/components/group-header-row.tsx
'use client'

import {
  getRelatedEntityDefinitionId,
  type RelationshipConfig,
  toRecordId,
} from '@auxx/lib/resources/client'
import {
  COLUMN_AGGREGATE_OPS,
  EMPTY_GROUP_KEY,
  formatGroupDateLabel,
  isAggregatableField,
  isDateGroupField,
} from '@auxx/lib/resources/grouping/client'
import { isActorId, toActorId } from '@auxx/types/actor'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { cn } from '@auxx/ui/lib/utils'
import type { Column, Table } from '@tanstack/react-table'
import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { useCallback } from 'react'
import { useField } from '~/components/resources/hooks/use-field'
import { useActorStore } from '~/components/resources/store/actor-store'
import { ActorBadge, RecordBadge } from '~/components/resources/ui'
import { TagsView } from '~/components/ui/tags-view'
import { useTableConfig } from '../context/table-config-context'
import { useSelectionStore } from '../stores/selection-store'
import { useColumnAggregates, useColumnFormatting } from '../stores/store-selectors'
import type {
  CheckboxColumnFormatting,
  ColumnAggregateOp,
  ExtendedColumnDef,
  GroupingProps,
  ResourceField,
} from '../types'
import { decodeColumnId } from '../utils/column-id'
import { GROUP_HEADER_HEIGHT } from '../utils/constants'
import { sanitizeColumnId } from '../utils/sanitize-column-id'
import { FormattedCell } from './formatted-cell'
import { SummarizeGhostButton } from './summarize-menu'

const GROUP_CELL = 'flex items-center h-full min-w-0'
const HEADER_CELL_BG = 'bg-primary-100 dark:bg-primary-50'

/** The column that carries the group label: the primary column, else the first data column. */
export function getGroupPrimaryColumnId<TData>(columns: Column<TData, unknown>[]): string | null {
  const primary = columns.find(
    (column) => (column.columnDef as ExtendedColumnDef<TData>).primaryCell === true
  )
  return (primary ?? columns.find((column) => column.id !== '_checkbox'))?.id ?? null
}

interface GroupRowFrameProps<TData> {
  table: Table<TData>
  virtualRow: VirtualItem
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>
  height: number
  className?: string
  /** Cell background; pinned cells need an opaque one to cover scrolled content. */
  cellClassName?: string
  renderCell: (column: Column<TData, unknown>, isPrimary: boolean) => React.ReactNode
}

/** Positions a non-data row and lays its cells out with the same widths and pinning as data rows. */
export function GroupRowFrame<TData>({
  table,
  virtualRow,
  rowVirtualizer,
  height,
  className,
  cellClassName,
  renderCell,
}: GroupRowFrameProps<TData>) {
  const columns = table.getVisibleLeafColumns()
  const primaryId = getGroupPrimaryColumnId(columns)
  const pinnedLeft = columns.filter((column) => column.getIsPinned() === 'left')
  const unpinned = columns.filter((column) => column.getIsPinned() !== 'left')

  const cell = (column: Column<TData, unknown>) => (
    <div
      key={column.id}
      data-col={sanitizeColumnId(column.id)}
      className={cn(
        GROUP_CELL,
        cellClassName,
        column.getIsPinned() === 'left' && 'sm:backdrop-blur-sm'
      )}>
      {renderCell(column, column.id === primaryId)}
    </div>
  )

  return (
    <div
      ref={rowVirtualizer.measureElement}
      data-index={virtualRow.index}
      className='absolute w-full'
      style={{ top: virtualRow.start, left: 0, right: 0, height }}>
      <div
        className={cn('flex w-full border-y border-background rounded-md', className)}
        style={{ height }}>
        {pinnedLeft.map((column) => (
          <div
            key={column.id}
            className='sm:sticky sm:z-19'
            style={{ left: column.getStart('left') }}>
            {cell(column)}
          </div>
        ))}
        {unpinned.map(cell)}
      </div>
    </div>
  )
}

/** ACTOR keys are raw ids (`COALESCE(actorId, relatedEntityId)`): a user, else a group. */
function RawActorLabel({ rawId }: { rawId: string }) {
  const userId = toActorId('user', rawId)
  const groupId = toActorId('group', rawId)
  const isGroup = useActorStore(
    (state) => state.actors.has(groupId) || state.notFoundIds.has(userId)
  )
  return <ActorBadge actorId={isGroup ? groupId : userId} />
}

/** Renders a group key the way cells render the same value. */
function GroupLabel({
  field,
  groupKey,
  granularity,
  checkboxFormatting,
}: {
  field: ResourceField
  groupKey: string | null
  granularity: GroupingProps['granularity']
  checkboxFormatting?: CheckboxColumnFormatting
}) {
  if (groupKey === null) {
    return <span className='text-sm text-muted-foreground'>No value</span>
  }

  if (isDateGroupField(field)) {
    return (
      <span className='truncate text-sm font-medium'>
        {formatGroupDateLabel(groupKey, granularity ?? 'day')}
      </span>
    )
  }

  switch (field.fieldType) {
    case 'SINGLE_SELECT': {
      const options = (field.options as { options?: SelectOption[] } | undefined)?.options ?? []
      return <TagsView value={groupKey} options={options} />
    }
    case 'RELATIONSHIP': {
      if (groupKey.includes(':')) {
        return <RecordBadge recordId={groupKey as ReturnType<typeof toRecordId>} link />
      }
      const targetDefId = field.relationship
        ? getRelatedEntityDefinitionId(field.relationship as unknown as RelationshipConfig)
        : null
      if (!targetDefId) return <span className='truncate text-sm'>{groupKey}</span>
      return <RecordBadge recordId={toRecordId(targetDefId, groupKey)} link />
    }
    case 'ACTOR':
      return isActorId(groupKey) ? (
        <ActorBadge actorId={groupKey} />
      ) : (
        <RawActorLabel rawId={groupKey} />
      )
    case 'CHECKBOX': {
      const checked = groupKey === 'true' || groupKey === 't' || groupKey === '1'
      const fieldOptions = field.options as { trueLabel?: string; falseLabel?: string } | undefined
      const label = checked
        ? (checkboxFormatting?.trueLabel ?? fieldOptions?.trueLabel ?? 'Yes')
        : (checkboxFormatting?.falseLabel ?? fieldOptions?.falseLabel ?? 'No')
      return <span className='truncate text-sm font-medium'>{label}</span>
    }
    default:
      return <span className='truncate text-sm font-medium'>{groupKey}</span>
  }
}

/** One column's cell in a group header: the aggregate value, or a hover "Σ" when eligible. */
function GroupAggregateCell({
  tableId,
  columnId,
  op,
  value,
  hasSummary,
}: {
  tableId: string
  columnId: string
  op: ColumnAggregateOp | undefined
  value: number | null | undefined
  hasSummary: boolean
}) {
  const decoded = decodeColumnId(columnId)
  const field = useField(decoded.type === 'direct' ? decoded.resourceFieldId : null)
  if (!field || !isAggregatableField(field)) return null

  if (!op) {
    return (
      <SummarizeGhostButton
        tableId={tableId}
        columnId={columnId}
        className='ml-2 opacity-0 transition-opacity group-hover/groupheader:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100'
      />
    )
  }

  const short = COLUMN_AGGREGATE_OPS.find((candidate) => candidate.value === op)?.short
  return (
    <div className='flex w-full min-w-0 items-center'>
      <span className='shrink-0 pl-3 text-[10px] uppercase text-muted-foreground'>{short}</span>
      <div className='min-w-0 flex-1 text-sm [&_[data-expand]]:pl-1.5'>
        {hasSummary ? (
          <FormattedCell
            value={value ?? null}
            fieldType={field.effectiveFieldType}
            columnId={columnId}
            options={field.options}
          />
        ) : (
          <span className='pl-1.5 text-muted-foreground'>—</span>
        )}
      </div>
    </div>
  )
}

type GroupSelectState = 'all' | 'some' | 'none'

/** Selects the group's loaded rows; rows on unfetched pages are not reachable from here. */
function GroupSelectCheckbox<TData>({
  table,
  firstRowIndex,
  lastRowIndex,
  isOpenTail,
  disabled,
}: {
  table: Table<TData>
  firstRowIndex: number
  lastRowIndex: number
  isOpenTail: boolean
  disabled: boolean
}) {
  const { tableId } = useTableConfig<TData>()
  const rowIds =
    firstRowIndex === -1
      ? []
      : table
          .getRowModel()
          .rows.slice(firstRowIndex, lastRowIndex + 1)
          .map((row) => row.id)

  const state = useSelectionStore((store): GroupSelectState => {
    const selection = store.tables[tableId]?.rowSelection
    if (!selection || rowIds.length === 0) return 'none'
    const selected = rowIds.filter((id) => selection[id]).length
    if (selected === 0) return 'none'
    return selected === rowIds.length ? 'all' : 'some'
  })

  const onCheckedChange = (checked: boolean) => {
    table.setRowSelection((prev) => {
      const next = { ...prev }
      for (const id of rowIds) {
        if (checked) next[id] = true
        else delete next[id]
      }
      return next
    })
  }

  return (
    <div
      className='flex h-full items-center justify-end pr-2'
      style={{ width: 40 }}
      title={isOpenTail ? `Selects the ${rowIds.length} loaded rows` : undefined}>
      <Checkbox
        checked={state === 'all' || (state === 'some' && 'indeterminate')}
        onCheckedChange={(value) => onCheckedChange(!!value)}
        disabled={disabled || rowIds.length === 0}
        aria-label='Select group'
        className='w-4 h-4 text-accent-500 bg-primary-100 border-primary-300 hover:border-primary-400 rounded transition-colors focus:ring-accent-400 cursor-pointer focus:ring-2'
      />
    </div>
  )
}

interface GroupHeaderRowProps<TData> {
  table: Table<TData>
  groupKey: string | null
  /** Loaded row range of this group in the row model; -1 when none are loaded. */
  firstRowIndex: number
  lastRowIndex: number
  grouping: GroupingProps
  virtualRow: VirtualItem
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>
}

/** Header row above each group: collapse toggle, label, count and per-column aggregates. */
export function GroupHeaderRow<TData>({
  table,
  groupKey,
  firstRowIndex,
  lastRowIndex,
  grouping,
  virtualRow,
  rowVirtualizer,
}: GroupHeaderRowProps<TData>) {
  const { tableId, enableCheckbox } = useTableConfig<TData>()
  const columnFormatting = useColumnFormatting(tableId)
  const columnAggregates = useColumnAggregates(tableId)
  const { field, granularity, summary, collapsedKeys, onToggleCollapsed } = grouping

  const isCollapsed = collapsedKeys.has(groupKey ?? EMPTY_GROUP_KEY)
  const entry = summary?.get(groupKey)
  const groupColumnId = field.resourceFieldId ?? ''
  const groupFormatting = columnFormatting[groupColumnId]
  const checkboxFormatting = groupFormatting?.type === 'checkbox' ? groupFormatting : undefined

  const toggle = useCallback(() => onToggleCollapsed(groupKey), [onToggleCollapsed, groupKey])

  return (
    <GroupRowFrame
      table={table}
      virtualRow={virtualRow}
      rowVirtualizer={rowVirtualizer}
      height={GROUP_HEADER_HEIGHT}
      className='group/groupheader'
      cellClassName={HEADER_CELL_BG}
      renderCell={(column, isPrimary) => {
        if (isPrimary) {
          return (
            <div className='flex w-full min-w-0 items-center gap-1.5 pl-3 pr-2'>
              {/* p-px keeps badge rings (drawn outside the box) inside the truncating clip */}
              <div className='flex min-w-0 items-center overflow-hidden p-px'>
                <GroupLabel
                  field={field}
                  groupKey={groupKey}
                  granularity={granularity}
                  checkboxFormatting={checkboxFormatting}
                />
              </div>
              <span className='shrink-0 rounded-full bg-primary-200/70 px-1.5 text-xs tabular-nums text-muted-foreground'>
                {entry ? entry.count.toLocaleString() : '—'}
              </span>
              <Button
                variant='ghost'
                size='icon-xs'
                onClick={toggle}
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}>
                <ChevronRight className={cn('transition-transform', !isCollapsed && 'rotate-90')} />
              </Button>
            </div>
          )
        }
        if (column.id === '_checkbox') {
          if (!enableCheckbox) return null
          return (
            <GroupSelectCheckbox
              table={table}
              firstRowIndex={firstRowIndex}
              lastRowIndex={lastRowIndex}
              isOpenTail={
                !!grouping.hasMoreRows && lastRowIndex === table.getRowModel().rows.length - 1
              }
              disabled={isCollapsed}
            />
          )
        }
        return (
          <GroupAggregateCell
            tableId={tableId}
            columnId={column.id}
            op={columnAggregates[column.id]}
            value={entry?.aggregates[column.id]}
            hasSummary={!!entry}
          />
        )
      }}
    />
  )
}
