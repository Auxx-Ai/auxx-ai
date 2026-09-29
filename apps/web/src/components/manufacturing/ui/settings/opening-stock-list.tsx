// apps/web/src/components/manufacturing/ui/settings/opening-stock-list.tsx
'use client'

// The count list of Stock setup step 3 (plans/mrp/17 §5.3): one row for EVERY part, counted or
// not. Paged at 50 because every row mounts a `RecordBadge` (400 ids on one GET answered 431).

import { FieldType } from '@auxx/database/enums'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import { GridTreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Package } from 'lucide-react'
import Link from 'next/link'
import { useQueryState } from 'nuqs'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
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
  type OpeningStockRow,
  onHandNote,
  parseOpeningStockFilter,
  rowOutcome,
} from '../../hooks/use-opening-stock'
import { stockSetupHref } from '../../stock-setup/stock-setup-href'
import { OpeningStockToolbar } from './opening-stock-toolbar'

/**
 * One `grid-template-columns` for the header and every row, so the list reads as a table.
 * Columns: part | on hand | count | change.
 */
export const OPENING_STOCK_COLS =
  'minmax(8rem, 1fr) minmax(4.5rem, 5.5rem) minmax(4rem, 5rem) minmax(5rem, 6rem)'

interface OpeningStockListProps {
  rows: OpeningStockRow[]
  counts: OpeningStockCounts
  isLoading: boolean
  /** Rows take a checkbox for the bulk bar. */
  canSelect: boolean
  onQuantityChange: (partId: string, quantity: number | null) => void
  /** Extra toolbar buttons, at the right end (e.g. reopening the save pane). */
  toolbarActions?: React.ReactNode
}

