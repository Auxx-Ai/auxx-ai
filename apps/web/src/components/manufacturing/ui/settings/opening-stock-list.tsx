// apps/web/src/components/manufacturing/ui/settings/opening-stock-list.tsx
'use client'

// The left column of the Opening stock tab (money 52-parts-costing-page.md
// §2.3): one row for EVERY part, opened or not, so the list is a checklist
// rather than a table dump - the same call `tariff-classification-list.tsx`
// makes, and the property that makes the chip counts mean something (§4).
//
// The five chips ARE the checklist: Not opened is the work, Opened is what is
// done, Blocked is what cannot be done here at all, Unclassified is what is
// about to land in 1310 by default, and Cost override is who is not on their
// own standard. Per-kind chips appear underneath once kinds are set.
//
// 🛑 PAGED AT 50, and not for scroll performance. Every row mounts a
// `RecordBadge`, which asks the relationship store to hydrate its record, and
// the store batches those into ONE `record.getByIds` GET - 202 rows put 400 ids
// on the query string and the dev server answered **431 Request Header Fields
// Too Large** for every batch (`tariff-classification-list.tsx:52`, driven
// 2026-09-01). There are 495 parts here.
//
// 🛑 THE ACCOUNT COLUMN IS NOT A SECOND MAPPING. It reads `row.accountCode`
// with `row.accountLabel` in the tooltip, and the hook derives BOTH from the one
// resolver in `opening-stock-input.ts` -> `resolveInventoryRoleForPartKind`, the
// same function the write path uses. A kind-to-account table maintained here
// would drift, and the movement it disagreed with is `updatable: false`.

import { FieldType } from '@auxx/database/enums'
import { PartKind } from '@auxx/lib/resources/client'
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
import { Check, Package, Sparkles } from 'lucide-react'
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
  OPENING_STOCK_PAGE_SIZE,
  type OpeningStockCounts,
  type OpeningStockFilter,
  type OpeningStockKind,
  type OpeningStockRow,
  partKindLabel,
  toOpeningStockKind,
} from '../../hooks/use-opening-stock'

/**
 * Shared `grid-template-columns` for every opening-stock row (the
 * `mapping-columns.ts` / `LINE_COLS` idiom).
 *
 * 🛑 One template is what makes the list a table. The row used to put the kind,
 * the account and the badges in `secondary` with `secondaryFill`, so every
 * field's x position moved with the length of the part name above it and
 * nothing lined up down the list.
 *
 * Columns: part (fills, truncates) | kind | account | quantity | unit cost |
 * extended. The bounds are container-driven rather than content-driven, so
 * every row resolves to the same tracks, and the middle columns shrink toward a
 * floor on a narrow pane instead of pushing the row wider than the list.
 */
export const OPENING_STOCK_COLS =
  'minmax(8rem, 1fr) minmax(10rem, 12.25rem) 2.75rem minmax(4rem, 5rem) minmax(4.5rem, 5.5rem) minmax(4.5rem, 5.5rem)'

