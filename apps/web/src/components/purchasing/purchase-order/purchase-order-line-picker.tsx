// apps/web/src/components/purchasing/purchase-order/purchase-order-line-picker.tsx
'use client'

// The scoped replacement for the relationship picker on a bill line's
// `purchaseOrderLine` field (plans/purchasing/02-handoff.md item 2).
//
// That field is the THREE-WAY MATCH KEY: `matchBill` reads the agreed price and
// the received quantity from whichever line is pointed at, and the post-commit
// re-SUM adds the billed quantity onto that line's `quantity_billed` roll-up.
// Pick the wrong line and both land on another vendor's order, silently — the
// price check can even come back clean, because the tolerance floor ($5.00 or
// 2%, whichever is larger) swallows a small per-unit difference whole.
//
// The generic `FieldInputAdapter` RELATIONSHIP branch cannot do this job, for
// two independent reasons:
//
//   1. It has no scope. `MultiRelationInput` calls `api.record.search`, whose
//      input schema takes `entityDefinitionId`/`query`/`limit` and nothing else,
//      so every purchase order line in the ORG is offered. `excludeIds` is not a
//      way out — it post-filters the 20 rows already returned.
//   2. A purchase order line has no name. There is no title field in
//      `purchase-order-line-fields.ts`; the part IS the line's identity, exactly
//      as `purchase-order-receiving-card.tsx` documents. A generic picker renders
//      `displayName` and cannot reach through to the part, so the list reads as a
//      wall of near-blank rows.
//
// Which is what makes the ordered/received/price detail on each row part of the
// fix rather than decoration: two lines for the same part are told apart by
// their numbers or not at all.
//
// The line set needs no query. `purchase_order_lines` is the PO's own inverse
// relationship, already on the read path the Receiving card uses, so scoping
// here is a matter of reading the order the bill points at.

import type { SelectOption } from '@auxx/types/custom-field'
import type { RecordId } from '@auxx/types/resource'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { formatCurrency } from '@auxx/utils/currency'
import { useCallback, useMemo, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { useRecords } from '~/components/resources'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { formatQuantity } from '../purchasing-summary-strip'
import { usePurchaseOrderLines } from './use-purchase-order-lines'

interface PickableLine {
  lineRecordId: RecordId
  label: string
  ordered: number
  received: number
  expectedUnitPrice: number
}

export interface PurchaseOrderLinePickerProps {
  /** The order whose lines are offered. Null ⇒ the bill has no PO; see below. */
  purchaseOrderRecordId: RecordId | null
  value: RecordId | null
  onChange: (next: RecordId | null) => void
  currencyCode: string
  disabled?: boolean
}

/**
 * Single-select picker over one purchase order's lines.
 *
 * With no `purchaseOrderRecordId` the picker is disabled rather than falling back
 * to an unscoped list: a bill with no order has nothing to match against, so every
 * line it could offer belongs to somebody else's order. Link the bill to its PO
 * first and the picker fills.
 */
export function PurchaseOrderLinePicker({
  purchaseOrderRecordId,
  value,
  onChange,
  currencyCode,
  disabled = false,
}: PurchaseOrderLinePickerProps) {
  const [open, setOpen] = useState(false)

  // Shared with "Add lines from order" on the bill — the picker offering a line
  // and the button creating one must read the same set, or a line billable by one
  // rule and not the other reads as a bug.
  const { lines: orderLines, isLoading: orderLinesLoading } =
    usePurchaseOrderLines(purchaseOrderRecordId)

  // The part carries the line's label, so its metadata is fetched in one batch
  // rather than a `useRecord` per row — the rows are options here, not components.
  const partRecordIds = useMemo(
    () =>
      orderLines
        .map((line) => line.partRecordId)
        .filter((partRecordId): partRecordId is RecordId => !!partRecordId),
    [orderLines]
  )
  const { recordsByKey, isLoading: partsLoading } = useRecords({
    recordIds: partRecordIds,
    enabled: partRecordIds.length > 0,
  })

  const lines: PickableLine[] = useMemo(
    () =>
      orderLines.map((line) => ({
        lineRecordId: line.lineRecordId,
        // Same precedence as the Receiving card: part, then the typed
        // description, then an admission that the line has no identity yet.
        label:
          (line.partRecordId && recordsByKey.get(line.partRecordId)?.displayName) ||
          line.description ||
          'Untitled line',
        ordered: line.ordered,
        received: line.received,
        expectedUnitPrice: line.expectedUnitPrice,
      })),
    [orderLines, recordsByKey]
  )

  const options: SelectOption[] = useMemo(
    () => lines.map((line) => ({ label: line.label, value: line.lineRecordId })),
    [lines]
  )

  const isLoading = orderLinesLoading || partsLoading
  const selectedLine = lines.find((line) => line.lineRecordId === value)
  // A stored value that is not among this order's lines is the exact corruption
  // the unscoped picker used to produce, so it must not render as an empty
  // trigger — that reads as "nothing picked" while the mis-match is still on the
  // row and still driving `matchBill`. Say what it is and leave Clear reachable.
  const isForeignLine = !!value && !selectedLine && !isLoading

  const handleChange = useCallback(
    (selected: string[]) => {
      onChange((selected[0] as RecordId | undefined) ?? null)
    },
    [onChange]
  )

  // A bill with no order is the one case where an empty picker is correct rather
  // than a symptom, so it says which of the two it is.
  const placeholder = purchaseOrderRecordId
    ? 'Select purchase order line...'
    : 'Link the bill to a purchase order first'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          disabled={disabled || !purchaseOrderRecordId}
          variant='transparent'
          hasValue={!!selectedLine || isForeignLine}
          placeholder={placeholder}
          showClear={!!selectedLine || isForeignLine}
          onClear={(e) => {
            e.stopPropagation()
            onChange(null)
          }}
          asCombobox
          className='h-auto min-h-8 w-full ps-0 pe-1'>
          {selectedLine && (
            <span className='flex flex-1 items-center gap-1.5 py-0.5 text-sm'>
              <span className='truncate'>{selectedLine.label}</span>
              <LineDetail line={selectedLine} currencyCode={currencyCode} />
            </span>
          )}
          {isForeignLine && (
            <span className='flex-1 truncate py-0.5 text-destructive text-sm'>
              Line from another purchase order — clear it and pick again
            </span>
          )}
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent
        className='min-w-[max(var(--radix-popover-trigger-width),22rem)] p-0'
        align='start'>
        <MultiSelectPicker
          options={options}
          value={value ? [value] : []}
          onChange={handleChange}
          isLoading={isLoading}
          canManage={false}
          canAdd={false}
          multi={false}
          placeholder='Search lines...'
          onSelectSingle={() => setOpen(false)}
          disabled={disabled}
          renderItemAction={(option) => {
            const line = lines.find((candidate) => candidate.lineRecordId === option.value)
            return line ? <LineDetail line={line} currencyCode={currencyCode} /> : null
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The received/ordered and agreed-price pair — what actually distinguishes two
 * lines for the same part, and the two numbers the match will be run against.
 */
function LineDetail({ line, currencyCode }: { line: PickableLine; currencyCode: string }) {
  return (
    <span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
      {formatQuantity(line.received)}/{formatQuantity(line.ordered)}
      {' · '}
      {formatCurrency(line.expectedUnitPrice, { currencyCode })}
    </span>
  )
}
