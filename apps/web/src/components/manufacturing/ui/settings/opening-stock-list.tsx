// apps/web/src/components/manufacturing/ui/settings/opening-stock-list.tsx
'use client'

// The left column of the Set counts tab (money 52 §2.3; 111 D21): one row for EVERY part,
// counted or not, so the list is a checklist. Paged at 50 because every row mounts a
// `RecordBadge` (202 rows put 400 ids on one GET and the dev server answered 431).

import { FieldType } from '@auxx/database/enums'
import { PartKind } from '@auxx/lib/resources/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListBulkToggle } from '@auxx/ui/components/list-bulk-toggle'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { GridTreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { Check, Factory, Package, Sparkles } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { Tooltip } from '~/components/global/tooltip'
import {
  useBulkMode,
  useIsPending,
  useIsSelected,
  useListSelection,
  usePendingLabel,
} from '~/components/list-selection'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import {
  needsBackflushFirst,
  OPENING_STOCK_PAGE_SIZE,
  type OpeningStockCounts,
  type OpeningStockFilter,
  type OpeningStockKind,
  type OpeningStockRow,
  partKindLabel,
  rowOutcome,
  toOpeningStockKind,
} from '../../hooks/use-opening-stock'

/**
 * One `grid-template-columns` for the header and every row, so the list reads as a table.
 * Columns: part | kind | account | on hand | count | date | unit cost | delta.
 */
export const OPENING_STOCK_COLS =
  'minmax(8rem, 1fr) minmax(9rem, 10rem) 2.75rem minmax(3.5rem, 4rem) minmax(4rem, 5rem) minmax(7.5rem, 8.5rem) minmax(4.5rem, 5.5rem) minmax(5rem, 6rem)'

interface OpeningStockListProps {
  rows: OpeningStockRow[]
  counts: OpeningStockCounts
  kindCounts: Map<string, number>
  isLoading: boolean
  currencyCode: string
  bulkMode: boolean
  onBulkModeChange: (active: boolean) => void
  canSetKind: boolean
  isSettingKind: boolean
  onSetKind: (partIds: string[], kind: OpeningStockKind) => Promise<void>
  onQuantityChange: (partId: string, quantity: number | null) => void
  onUnitCostChange: (partId: string, unitCost: number | null) => void
  onDateChange: (partId: string, date: string | null) => void
  /** The Q25 banner's button: backflush this part's negative replay before counting it. */
  onBackflush: (row: OpeningStockRow) => void
}

