// apps/web/src/components/purchasing/purchase-order/use-purchase-order-lines.ts
'use client'

// One purchase order's lines, with the two roll-ups that say what is still owed
// and what is still unbilled.
//
// Extracted from `purchase-order-line-picker.tsx` when a second caller appeared —
// "Add lines from the order" on the bill (plans/purchasing/02-handoff.md §4 item
// 3c). The two readings must agree: the picker offers a line and the button
// creates one, and a line that is billable by one rule and not the other is a
// contradiction the user sees as a bug.
//
// 🛑 No query, by design. `purchase_order_lines` is the PO's own inverse
// relationship, so scoping is a FIELD READ off the order — the same reasoning
// that kept the picker off `record.search`, whose input schema takes no
// conditions and would offer every purchase order line in the org.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { useMemo } from 'react'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { numberValue, unwrapValue } from '../purchasing-summary-strip'

const PO_ATTRS = ['purchase_order_lines'] as const

const LINE_ATTRS = [
  'purchase_order_line_part',
  'purchase_order_line_description',
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_quantity_received',
  'purchase_order_line_quantity_billed',
  'purchase_order_line_expected_unit_price',
] as const

/** One purchase order line, as both the picker and the bill-lines action read it. */
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
  const { values, isLoading: linesLoading } = useSystemValues(
    purchaseOrderRecordId,
    [...PO_ATTRS],
    { autoFetch: true, enabled: !!purchaseOrderRecordId }
  )
  const lineRecordIds = extractRelationshipRecordIds(values.purchase_order_lines)

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
        }
      }),
    [lineRecordIds, valuesById]
  )

  return { lines, isLoading: linesLoading || (lineRecordIds.length > 0 && valuesLoading) }
}
