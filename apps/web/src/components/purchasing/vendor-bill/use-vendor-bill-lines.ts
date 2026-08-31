// apps/web/src/components/purchasing/vendor-bill/use-vendor-bill-lines.ts
'use client'

// One bill's lines, read once and shared.
//
// Lifted out of `vendor-bill-lines-card.tsx` when that card became a thin
// `LineBuilder` skin (plans/purchasing/04-vendor-bill-lines-and-the-amount-cell.md
// §4.1). The editor it used to live beside is gone, but `vendor-bill-match-card.tsx`
// still reads through this hook — deleting the editor without moving the hook
// first would have taken the match card down with it.
//
// The builder does NOT use this: it lists and syncs the same rows through its own
// `useRecordList` + `useFieldValueSyncer` path. Two readers of one row set is the
// pre-existing arrangement, and the match card is a read-only consumer.

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { useEffect, useMemo } from 'react'
import { LINE_PAGE_SIZE } from '~/components/money/ui/line-builder/line-values'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'

/** Everything one bill line carries. */
export const VENDOR_BILL_LINE_ATTRIBUTES = [
  'vendor_bill_line_purchase_order_line',
  'vendor_bill_line_part',
  'vendor_bill_line_description',
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_unit_price',
  'vendor_bill_line_line_total',
  'vendor_bill_line_gl_account',
  'vendor_bill_line_sort_order',
] as const

/** One bill line, narrowed out of the raw system-value bag. */
export interface VendorBillLineValues {
  purchaseOrderLineRecordId?: RecordId
  partRecordId?: RecordId
  description: string
  quantityBilled: number | null
  /** Integer minor units. */
  unitPrice: number | null
  /** Integer minor units — transcribed from the vendor document, never derived. */
  lineTotal: number | null
  glAccount: string
  sortOrder: number | null
}

/** A relation read comes back as `RecordId[]`; everything else as a scalar. */
function firstRecordId(raw: unknown): RecordId | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? (value as RecordId) : undefined
}

function toNumber(raw: unknown): number | null {
  return typeof raw === 'number' ? raw : null
}

/** Narrow one bill line's raw system values. */
export function toVendorBillLineValues(
  values: Record<string, unknown> | undefined
): VendorBillLineValues {
  return {
    purchaseOrderLineRecordId: firstRecordId(values?.vendor_bill_line_purchase_order_line),
    partRecordId: firstRecordId(values?.vendor_bill_line_part),
    description: (values?.vendor_bill_line_description as string | undefined) ?? '',
    quantityBilled: toNumber(values?.vendor_bill_line_quantity_billed),
    unitPrice: toNumber(values?.vendor_bill_line_unit_price),
    lineTotal: toNumber(values?.vendor_bill_line_line_total),
    glAccount: (values?.vendor_bill_line_gl_account as string | undefined) ?? '',
    sortOrder: toNumber(values?.vendor_bill_line_sort_order),
  }
}

/**
 * The bill's own lines, in document order.
 *
 * One batched value fetch over the row set, so a consumer never fans out a
 * per-row read.
 */
export function useVendorBillLines(billRecordId: RecordId) {
  const { entityInstanceId: billId } = parseRecordId(billRecordId)
  const lineDefId = useResourceProperty('vendor_bill_line', 'id')

  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'vendor-bill-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'vendor-bill-match',
            fieldId: 'vendor_bill_line:vendorBill' as ResourceFieldId,
            operator: 'is' as const,
            value: billId,
          },
        ],
      },
    ],
    [billId]
  )

  const { recordIds, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage, refresh } =
    useRecordList({
      entityDefinitionId: lineDefId ?? '',
      filters,
      limit: LINE_PAGE_SIZE,
      enabled: !!billId && !!lineDefId,
    })

  // Every page, eagerly — the same call the builder makes for the same rows.
  // On the old un-drained default of 50 a bill with more lines than that fed
  // the match card a SHORT line set, which reads as "the bill does not claim
  // these order lines" and offers them for import a second time.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

  // Ids, not `records`: the record-store resolution is a second wave, and
  // `ready` below already carries the "values have landed" half of the answer.
  const rowRecordIds = useMemo(
    () => (lineDefId ? recordIds.map((id) => toRecordId(lineDefId, id)) : []),
    [recordIds, lineDefId]
  )

  const { valuesById, loadedById } = useSystemValuesForRecords(
    rowRecordIds,
    VENDOR_BILL_LINE_ATTRIBUTES,
    { autoFetch: true, enabled: rowRecordIds.length > 0 }
  )

  /**
   * Whether `rows` is the bill's real line set, as opposed to a shape it passes
   * through on the way there.
   *
   * 🛑 A caller whose correctness depends on a line being ABSENT must gate on
   * this, never on `rows` and never on `isLoading` alone. An empty or valueless
   * `rows` is reached three different ways after a drawer mounts, and only the
   * last one means what it says:
   *
   *   1. `lineDefId` is undefined while the resource store hydrates. The list is
   *      `enabled: false`, so it reports **`isLoading: false`** with no records —
   *      an empty answer that was never asked. This is the window an `isLoading`
   *      gate silently misses.
   *   2. `isLoading` — the list query is in flight. No rows yet.
   *   3. rows exist, values do not. They arrive from a SECOND batched fetch, so
   *      every `purchaseOrderLineRecordId` reads `undefined`, which is
   *      indistinguishable from a freight line carrying no match key.
   *
   * `selectBillableLines` subtracts the order lines this bill already claims,
   * using exactly that field. Through all three windows it subtracts nothing, so
   * "Add lines from order" offers the whole order back on a bill that already
   * has it — observed as a live, clickable button on a cold open of a
   * fully-linked bill. The pure guard is correct and its unit test passes; the
   * component simply could not supply the argument yet.
   *
   * `loadedById` is the fetch layer's own answer to (3): a raw `undefined` means
   * not fetched, a raw `null` means genuinely empty.
   */
  const ready =
    !!billId &&
    !!lineDefId &&
    !isLoading &&
    // A half-paged list is a SHORT list, which is the third window all over
    // again — an absent line reads as "not claimed by this bill".
    !hasNextPage &&
    !isFetchingNextPage &&
    rowRecordIds.every((lineRecordId) =>
      VENDOR_BILL_LINE_ATTRIBUTES.every((attr) => loadedById[lineRecordId]?.[attr])
    )

  const rows = useMemo(
    () =>
      rowRecordIds
        .map((lineRecordId) => ({
          lineRecordId,
          values: toVendorBillLineValues(valuesById[lineRecordId]),
        }))
        .sort((a, b) => (a.values.sortOrder ?? 0) - (b.values.sortOrder ?? 0)),
    [rowRecordIds, valuesById]
  )

  return { billId, lineDefId, rows, isLoading, ready, refresh }
}