export function OpeningStockList({
  rows,
  counts,
  isLoading,
  canSelect,
  onQuantityChange,
  toolbarActions,
}: OpeningStockListProps) {
  const [search, setSearch] = useState('')
  // `?filter=` only seeds the list; changing it stays local.
  const [filterParam] = useQueryState('filter')
  const [filter, setFilter] = useState<OpeningStockFilter>(() =>
    parseOpeningStockFilter(filterParam)
  )
  const [limit, setLimit] = useState(OPENING_STOCK_PAGE_SIZE)
  const setItemIds = useListSelection((s) => s.setItemIds)
  const viewportRef = useRef<HTMLDivElement>(null)

  // A view change starts at the top instead of wherever the old list was scrolled to.
  const changeFilter = (next: OpeningStockFilter) => {
    setFilter(next)
    setLimit(OPENING_STOCK_PAGE_SIZE)
    viewportRef.current?.scrollTo({ top: 0 })
  }
  const changeSearch = (next: string) => {
    setSearch(next)
    setLimit(OPENING_STOCK_PAGE_SIZE)
    viewportRef.current?.scrollTo({ top: 0 })
  }

  const query = search.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (filter === 'not-counted' && row.state === 'counted') return false
        if (filter === 'counted' && row.state !== 'counted') return false
        if (filter === 'uncounted' && row.state !== 'uncounted') return false
        if (filter === 'unbuilt' && !needsBackflushFirst(row)) return false
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

  return (
    <>
      <div className='shrink-0'>
        <OpeningStockToolbar
          search={search}
          onSearchChange={changeSearch}
          filter={filter}
          onFilterChange={changeFilter}
          counts={counts}
          canSelect={canSelect}
          actions={toolbarActions}
        />
      </div>
      {/* `noFade`: the table header sticks inside this viewport. */}
      <ScrollArea
        viewportRef={viewportRef}
        className='min-h-0 flex-1'
        scrollbarClassName='w-1.5'
        noFade>
        <div className='flex flex-col gap-3 p-3 pb-16'>
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
                <Tooltip content='What Auxx has on record today, from every receipt, sale and build.'>
                  <div className='cursor-default px-2 text-right'>On hand</div>
                </Tooltip>
                <div className='px-2 text-right'>Count</div>
                <Tooltip content="How much the count changes what is on record. A part's first count sets its starting stock; a recount is a correction.">
                  <div className='cursor-default px-2 text-right'>Change</div>
                </Tooltip>
              </div>

              <div className='flex flex-col gap-0.5 py-1'>
                {visible.map((row) => (
                  <OpeningStockRowLine
                    key={row.partId}
                    row={row}
                    canSelect={canSelect}
                    onQuantityChange={onQuantityChange}
                  />
                ))}
                {/* Every row is already loaded; a "page" only mounts the next 50 rows. */}
                <InfiniteListTail
                  hasNextPage={filtered.length > limit}
                  isFetchingNextPage={false}
                  fetchNextPage={() => setLimit((current) => current + OPENING_STOCK_PAGE_SIZE)}
                  loadingLabel='Loading more parts...'
                />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </>
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
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

/** The ledger net, plus what it means for a never-counted part. */
function OnHandCell({ row }: { row: OpeningStockRow }) {
  const note = onHandNote(row)
  const value = (
    <span className='flex w-full cursor-default flex-col items-end pr-1 text-right tabular-nums leading-tight'>
      <span data-testid='on-hand' className='text-muted-foreground text-xs'>
        {row.netToday == null ? '…' : formatNumber(row.netToday)}
      </span>
      {note && (
        <span
          data-testid='on-hand-note'
          className='whitespace-nowrap text-[11px] text-muted-foreground'>
          {note === 'built' ? `${formatNumber(row.built)} built` : 'never received'}
        </span>
      )}
    </span>
  )
  if (!note) return value
  return (
    <Tooltip
      content={
        note === 'built'
          ? `${formatNumber(row.built)} built to cover sales. Count what is on the shelf.`
          : `At least ${formatNumber(-(row.netToday ?? 0))} used over the years that were never logged as received. Count what is on the shelf; we'll add that on top.`
      }>
      {value}
    </Tooltip>
  )
}

/**
 * One part. `memo` plus per-row selection hooks so a toggle re-renders this row, not all 50;
 * every prop is stable across a parent render.
 */
const OpeningStockRowLine = memo(function OpeningStockRowLine({
  row,
  canSelect,
  onQuantityChange,
}: {
  row: OpeningStockRow
  canSelect: boolean
  onQuantityChange: (partId: string, quantity: number | null) => void
}) {
  const bulkMode = useBulkMode()
  const selected = useIsSelected(row.partId)
  const pending = useIsPending(row.partId)
  const pendingLabel = usePendingLabel()
  const toggle = useListSelection((s) => s.toggle)

  const selectable = canSelect && !pending
  const selecting = bulkMode && selectable
  const outcome = rowOutcome(row.state)

  return (
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
            <RecordBadge
              recordId={row.recordId}
              variant='link'
              showIcon={false}
              className='min-w-0'
            />
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
        <OnHandCell key='on-hand' row={row} />,

        <EditableCell key='quantity' className='w-full'>
          <FieldInputAdapter
            fieldType={FieldType.NUMBER}
            value={row.quantity}
            onChange={(value) => onQuantityChange(row.partId, (value as number) ?? null)}
            placeholder='0'
          />
        </EditableCell>,

        <span
          key='delta'
          data-testid='delta'
          className='flex w-full flex-col items-end pr-1 text-right tabular-nums leading-tight'>
          <span className='text-foreground text-sm'>{formatDelta(row.delta)}</span>
          {row.quantity != null && (
            <span className='text-[11px] text-muted-foreground'>
              {outcome === 'first' ? 'first count' : 'recount'}
            </span>
          )}
        </span>,
      ]}
    />
  )
})

/** The row's reading: a kind step 1 still flags, counted before or not, and no cost yet. */
function RowBadges({ row }: { row: OpeningStockRow }) {
  const delta = formatDelta(row.delta)
  return (
    <span className='flex shrink-0 items-center gap-1'>
      {row.kindWarning && (
        <Tooltip
          content={`Kind not checked: ${row.kindWarning} A count is filed under the kind it has now. Click to check kinds.`}>
          <Link href={stockSetupHref('kinds')} data-testid='kind-warning' className='shrink-0'>
            <Badge variant='amber' size='xs' className='h-5 px-1'>
              <AlertTriangle />
            </Badge>
          </Link>
        </Tooltip>
      )}
      {row.state === 'counted' && (
        <Badge
          variant='green'
          size='xs'
          title={`Counted before. A recount is a correction of ${row.delta == null ? 'the difference' : delta} on the count day.`}>
          Counted
        </Badge>
      )}
      {row.state === 'uncounted' && (
        <Badge
          variant='amber'
          size='xs'
          title='Received, sold or used, but never counted. Its first count sets its starting stock.'>
          No count
        </Badge>
      )}
      {row.standardCost == null && (
        <Tooltip content='The count is saved now and valued once Set costs gives this part a cost.'>
          <Badge variant='outline' size='xs' className='cursor-default'>
            No cost
          </Badge>
        </Tooltip>
      )}
    </span>
  )
}

/**
 * A bordered 28px cell so an editable field reads as one. The cell carries the border,
 * never the input (it is chromeless on purpose); the number stepper's arrows are hidden.
 */
export function EditableCell({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
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
