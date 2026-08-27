// apps/web/src/components/purchasing/purchase-order/use-purchase-order-lines.ts
'use client'

// One purchase order's lines, with the two roll-ups that say what is still owed
// and what is still unbilled.
//
// Extracted from `purchase-order-line-picker.tsx` when a second caller appeared —
// "Add lines from the order" on the bill (plans/purchasing/02-handoff.md §4 item
// 3c). The two readings must agree: the picker offers a line and the button
// creates one, and a line that is billable by one rule and not the other is a
// contradiction the user sees as a bug. The Receiving card is the third caller,
// and folding it in here is what retired its own hand-rolled copy of this read.
//
// 🛑 Membership comes from `useRecordList`, NOT from the PO's
// `purchase_order_lines` inverse. Those are two lanes over the same rows and
// only one of them is live:
//
//   - the LIST lane (here) is the server's answer to a filtered query, kept
//     current by optimistic membership writes (`appendCreated` / `removeFromList`
//     on the acting tab) and by the `record:created` → `invalidateLists` frame
//     everywhere else;
//   - the INVERSE MIRROR lane reads a second copy of the relationship, written
//     on the PARENT by raw SQL in `field-values/relationship-sync.ts` — which
//     publishes nothing at all. A line added while a card is mounted never
//     reaches it, and `field-value-fetch-queue` skips any key already in the
//     store, so not even a remount repairs it: only a page reload does. That is
//     B-9/D-11 in `plans/events/`, an open defect, and it is why this hook used
//     to go stale.
//
// `LineBuilder` has been on the list lane since #1918 with the identical filter,
// so a PO drawer mixing the two showed its Lines card updating live and its
// Receiving card frozen — same rows, same drawer, two answers.
//
// The filter reuses `LINE_SCHEMAS`' own `relFieldId` rather than restating
// `'purchase_order_line:purchaseOrder'` here. That table is the single place a
// document's line wiring is declared, and its own warning says why: "three
// hand-copied copies is how the read prefix and the write prefix drift apart."

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { useEffect, useMemo } from 'react'
import {
  documentLineFilters,
  LINE_PAGE_SIZE,
  LINE_SORT,
  lineSchemaFor,
  numberOrNull,
} from '~/components/money/ui/line-builder/line-values'
import { type RecordId, toRecordId, useRecordList, useResource } from '~/components/resources'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { numberValue, unwrapValue } from '../purchasing-summary-strip'

const PO_LINE_SCHEMA = lineSchemaFor('purchase_order')

const LINE_ATTRS = [
  'purchase_order_line_part',
  'purchase_order_line_description',
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_quantity_received',
  'purchase_order_line_quantity_billed',
  'purchase_order_line_expected_unit_price',
  // Read for the receipt dialog's landed-cost allocation. Carried on the shared
  // row rather than fetched separately so the dialog and the cards resolve one
  // line set — the dialog BUILDS A WRITE from these rows, so a second read that
  // could disagree is worse here than anywhere else.
  //
  // ✅ Both had NO WRITER at all until
  // plans/purchasing/05-receiving-cost-and-corrections.md §5.2/§5.3: they were
  // declared in the registry, read here, and set by no surface anywhere. The line
  // builder writes them now — `vendorPart` from the price prefill on part pick,
  // `weight` from the row menu's document-level weight control.
  'purchase_order_line_vendor_part',
  'purchase_order_line_weight',
] as const

/** One purchase order line, as all three callers read it. */
export interface PurchaseOrderLineRow {
  lineRecordId: RecordId
  /** `null` on a line whose part was never set — legal on a draft, not on a create. */
  partRecordId: RecordId | null
  description: string | null
  ordered: number
  /** Roll-up: SUM over the stock movements pointing at this line. */
  received: number
  /** Roll-up: SUM over the vendor bill lines pointing at this line. */
  billed: number
  /** Integer minor units — the agreed price, and the price arm of the match. */
  expectedUnitPrice: number
  /**
   * The supplier catalogue entry this line's price was seeded from, or `null`.
   *
   * 🛑 PROVENANCE, not a price source. It is stamped once when the part is picked
   * and the agreed price lives in {@link expectedUnitPrice} from then on —
   * `vendor_part_unit_price` is `updatable: true`, so a caller that re-read the
   * price through this link would stop reporting the price the order froze
   * (plans/purchasing/05-receiving-cost-and-corrections.md §5.2).
   */
  vendorPartRecordId: RecordId | null
  /**
   * Shipping weight for the whole line — the `weight` allocation basis's only
   * input. `null` means nobody has recorded one.
   *
   * 🛑 `null`, never `0`, for an unrecorded weight. `numberValue` — which every
   * other number on this row uses — folds absence into `0`, and that is right for
   * a quantity or a price, where "none" and "zero" are the same fact. It is wrong
   * here: `allocateLandedCost` spreads freight by each line's share of the total
   * weight, so an unweighed line reported as `0` reads as a deliberate
   * weighs-nothing. `allocateCapitalisedCost` rejects that shape either way (it
   * treats zero as absent, for the same reason), but a caller that wants to WARN
   * before it gets there needs the distinction this read preserves (§5.3).
   */
  weight: number | null
}

