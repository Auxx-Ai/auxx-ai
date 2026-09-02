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
// data goes around and inside the existing grid instead:
//
//   - the tier marker rides the grip gutter (`DraftLineRow`'s one new prop);
//   - the vendor's printed line is a muted sub-row directly beneath, indented to
//     sit under the part cell it is being compared to;
//   - price breaks expand as a full-width sub-row under that;
//   - the fold/drop menu sits in the right gutter, outside the grid.
//
// The printed line is a sub-row rather than a second line INSIDE the part cell
// because the part cell is `LinePartCellView`, in the shared money module, and
// the one shared-code change this screen is allowed to make was spent on the grip
// slot. Same reading position, one fewer edit to a file six documents share.

import { type IntakeLine, parseIntakeUnitPrice } from '@auxx/lib/purchasing/intake/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import { RATE_DECIMALS } from '@auxx/utils/currency'
import { ChevronDown, Ellipsis, PackagePlus, Receipt, Trash2, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CatalogGroup } from '~/components/money/hooks/use-catalog-groups'
import type { CatalogItem } from '~/components/money/hooks/use-catalog-items'
import {
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
  resolvePartPrefill,
  expanded,
  onToggleExpanded,
  onPatch,
  onChooseBreak,
  onFold,
  onRemove,
}: IntakeLineRowProps) {
  const draft = useMemo(() => toDraftLine(line), [line])
  const breaks = line.printed.priceBreaks
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

  // Every callback is synchronous local state; the `Promise<void>` shape is what
  // `DraftLineRow` expects because its OTHER caller is doing a `record.create`.
  const createDraft = async (_draftId: string, overrides?: LinePatch) => {
    if (overrides) onPatch(line.lineId, overrides)
  }

  return (
    <div
      className={cn('relative border-b last:border-b-0', unresolved && 'bg-amber-400/5')}
      data-intake-line={line.lineId}>
      <div className='relative pr-8'>
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
          onRevealWeight={() => {}}
          deleteDraft={() => onRemove(line.lineId)}
          createDraft={createDraft}
          applyPrefillPatch={createDraft}
          onSelectGroup={() => {}}
        />

        <div className='absolute top-1 right-0'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon-xs'>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-56'>
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
                  catalogue that then values movements forever. The amount moves
                  to the header instead, so the totals confrontation keeps
                  balancing. */}
              <DropdownMenuItem onSelect={() => onFold(line.lineId, 'shipping')}>
                <Truck /> Fold into shipping
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onFold(line.lineId, 'tax')}>
                <Receipt /> Fold into tax
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onSelect={() => onRemove(line.lineId)}>
                <Trash2 /> Drop this line
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* The vendor's line, as printed. Indented to sit under the part cell. */}
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-1.5 pl-1 text-muted-foreground text-xs'>
        <IntakeTierBadge tier={line.tier} vendorName={vendorName} />
        <span className='font-mono'>{line.printed.vendorCode ?? '—'}</span>
        {line.printed.description && <span className='truncate'>"{line.printed.description}"</span>}
        <span>
          {formatPrintedQuantity(line)} @ {line.printed.unitPriceText ?? '—'}
        </span>
        {line.printed.leadTime && <span>· {line.printed.leadTime}</span>}
        {breaks.length > 0 && (
          <button
            type='button'
            onClick={onToggleExpanded}
            className='inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground'>
            <ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} />
            {breaks.length} break{breaks.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {expanded && breaks.length > 0 && (
        <PriceBreakTable
          line={line}
          currency={currency}
          onChoose={(index) => onChooseBreak(line.lineId, index)}
        />
      )}

      {createPartMounted && (
        <IntakeCreatePartDialog
          line={line}
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
    <div className='mx-1 mb-2 overflow-hidden rounded-md border bg-muted/30 text-xs'>
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
        selected ? 'bg-primary-200 font-medium text-foreground' : 'hover:bg-background'
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
