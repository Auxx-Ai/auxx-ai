// apps/web/src/components/purchasing/intake/ui/intake-line-row.tsx
'use client'

// One proposed purchase order line on the review screen (plans/money/tasks/38 §6.2).
//
// ✅ The row itself is `DraftLineRow` — the line builder's UNPERSISTED row. It
// takes a plain `DraftLine` values object with no record id and no store
// subscription, and routes every commit through `createDraft` /
// `applyPrefillPatch` / `deleteDraft` callbacks the parent supplies. `LineBuilder`
// points those at `record.create`; this screen points them at the draft blob, so
// 🛑 NOTHING on this screen persists an `EntityInstance`. That inherits the part
// picker, the qty/rate/total cells, unit and purchase-ratio handling, currency
// formatting and `LineGridRow`'s alignment for free.
//
// ⚠️ What does NOT fit is columns. `LINE_COLS` is four columns shared by all six
// documents, and widening it here widens it everywhere. So the review's extra
// data follows the convention `LineRowMenu` documents for exactly this — *"a
// concept the row does not always carry is revealed in the `⋯` menu, and only
// becomes a standing control in the cell once it is set"*:
//
//   - the tier marker rides the grip gutter (`DraftLineRow`'s `grip`);
//   - the vendor's printed line is a standing CHIP in the cell (`cellChips`),
//     beside the description and GL-account chips, opening a detail panel;
//   - create-part, revert-to-match and the two folds are items in the row's ONE
//     `⋯` (`cellMenuItems`), not a second menu;
//   - the printed detail and the price breaks share that one expandable panel.
//
// 🛑 The first cut got this wrong in the way the shared cell warns about. It drew
// its own `⋯` in the right gutter — so every row had TWO, one holding delete and
// one holding fold, with nothing on screen saying which was which — and hung the
// printed line under the row as a permanent second line, which is the
// *"the line never grows a permanent second row"* rule `LineNameCellView` states
// and `LinePartCellView` was itself rewritten to obey. At rest a row is now one
// line, like every other line surface in the app.

import { type IntakeLine, parseIntakeUnitPrice } from '@auxx/lib/purchasing/intake/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { RATE_DECIMALS } from '@auxx/utils/currency'
import { PackagePlus, Receipt, ReceiptText, Truck, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CatalogGroup } from '~/components/money/hooks/use-catalog-groups'
import type { CatalogItem } from '~/components/money/hooks/use-catalog-items'
import {
  applyPartPrefill,
  type DraftLine,
  DraftLineRow,
  type PartPrefillResolver,
} from '~/components/money/ui/line-builder/line-rows'
import { DEFAULT_LINE_VALUES, type LinePatch } from '~/components/money/ui/line-builder/line-values'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { IntakeCreatePartDialog } from './intake-create-part-dialog'
import { IntakeTierBadge, IntakeTierDot } from './intake-tier-badge'

/**
 * The intake line as the line builder sees it.
 *
 * `draftId` is the intake `lineId`, which is stable for the life of the draft —
 * that is what keeps a row's identity through a re-render after a part pick.
 */
export function toDraftLine(line: IntakeLine): DraftLine {
  return {
    ...DEFAULT_LINE_VALUES,
    draftId: line.lineId,
    creating: false,
    description: line.description,
    qty: line.quantity,
    unitPriceCents: line.unitPriceCents,
    partRecordId: line.partRecordId,
    vendorPartRecordId: line.vendorPartRecordId,
    // `unit` is resolved from the picked part by `DraftLineRow` itself on a
    // purchase order; seeding it from the vendor's printed unit string would put
    // a value in a cell the part owns.
    unit: null,
  }
}

interface IntakeLineRowProps {
  line: IntakeLine
  rowIndex: number
  currency: string
  vendorName: string | null
  /** Seeds the create-part form's Supplier section. */
  vendorRecordId: RecordId | null
  resolvePartPrefill?: PartPrefillResolver
  expanded: boolean
  onToggleExpanded: () => void
  onPatch: (lineId: string, patch: LinePatch) => void
  onChooseBreak: (lineId: string, index: number | null) => void
  onFold: (lineId: string, into: 'shipping' | 'tax') => void
  onRemove: (lineId: string) => void
}