/**
 * Read a purchase order's lines.
 *
 * `null` order ⇒ no fetch and no rows, which is the state a bill with no purchase
 * order is in. Callers must render that as "there is nothing to offer", never as
 * an empty list of candidates.
 */
export function usePurchaseOrderLines(purchaseOrderRecordId: RecordId | null): {
  lines: PurchaseOrderLineRow[]
  isLoading: boolean
} {
  const { resource } = useResource(PO_LINE_SCHEMA.slug)
  const entityDefinitionId = resource?.id

  // 🛑 Built by `documentLineFilters`, the same call the line builder makes, and
  // that sharing is load-bearing rather than tidy. `createListKey` hashes
  // `JSON.stringify(filters)`, so the condition ID STRINGS decide which
  // `lists[...]` entry this read subscribes to. An equivalent filter written by
  // hand here — same field, same operator, different ids — produces a DIFFERENT
  // key, and `appendCreatedRecord(key, id)` only ever patches the one key that
  // created the record while the acting tab is excluded from its own
  // `record:created` frame. The card would then be just as stale as it was on the
  // inverse mirror, for a completely different reason. Identical filters +
  // identical sorting + identical limit is what puts this card on the builder's
  // cache entry, which is the entry that gets the optimistic append.
  const filters = useMemo<ConditionGroup[]>(
    () => documentLineFilters(PO_LINE_SCHEMA, purchaseOrderRecordId ?? ''),
    [purchaseOrderRecordId]
  )

  const { recordIds, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useRecordList({
    entityDefinitionId: entityDefinitionId ?? '',
    filters,
    sorting: LINE_SORT,
    limit: LINE_PAGE_SIZE,
    enabled: !!entityDefinitionId && !!purchaseOrderRecordId,
  })

  // Load every page rather than the first. A silently truncated set here would
  // read as "the order has 100 lines" to the picker and to the receiving totals,
  // which is worse than slow — same reasoning (and same shape) as the builder's.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

  const lineRecordIds = useMemo(
    () => (entityDefinitionId ? recordIds.map((id) => toRecordId(entityDefinitionId, id)) : []),
    [entityDefinitionId, recordIds]
  )

  const { valuesById, isLoading: valuesLoading } = useSystemValuesForRecords(
    lineRecordIds,
    LINE_ATTRS,
    { autoFetch: true, enabled: lineRecordIds.length > 0 }
  )

  const lines = useMemo<PurchaseOrderLineRow[]>(
    () =>
      lineRecordIds.map((lineRecordId) => {
        const v = valuesById[lineRecordId] ?? ({} as Record<string, unknown>)
        const description = unwrapValue(v.purchase_order_line_description)
        return {
          lineRecordId,
          partRecordId: extractRelationshipRecordIds(v.purchase_order_line_part)[0] ?? null,
          description: typeof description === 'string' && description ? description : null,
          ordered: numberValue(v.purchase_order_line_quantity_ordered),
          received: numberValue(v.purchase_order_line_quantity_received),
          billed: numberValue(v.purchase_order_line_quantity_billed),
          expectedUnitPrice: numberValue(v.purchase_order_line_expected_unit_price),
          vendorPartRecordId:
            extractRelationshipRecordIds(v.purchase_order_line_vendor_part)[0] ?? null,
          // 🛑 NOT `numberValue`, which folds absence into `0` — see the field's
          // own note. Every other number on this row is a quantity or a price
          // where "none" and "zero" mean the same thing; weight is the one where
          // they do not.
          weight: numberOrNull(v.purchase_order_line_weight),
        }
      }),
    [lineRecordIds, valuesById]
  )

  return { lines, isLoading: isLoading || (lineRecordIds.length > 0 && valuesLoading) }
}