interface OpeningStockListProps {
  rows: OpeningStockRow[]
  counts: OpeningStockCounts
  /** kind -> row count, for the per-kind chips. */
  kindCounts: Map<string, number>
  isLoading: boolean
  currencyCode: string
  /** Bulk-select mode, from the page's `ListSelectionProvider` store. */
  bulkMode: boolean
  onBulkModeChange: (active: boolean) => void
  canSetKind: boolean
  isSettingKind: boolean
  onSetKind: (partIds: string[], kind: OpeningStockKind) => Promise<void>
  onQuantityChange: (partId: string, quantity: number | null) => void
  onUnitCostChange: (partId: string, unitCost: number | null) => void
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
        if (filter === 'not-opened' && row.state !== 'not-opened') return false
        if (filter === 'opened' && row.state !== 'opened') return false
        if (filter === 'blocked' && row.state !== 'blocked') return false
        if (filter === 'unclassified' && !row.isUnclassified) return false
        if (filter === 'cost-override' && !row.isCostOverride) return false
        if (filter.startsWith('kind:') && row.kind !== filter.slice('kind:'.length)) return false
        if (!query) return true
        return (
          row.title.toLowerCase().includes(query) || (row.sku ?? '').toLowerCase().includes(query)
        )
      }),
    [rows, filter, query]
  )

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit])

  /**
   * What the store is allowed to select: the rows on screen, in display order,
   * minus the locked ones.
   *
   * ⚠️ The paged, filtered set and not `rows` - `itemIds` is what Cmd+A and a
   * shift-range resolve against, so feeding it the whole 495 would select rows
   * the filter is hiding and count them in the ActionBar. `setItemIds` also
   * prunes the selection to what it is given, which is what makes a filter
   * change drop the rows it hid.
   */
  const selectableIds = useMemo(
    () => visible.filter((row) => row.state === 'not-opened').map((row) => row.partId),
    [visible]
  )
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
      {/* Search and the bulk toggle side by side, the `member-shared-section.tsx`
          shape. The wrapper bounds `InputSearch` (it is `relative flex-1`), not
          just its inner input, or the absolutely-positioned clear button pins to
          the full-width row's edge. The toggle is hidden without part edit
          access: the ActionBar's only action is the kind write. */}
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
        <FilterChip active={filter === 'not-opened'} onClick={() => changeFilter('not-opened')}>
          Not opened ({counts.notOpened})
        </FilterChip>
        <FilterChip active={filter === 'opened'} onClick={() => changeFilter('opened')}>
          Opened ({counts.opened})
        </FilterChip>
        <FilterChip active={filter === 'blocked'} onClick={() => changeFilter('blocked')}>
          Blocked ({counts.blocked})
        </FilterChip>
        <FilterChip active={filter === 'unclassified'} onClick={() => changeFilter('unclassified')}>
          Unclassified ({counts.unclassified})
        </FilterChip>
        <FilterChip
          active={filter === 'cost-override'}
          onClick={() => changeFilter('cost-override')}>
          Cost override ({counts.costOverride})
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
              : filter === 'not-opened'
                ? 'Every part has an opening balance'
                : 'No matches'
          }
          description={
            rows.length === 0 ? 'Create a part and it appears here to be opened.' : undefined
          }
        />
      ) : (
        // Header and rows share ONE bordered frame, the `line-builder.tsx`
        // shape, so the grid reads as a single table rather than 50 loose rows.
        <div className='rounded-lg border border-primary-200/50 dark:border-[#1e2227]'>
          {/*
            The header is the same `OPENING_STOCK_COLS` template and the same
            `gap-x-2` as the rows - never a second copy of either, which is how a
            header drifts off its columns. `On hand` rather than `Qty` because
            this is a count of what is physically on the shelf, and `Value`
            rather than `Total` because it is one part's opening inventory value,
            which is what the per-account totals sum.

            ⚠️ `top-[var(--settings-sticky-top,0px)]` and NOT `top-0`.
            `SettingsPage` pins its own title + tab strip at the viewport top
            with `z-20` and publishes that block's measured height as
            `--settings-sticky-top` (settings-page.tsx:138, re-measured on resize
            because the description wraps a line at narrow widths). A plain
            `top-0` pins this header underneath that block, where it is invisible
            for the whole scroll.
          */}
          <div
            className='sticky top-[var(--settings-sticky-top,0px)] z-10 grid gap-x-2 rounded-t-lg border-primary-200/50 border-b bg-primary-50 px-1 py-2 text-muted-foreground text-sm dark:border-[#1e2227] dark:bg-background'
            style={{ gridTemplateColumns: OPENING_STOCK_COLS }}>
            <div className='flex items-center gap-1 pl-2'>Part</div>
            <div className='px-2'>Kind</div>
            <div>Account</div>
            <div className='px-2 text-right'>On hand</div>
            <div className='px-2 text-right'>Unit cost</div>
            <div className='px-2 text-right'>Value</div>
          </div>

          {/* `py-1` and never `p-1`: `GridTreeRow` already carries its own `px-1`,
              and a second horizontal inset here would shift every row's flexible
              first column 4px off the header's. */}
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

/**
 * One part.
 *
 * ⚠️ `memo`, and the per-row selection hooks rather than a `selected` prop, are
 * one decision: a toggle re-renders THIS row instead of all 50. The list above
 * re-renders on every selection change (it reads the count for the ActionBar),
 * so without the memo every row would re-render with it - and each row mounts a
 * `RecordBadge` and three `FieldInputAdapter`s. Every prop below is stable
 * across such a render: `row` is memoized in the hook, and the three callbacks
 * are `useCallback`s.
 */
const OpeningStockRowLine = memo(function OpeningStockRowLine({
  row,
  currencyCode,
  canSetKind,
  isSettingKind,
  onWriteKind,
  onQuantityChange,
  onUnitCostChange,
}: {
  row: OpeningStockRow
  currencyCode: string
  canSetKind: boolean
  isSettingKind: boolean
  onWriteKind: (partIds: string[], kind: OpeningStockKind) => void
  onQuantityChange: (partId: string, quantity: number | null) => void
  onUnitCostChange: (partId: string, unitCost: number | null) => void
}) {
  const bulkMode = useBulkMode()
  const selected = useIsSelected(row.partId)
  const pending = useIsPending(row.partId)
  const pendingLabel = usePendingLabel()
  const toggle = useListSelection((s) => s.toggle)

  // An opened row is read-only forever: `stock_movement` is append-only and
  // `assertPartHasNoMovements` refuses a second opening, so the inputs would be
  // an affordance the run then declines (§4, §6.2).
  const locked = row.state !== 'not-opened'
  // A locked row is never selectable - the bulk action is the kind write, and a
  // kind set after the fact changes nothing the movement already froze.
  const selectable = canSetKind && !locked && !pending
  const selecting = bulkMode && selectable

  return (
    <GridTreeRow
      columns={OPENING_STOCK_COLS}
      // ⚠️ `gap-x-2` is what keeps the two bordered cells apart. The quantity
      // and unit-cost boxes each carry their own border, so flush columns read
      // as one merged control - and padding INSIDE a bordered box cannot fix
      // that, the space has to be between the borders. The header row carries
      // the same gap or every label sits one gap off its column.
      rowClassName={cn(
        'gap-x-2 rounded-md bg-primary-100/50 hover:bg-primary-100',
        (locked || pending) && 'opacity-60'
      )}
      // ⚠️ Row click selects, but ONLY in bulk mode. Outside it the first cell
      // is a `RecordBadge` that opens the part, and one gesture cannot both open
      // a record and select its row.
      onToggleOpen={selecting ? () => toggle(row.partId) : undefined}
      icon={
        selectable ? (
          // The checkbox affordance `TreeRow` gives for free: pinned while
          // selecting, hover- and focus-revealed otherwise, cross-faded with the
          // glyph. `GridTreeRow` carries no selection props, so it is built here
          // rather than by widening the shared primitive.
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
                // The handler sits on the box so it stays keyboard-reachable,
                // reads `shiftKey` for range select, and stops the bubble so a
                // click never also fires the row's own toggle.
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
        // 🛑 `min-w-0` stays load-bearing: `recordBadgeVariants`' base is a bare
        // `flex`, so without it the badge refuses to shrink below its content and
        // its inner truncate span never gets a bounded width. The explicit
        // `max-w` cap it used to need is gone - the first GRID column bounds the
        // cell now, which is the whole reason these rows moved off
        // `secondaryFill`.
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
          {/* ⚠️ `w-36`, measured rather than chosen: the trigger spends 28px on
              its chevron and padding, and the `Finished Good` chip needs 102px,
              so `w-32` (128px) clips it by ten. */}
          <span className='w-36 shrink-0'>
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
              disabled={!canSetKind || isSettingKind || locked}
            />
          </span>

          {/* The suggestion badge and its confirm sit together, both `h-5.5`, so
              the two chips read as one control on the kind rather than as two
              stray glyphs of different heights. */}
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

          {/* 🛑 The suggestion is OFFERED, never written. Until this is pressed
              the part still stores something else, the run holds the row out,
              and the account beside it is what the confirm WOULD produce. */}
          {row.kindIsUnconfirmed && canSetKind && !locked && (
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

        // 🛑 The NUMBER only, with the name in the tooltip - `1310 Raw Materials
        // / Parts` repeats on nearly every row. Both renderings come off the one
        // resolver in `opening-stock-input.ts`, so they cannot disagree about
        // which account this is.
        <Tooltip
          key='account'
          content={`${row.accountLabel}. The inventory account this opening balance will be stamped with, frozen on the movement, which is append-only.`}>
          <span className='cursor-default truncate text-xs tabular-nums'>
            {row.accountCode || row.accountLabel}
          </span>
        </Tooltip>,

        <EditableCell key='quantity' className='w-full'>
          <FieldInputAdapter
            fieldType={FieldType.NUMBER}
            value={row.quantity}
            onChange={(value) => onQuantityChange(row.partId, (value as number) ?? null)}
            placeholder='0'
            disabled={locked}
          />
        </EditableCell>,

        <EditableCell key='unit-cost' className='w-full'>
          <FieldInputAdapter
            fieldType={FieldType.CURRENCY}
            fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
            value={row.unitCost}
            onChange={(value) => onUnitCostChange(row.partId, (value as number) ?? null)}
            placeholder='0.00'
            disabled={locked}
          />
        </EditableCell>,

        <span
          key='extended'
          className='w-full pr-1 text-right text-foreground text-sm tabular-nums'>
          {row.extended > 0 ? formatCurrency(row.extended, { currencyCode }) : '-'}
        </span>,
      ]}
    />
  )
})

/**
 * The row's reading: §4's five states, minus the two the chips carry as filters
 * only. The `Suggested` sparkle is not here - it lives in the kind cell beside
 * its confirm, because it is the gate on that one field rather than a state of
 * the row.
 */
function RowBadges({ row }: { row: OpeningStockRow }) {
  return (
    <span className='flex shrink-0 items-center gap-1'>
      {row.state === 'opened' && (
        <Badge
          variant='green'
          size='xs'
          title='An opening balance is already on the ledger. A movement is append-only, so this row is read-only forever.'>
          Opened
        </Badge>
      )}
      {row.state === 'blocked' && (
        <Badge
          variant='destructive'
          size='xs'
          title='This part already has stock movements and none of them is an opening balance, so an opening would be a hand-valued adjustment wearing its name.'>
          Blocked
        </Badge>
      )}
      {row.state === 'not-opened' && row.isUnclassified && !row.kindIsUnconfirmed && (
        <Badge
          variant='outline'
          size='xs'
          title='Nobody has said what this part is, so it lands in Raw Materials by default.'>
          Unclassified
        </Badge>
      )}
      {row.isCostOverride && (
        <Badge
          variant='amber'
          size='xs'
          title="A cost the part's own standard disagrees with. The movement is still stamped cost basis standard, so the two will not match.">
          Cost override
        </Badge>
      )}
    </span>
  )
}

/**
 * The affordance that stops an editable cell reading as loose text: a bordered
 * 28px box with right-aligned tabular figures and a muted fill on hover/focus,
 * so the cell advertises that it can be typed into. `FieldInputAdapter` takes no
 * `className`, so everything below is pushed onto its own markup from here - the
 * same cell `receive-purchase-order-dialog.tsx` uses.
 *
 * ⚠️ THE CELL CARRIES THE BORDER, never the input. The field inside is
 * chromeless on purpose (`border-0 bg-transparent!` in `node-inputs`), and
 * `border-primary-200` is the same line the number stepper's own divider uses.
 * The input group's `min-h-8` has to be given up for it to sit in a 28px box.
 */
function EditableCell({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex h-7 shrink-0 items-center rounded-md border border-primary-200 ring-1 ring-transparent transition-colors focus-within:bg-muted/60 focus-within:ring-ring/30 hover:bg-muted/60',
        '[&_[data-slot=input-group]]:h-full [&_[data-slot=input-group]]:min-h-0',
        '[&_input]:tabular-nums [&_input]:text-right',
        // ⚠️ No increment arrows. Somebody typing 493 counts off a stock sheet
        // never presses one, and the pair costs 24px of a column that is now
        // fixed-width. `FieldInputAdapter` does not forward `NumberInput`'s
        // `stepper` prop, so they are hidden from here instead - matched as the
        // div that DIRECTLY owns the Increment button, because every wrapper
        // above it also contains that button and would hide the whole field.
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