export function IntakeLineRow({
  line,
  rowIndex,
  currency,
  vendorName,
  vendorRecordId,
  resolvePartPrefill,
  expanded,
  onToggleExpanded,
  onPatch,
  onChooseBreak,
  onFold,
  onRemove,
}: IntakeLineRowProps) {
  const draft = useMemo(() => toDraftLine(line), [line])
  const unresolved = line.partRecordId === null
  const [createPartOpen, setCreatePartOpen] = useState(false)
  // Latched separately from `open` so the part form is not mounted on all forty
  // rows of a quote (it carries its own field lookups and mutations), while a
  // row that has opened it once keeps it mounted through its close animation.
  const [createPartMounted, setCreatePartMounted] = useState(false)

  // §5.2's third ending, offered only where it is one of the three. A row that
  // already carries a part is resolved, and a folded row is not a line at all —
  // minting a catalogue part for either is exactly the fiction §5.4 refuses.
  const canCreatePart = unresolved && line.foldedInto === null

  /**
   * What the ladder proposed, still intact.
   *
   * ✅ `candidates` and `tier` are written once by `resolveQuoteLines` and never
   * mutated by anything on this screen — picking, clearing and creating a part
   * all touch `partRecordId` alone. So "put back what the read found" needs no
   * undo stack and no snapshot: the proposal is still sitting on the line.
   */
  const proposed = line.candidates[0] ?? null
  const canRevert = unresolved && proposed !== null

  // Every callback is synchronous local state; the `Promise<void>` shape is what
  // `DraftLineRow` expects because its OTHER caller is doing a `record.create`.
  const createDraft = async (_draftId: string, overrides?: LinePatch) => {
    if (overrides) onPatch(line.lineId, overrides)
  }

  /**
   * Put back the part the read proposed.
   *
   * Routed through `applyPartPrefill` exactly as a manual pick is, so the
   * supplier link is re-resolved rather than restored from a stale copy — the
   * catalogue may have gained an entry for this pair since the quote was read
   * (creating a part from this very row does that).
   */
  const revertToProposed = () => {
    if (!proposed) return
    onPatch(line.lineId, { partRecordId: proposed.recordId })
    void applyPartPrefill({
      partRecordId: proposed.recordId,
      resolve: resolvePartPrefill,
      currentPriceRef: { current: line.unitPriceCents },
      apply: (patch) => onPatch(line.lineId, patch),
    })
  }

  return (
    <div
      className={cn('relative border-b last:border-b-0', unresolved && 'bg-amber-400/5')}
      data-intake-line={line.lineId}>
      <DraftLineRow
        draft={draft}
        rowIndex={rowIndex}
        autoFocus={false}
        categoryOptions={EMPTY_CATEGORIES}
        currencyCode={currency}
        documentType='purchase_order'
        catalogItems={EMPTY_ITEMS}
        catalogGroups={EMPTY_GROUPS}
        catalogItemMap={EMPTY_ITEM_MAP}
        catalogLoading={false}
        matchScopeRecordId={null}
        resolvePartPrefill={resolvePartPrefill}
        grip={<IntakeTierDot tier={line.tier} vendorName={vendorName} />}
        cellChips={
          <PrintedLineChip
            line={line}
            expanded={expanded}
            onToggle={onToggleExpanded}
            vendorName={vendorName}
          />
        }
        allowClearPart
        cellMenuItems={
          <>
            {/* The other half of the clear `X` on the picker. Clearing is only
                safe to offer because getting back is one click: `candidates` is
                what the ladder found and nothing on this screen overwrites it. */}
            {canRevert && (
              <>
                <DropdownMenuItem onSelect={revertToProposed}>
                  <Undo2 /> Use {proposed.displayName}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {/* §5.2: the ladder found nothing, and the part is genuinely one we
                do not stock yet. Creating it is a real catalogue write and the
                only write this screen makes before commit — see
                `IntakeCreatePartDialog`. */}
            {canCreatePart && (
              <>
                <DropdownMenuItem
                  onSelect={() => {
                    setCreatePartMounted(true)
                    setCreatePartOpen(true)
                  }}>
                  <PackagePlus /> Create part
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {/* §5.4: freight, surcharges and tooling have no part to satisfy
                `(purchaseOrder, part)` with, and minting a `part` called
                "Freight" to get past the constraint puts a fiction in the
                catalogue that then values movements forever. The amount moves to
                the header instead, so the totals confrontation keeps balancing. */}
            <DropdownMenuItem onSelect={() => onFold(line.lineId, 'shipping')}>
              <Truck /> Fold into shipping
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onFold(line.lineId, 'tax')}>
              <Receipt /> Fold into tax
            </DropdownMenuItem>
          </>
        }
        onRevealWeight={() => {}}
        // The menu's own "Delete line" lands here, which is why this row no
        // longer offers a "Drop this line" of its own — one delete, one place.
        deleteDraft={() => onRemove(line.lineId)}
        createDraft={createDraft}
        applyPrefillPatch={createDraft}
        onSelectGroup={() => {}}
      />

      {expanded && (
        <PrintedDetail
          line={line}
          currency={currency}
          vendorName={vendorName}
          onChooseBreak={(index) => onChooseBreak(line.lineId, index)}
        />
      )}

      {createPartMounted && (
        <IntakeCreatePartDialog
          line={line}
          vendorRecordId={vendorRecordId}
          open={createPartOpen}
          onOpenChange={setCreatePartOpen}
          resolvePartPrefill={resolvePartPrefill}
          onPatch={onPatch}
        />
      )}
    </div>
  )
}

/**
 * The vendor's printed line, as a standing chip.
 *
 * ⚠️ Every intake row has one, so unlike the description and GL-account chips it
 * is never absent — which is the point. This row exists to be checked against
 * what the vendor printed, and a control that disappeared on the rows that
 * matched cleanly would hide the comparison exactly where somebody wants to
 * confirm it quickly. The tooltip carries the whole printed line so the common
 * case costs a hover; the click opens the detail panel, which is the only place
 * price breaks can be chosen.
 */
function PrintedLineChip({
  line,
  expanded,
  onToggle,
  vendorName,
}: {
  line: IntakeLine
  expanded: boolean
  onToggle: () => void
  vendorName: string | null
}) {
  const breaks = line.printed.priceBreaks.length
  // One line, not several: `SimpleTooltip` renders `content` into a plain
  // `max-w-xs` div with no `whitespace-pre-line`, so a `\n` would collapse to a
  // space anyway. The separator is the same `·` the detail panel uses.
  const tooltip = [
    `As printed by ${vendorName ?? 'the vendor'}: ${printedSummary(line)}`,
    breaks > 0 ? `${breaks} quantity break${breaks === 1 ? '' : 's'}` : null,
    'Click to open',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <TreeRowButton
      persistent
      tabIndex={-1}
      tooltipText={tooltip}
      className={cn(expanded && 'bg-primary-200')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}>
      <ReceiptText />
    </TreeRowButton>
  )
}

/** `041A · "120V/60HZ,443#" · 10000 pcs @ $20.50 · 30 days` */
function printedSummary(line: IntakeLine): string {
  const qty = line.printed.quantity ?? line.quantity
  return [
    line.printed.vendorCode,
    line.printed.description ? `"${line.printed.description}"` : null,
    `${line.printed.unit ? `${qty} ${line.printed.unit}` : qty} @ ${line.printed.unitPriceText ?? '—'}`,
    line.printed.leadTime,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The expanded panel: what the vendor printed, and the breaks they printed with
 * it.
 *
 * The tier is said as a WORD here, not only as the grip dot's colour. §5.2:
 * `Vendor SKU` and `Our SKU` are both exact and must not read as two shades of
 * the same claim, so wherever there is room for the word it is used.
 */
function PrintedDetail({
  line,
  currency,
  vendorName,
  onChooseBreak,
}: {
  line: IntakeLine
  currency: string
  vendorName: string | null
  onChooseBreak: (index: number | null) => void
}) {
  return (
    <div className='mx-1 mb-2 flex flex-col gap-1.5 rounded-md border bg-muted/30 p-2 text-xs'>
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground'>
        <IntakeTierBadge tier={line.tier} vendorName={vendorName} />
        <span className='font-mono'>{line.printed.vendorCode ?? '—'}</span>
        {line.printed.description && <span>"{line.printed.description}"</span>}
        <span>
          {formatPrintedQuantity(line)} @ {line.printed.unitPriceText ?? '—'}
        </span>
        {line.printed.leadTime && <span>· {line.printed.leadTime}</span>}
      </div>

      {line.printed.priceBreaks.length > 0 && (
        <PriceBreakTable line={line} currency={currency} onChoose={onChooseBreak} />
      )}
    </div>
  )
}

/**
 * The vendor's printed quantity breaks.
 *
 * 🛑 Picking one rewrites the line's unit price and NOTHING else. A purchase
 * order line carries exactly one `expectedUnitPrice`; the breaks are carried as
 * data and shown so the choice is visible, rather than collapsed server-side to
 * whichever tier the model liked.
 */
function PriceBreakTable({
  line,
  currency,
  onChoose,
}: {
  line: IntakeLine
  currency: string
  onChoose: (index: number | null) => void
}) {
  const basePrice = parseIntakeUnitPrice(line.printed.unitPriceText, currency)
  const chosen = line.chosenBreakIndex

  return (
    <div className='overflow-hidden rounded-md border bg-background'>
      <BreakRow
        label='As printed'
        price={formatCurrency(basePrice, currency, RATE_DECIMALS)}
        selected={chosen === null}
        onSelect={() => onChoose(null)}
        disabled={basePrice === null}
      />
      {line.printed.priceBreaks.map((brk, index) => {
        const price = parseIntakeUnitPrice(brk.unitPriceText, currency)
        return (
          <BreakRow
            // Breaks have no id of their own; their index IS how `chosenBreakIndex`
            // addresses them, so it is the correct key here.
            key={`${brk.minQuantity}-${index}`}
            label={`${brk.minQuantity}+`}
            price={formatCurrency(price, currency, RATE_DECIMALS)}
            selected={chosen === index}
            onSelect={() => onChoose(index)}
            disabled={price === null}
          />
        )
      })}
    </div>
  )
}

function BreakRow({
  label,
  price,
  selected,
  onSelect,
  disabled,
}: {
  label: string
  price: string
  selected: boolean
  onSelect: () => void
  disabled: boolean
}) {
  return (
    <button
      type='button'
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex w-full items-center justify-between px-3 py-1.5 text-left disabled:opacity-50',
        selected ? 'bg-primary-200 font-medium text-foreground' : 'hover:bg-muted/50'
      )}>
      <span>{label}</span>
      <span className='tabular-nums'>{price}</span>
    </button>
  )
}

function formatPrintedQuantity(line: IntakeLine): string {
  const qty = line.printed.quantity ?? line.quantity
  return line.printed.unit ? `${qty} ${line.printed.unit}` : String(qty)
}

/**
 * Stable empties.
 *
 * A purchase order line's leading cell is the PART PICKER (`capabilities.partPicker`),
 * so `DraftLineRow` never reaches the catalog branch and these are never read.
 * They are module constants rather than inline literals because a fresh `[]` per
 * render would restart every memo downstream of them if that ever changed.
 */
const EMPTY_CATEGORIES: never[] = []
const EMPTY_ITEMS: CatalogItem[] = []
const EMPTY_GROUPS: CatalogGroup[] = []
const EMPTY_ITEM_MAP = new Map<string, CatalogItem>()