export function OpeningStockList({
  rows,
  counts,
  kindCounts,
  isLoading,
  currencyCode,
  bulkMode,
  onBulkModeChange,
  canSetKind,
  isSettingKind,
  onSetKind,
  onQuantityChange,
  onUnitCostChange,
  onDateChange,
  onBackflush,
}: OpeningStockListProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<OpeningStockFilter>('all')
  const [limit, setLimit] = useState(OPENING_STOCK_PAGE_SIZE)
  const setItemIds = useListSelection((s) => s.setItemIds)

  const changeFilter = (next: OpeningStockFilter) => {
    setFilter(next)
    setLimit(OPENING_STOCK_PAGE_SIZE)
  }
  const changeSearch = (next: string) => {
    setSearch(next)
    setLimit(OPENING_STOCK_PAGE_SIZE)
  }

  const query = search.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (filter === 'not-counted' && row.state === 'counted') return false
        if (filter === 'counted' && row.state !== 'counted') return false
        if (filter === 'uncounted' && row.state !== 'uncounted') return false
        if (filter === 'unclassified' && !row.isUnclassified) return false
        if (filter === 'uncosted' && row.standardCost != null) return false
        if (filter.startsWith('kind:') && row.kind !== filter.slice('kind:'.length)) return false
        if (!query) return true
        return (
          row.title.toLowerCase().includes(query) || (row.sku ?? '').toLowerCase().includes(query)
        )
      }),
    [rows, filter, query]
  )

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit])

  // The paged, filtered set: what Cmd+A and a shift-range resolve against.
  const selectableIds = useMemo(() => visible.map((row) => row.partId), [visible])
  useEffect(() => setItemIds(selectableIds), [selectableIds, setItemIds])

  const writeKind = useCallback(
    (partIds: string[], kind: OpeningStockKind) => {
      onSetKind(partIds, kind).catch((error: unknown) => {
        toastError({
          title: 'Error setting the part kind',
          description: error instanceof Error ? error.message : 'Could not save the kind.',
        })
      })
    },
    [onSetKind]
  )

  return (
    <div className='flex flex-col gap-3 p-3'>
      <div className='flex items-center gap-2'>
        <div className='flex-1'>
          <InputSearch
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            placeholder='Search by part or SKU...'
          />
        </div>
        {canSetKind && (
          <ListBulkToggle
            active={bulkMode}
            onActiveChange={onBulkModeChange}
            className='shrink-0'
          />
        )}
      </div>

      <div className='flex flex-wrap items-center gap-1.5'>
        <FilterChip active={filter === 'all'} onClick={() => changeFilter('all')}>
          All ({counts.all})
        </FilterChip>
        <FilterChip active={filter === 'not-counted'} onClick={() => changeFilter('not-counted')}>
          Not counted ({counts.notCounted})
        </FilterChip>
        <FilterChip active={filter === 'counted'} onClick={() => changeFilter('counted')}>
          Counted ({counts.counted})
        </FilterChip>
        <FilterChip active={filter === 'uncounted'} onClick={() => changeFilter('uncounted')}>
          Sold, never counted ({counts.uncounted})
        </FilterChip>
        <FilterChip active={filter === 'unclassified'} onClick={() => changeFilter('unclassified')}>
          Unclassified ({counts.unclassified})
        </FilterChip>
        <FilterChip active={filter === 'uncosted'} onClick={() => changeFilter('uncosted')}>
          No standard cost ({counts.uncosted})
        </FilterChip>
        {[...kindCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([kind, count]) => (
            <FilterChip
              key={kind}
              active={filter === `kind:${kind}`}
              onClick={() => changeFilter(`kind:${kind}`)}>
              {partKindLabel(kind)} ({count})
            </FilterChip>
          ))}
      </div>

      {isLoading ? (
        <EmptySection loading />
      ) : filtered.length === 0 ? (
        <EmptySection
          icon={<Package className='size-5' />}
          title={
            rows.length === 0
              ? 'No parts'
              : filter === 'not-counted'
                ? 'Every part has been counted'
                : 'No matches'
          }
          description={
            rows.length === 0 ? 'Create a part and it appears here to be counted.' : undefined
          }
        />
      ) : (
        <div className='rounded-lg border border-primary-200/50 dark:border-[#1e2227]'>
          <div
            className='sticky top-0 z-10 grid gap-x-2 rounded-t-lg border-primary-200/50 border-b bg-primary-50 px-1 py-2 text-muted-foreground text-sm dark:border-[#1e2227] dark:bg-background'
            style={{ gridTemplateColumns: OPENING_STOCK_COLS }}>
            <div className='flex items-center gap-1 pl-2'>Part</div>
            <div className='px-2'>Kind</div>
            <div>Account</div>
            <Tooltip content='Net of every movement on the ledger to now.'>
              <div className='cursor-default px-2 text-right'>On hand</div>
            </Tooltip>
            <div className='px-2 text-right'>Count</div>
            <div className='px-2'>As of</div>
            <div className='px-2 text-right'>Unit cost</div>
            <Tooltip content='What the row writes: the count less what the ledger already reads. Against today; the run nets through the count day.'>
              <div className='cursor-default px-2 text-right'>Writes</div>
            </Tooltip>
          </div>

          <div className='flex flex-col gap-0.5 py-1'>
            {visible.map((row) => (
              <OpeningStockRowLine
                key={row.partId}
                row={row}
                currencyCode={currencyCode}
                canSetKind={canSetKind}
                isSettingKind={isSettingKind}
                onWriteKind={writeKind}
                onQuantityChange={onQuantityChange}
                onUnitCostChange={onUnitCostChange}
                onDateChange={onDateChange}
                onBackflush={onBackflush}
              />
            ))}
            {filtered.length > limit && (
              <Button
                variant='ghost'
                size='sm'
                className='mt-1 self-center'
                onClick={() => setLimit((current) => current + OPENING_STOCK_PAGE_SIZE)}>
                Show {Math.min(OPENING_STOCK_PAGE_SIZE, filtered.length - limit)} more of{' '}
                {filtered.length}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** `+3` / `−2` / `0`, or a dash while a side is unknown. */
export function formatDelta(delta: number | null): string {
  if (delta == null) return '–'
  if (delta > 0) return `+${formatNumber(delta)}`
  if (delta < 0) return `−${formatNumber(Math.abs(delta))}`
  return '0'
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}

/**
 * One part. `memo` plus per-row selection hooks so a toggle re-renders this row, not all 50;
 * every prop is stable across a parent render.
 */
const OpeningStockRowLine = memo(function OpeningStockRowLine({
  row,
  currencyCode,
  canSetKind,
  isSettingKind,
  onWriteKind,
  onQuantityChange,
  onUnitCostChange,
  onDateChange,
  onBackflush,
}: {
  row: OpeningStockRow
  currencyCode: string
  canSetKind: boolean
  isSettingKind: boolean
  onWriteKind: (partIds: string[], kind: OpeningStockKind) => void
  onQuantityChange: (partId: string, quantity: number | null) => void
  onUnitCostChange: (partId: string, unitCost: number | null) => void
  onDateChange: (partId: string, date: string | null) => void
  onBackflush: (row: OpeningStockRow) => void
}) {
  const bulkMode = useBulkMode()
  const selected = useIsSelected(row.partId)
  const pending = useIsPending(row.partId)
  const pendingLabel = usePendingLabel()
  const toggle = useListSelection((s) => s.toggle)

  const selectable = canSetKind && !pending
  const selecting = bulkMode && selectable
  const outcome = rowOutcome(row.state)
  const backflushFirst = needsBackflushFirst(row)

  return (
    <div className='flex flex-col'>
      <GridTreeRow
        columns={OPENING_STOCK_COLS}
        // `gap-x-2` keeps the bordered cells apart; the header carries the same gap.
        rowClassName={cn(
          'gap-x-2 rounded-md bg-primary-100/50 hover:bg-primary-100',
          pending && 'opacity-60'
        )}
        // Row click selects only in bulk mode; outside it the first cell opens the part.
        onToggleOpen={selecting ? () => toggle(row.partId) : undefined}
        icon={
          selectable ? (
            <span className='relative flex size-5 items-center justify-center'>
              <Package
                className={cn(
                  'size-4 text-muted-foreground transition-opacity',
                  selecting ? 'opacity-0' : 'group-hover/tree-row:opacity-0'
                )}
              />
              <span
                className={cn(
                  'absolute inset-0 flex items-center justify-center transition-opacity',
                  !selecting &&
                    'opacity-0 group-hover/tree-row:opacity-100 has-[:focus-visible]:opacity-100'
                )}>
                <Checkbox
                  checked={selected}
                  aria-label={row.title}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(row.partId, { shiftKey: e.shiftKey })
                  }}
                />
              </span>
            </span>
          ) : (
            <Package className='size-4 text-muted-foreground' />
          )
        }
        title={
          // `min-w-0` is load-bearing: the badge refuses to shrink without it.
          <span className='flex min-w-0 items-center gap-1.5'>
            {row.recordId ? (
              <RecordBadge recordId={row.recordId} showIcon={false} className='min-w-0' />
            ) : (
              <span className='min-w-0 truncate'>{row.title}</span>
            )}
            <RowBadges row={row} />
            {pending && (
              <span className='shrink-0 text-muted-foreground text-xs'>{pendingLabel}</span>
            )}
          </span>
        }
        cells={[
          <div key='kind' className='flex w-full min-w-0 items-center gap-1'>
            <span className='w-32 shrink-0'>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: PartKind.values }}
                triggerProps={{ className: 'ps-0 pe-1 w-full' }}
                value={row.kind}
                onChange={(value) => {
                  const next = toOpeningStockKind(value)
                  if (next) onWriteKind([row.partId], next)
                }}
                placeholder='Select a kind...'
                disabled={!canSetKind || isSettingKind}
              />
            </span>
            {row.kindIsUnconfirmed && (
              <Tooltip content='A suggested kind nobody has confirmed. It is never written for you.'>
                <Badge
                  variant='amber'
                  size='xs'
                  className='h-5.5 shrink-0 items-center justify-center px-1'>
                  <Sparkles />
                </Badge>
              </Tooltip>
            )}
            {row.kindIsUnconfirmed && canSetKind && (
              <Tooltip
                content={`Set to ${partKindLabel(row.kind)}. Until it is stored, this part is held out of the run.`}>
                <Button
                  variant='transparent'
                  className='h-5.5 w-5.5 rounded-[6px] px-1 text-green-600 dark:text-green-500! bg-green-400/40 hover:bg-green-400/60 dark:bg-green-900!'
                  disabled={isSettingKind}
                  onClick={() => {
                    const kind = toOpeningStockKind(row.kind)
                    if (kind) onWriteKind([row.partId], kind)
                  }}>
                  <Check />
                </Button>
              </Tooltip>
            )}
          </div>,

          <Tooltip
            key='account'
            content={`${row.accountLabel}. The inventory account the movement is stamped with, frozen on the row.`}>
            <span className='cursor-default truncate text-xs tabular-nums'>
              {row.accountCode || row.accountLabel}
            </span>
          </Tooltip>,

          <span
            key='on-hand'
            data-testid='on-hand'
            className='w-full pr-1 text-right text-muted-foreground text-xs tabular-nums'>
            {row.netToday == null ? '…' : formatNumber(row.netToday)}
          </span>,

          <EditableCell key='quantity' className='w-full'>
            <FieldInputAdapter
              fieldType={FieldType.NUMBER}
              value={row.quantity}
              onChange={(value) => onQuantityChange(row.partId, (value as number) ?? null)}
              placeholder='0'
            />
          </EditableCell>,

          <EditableCell
            key='date'
            className={cn('w-full', !row.hasOwnDate && 'text-muted-foreground')}>
            <FieldInputAdapter
              fieldType={FieldType.DATE}
              triggerProps={{ className: 'ps-1 pe-1 w-full text-xs' }}
              value={row.date}
              onChange={(value) =>
                onDateChange(row.partId, typeof value === 'string' ? value : null)
              }
            />
          </EditableCell>,

          row.standardCost != null ? (
            <Tooltip
              key='unit-cost'
              content="The part's standard cost. The row is valued at it; a count never re-prices a costed part.">
              <span className='w-full cursor-default pr-1 text-right text-muted-foreground text-xs tabular-nums'>
                {formatCurrency(row.standardCost, { currencyCode })}
              </span>
            </Tooltip>
          ) : (
            <EditableCell key='unit-cost' className='w-full'>
              <FieldInputAdapter
                fieldType={FieldType.CURRENCY}
                fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
                value={row.unitCost}
                onChange={(value) => onUnitCostChange(row.partId, (value as number) ?? null)}
                placeholder='later'
              />
            </EditableCell>
          ),

          <span
            key='delta'
            data-testid='delta'
            className='flex w-full flex-col items-end pr-1 text-right tabular-nums leading-tight'>
            <span className='text-foreground text-sm'>{formatDelta(row.delta)}</span>
            {row.quantity != null && (
              <span className='text-[11px] text-muted-foreground'>
                {outcome === 'first' ? 'first count' : 'adjusts'}
              </span>
            )}
          </span>,
        ]}
      />
      {backflushFirst && (
        <Alert variant='warning' className='mx-1 mt-0.5 flex items-center gap-2 px-3 py-1.5'>
          <Factory className='size-4' />
          <AlertDescription className='flex flex-1 flex-wrap items-center justify-between gap-2 text-xs'>
            <span>
              {formatNumber(row.unbuiltSales)} unbuilt {row.unbuiltSales === 1 ? 'sale' : 'sales'} —
              backflush them first, or this count will hide them.
            </span>
            <Button variant='outline' size='xs' onClick={() => onBackflush(row)}>
              Backflush past sales
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
})

/** The row's reading: counted before, sold before counted, or unclassified. */
function RowBadges({ row }: { row: OpeningStockRow }) {
  const delta = formatDelta(row.delta)
  return (
    <span className='flex shrink-0 items-center gap-1'>
      {row.state === 'counted' && (
        <Badge
          variant='green'
          size='xs'
          title={`Counted before · adjusts by ${row.delta == null ? 'the difference' : delta}. A further count writes an adjustment dated the count day.`}>
          Counted
        </Badge>
      )}
      {row.state === 'uncounted' && (
        <Badge
          variant='amber'
          size='xs'
          title='Movements exist and none is a count. A count anchors the part at its ledger start so the replay reads the count on the count day.'>
          Never counted
        </Badge>
      )}
      {row.state !== 'counted' && row.isUnclassified && !row.kindIsUnconfirmed && (
        <Badge
          variant='outline'
          size='xs'
          title='Nobody has said what this part is, so it lands in Raw Materials by default.'>
          Unclassified
        </Badge>
      )}
    </span>
  )
}

/**
 * A bordered 28px cell so an editable field reads as one. The cell carries the border,
 * never the input (it is chromeless on purpose); the number stepper's arrows are hidden.
 */
function EditableCell({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex h-7 shrink-0 items-center rounded-md border border-primary-200 ring-1 ring-transparent transition-colors focus-within:bg-muted/60 focus-within:ring-ring/30 hover:bg-muted/60',
        '[&_[data-slot=input-group]]:h-full [&_[data-slot=input-group]]:min-h-0',
        '[&_input]:tabular-nums [&_input]:text-right',
        '[&_div:has(>button[aria-label=Increment])]:hidden',
        className
      )}>
      {children}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button variant={active ? 'default' : 'outline'} size='xs' onClick={onClick}>
      {children}
    </Button>
  )
}
