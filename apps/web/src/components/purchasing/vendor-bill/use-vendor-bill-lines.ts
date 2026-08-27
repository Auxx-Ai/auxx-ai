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
import { useMemo } from 'react'
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

  const { records, isLoading, refresh } = useRecordList({
    entityDefinitionId: lineDefId ?? '',
    filters,
    enabled: !!billId && !!lineDefId,
  })

  const rowRecordIds = useMemo(
    () => (lineDefId ? records.map((record) => toRecordId(lineDefId, record.id)) : []),
    [records, lineDefId]
  )

  const { valuesById } = useSystemValuesForRecords(rowRecordIds, VENDOR_BILL_LINE_ATTRIBUTES, {
    autoFetch: true,
    enabled: rowRecordIds.length > 0,
  })

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

  return { billId, lineDefId, rows, isLoading, refresh }
}
