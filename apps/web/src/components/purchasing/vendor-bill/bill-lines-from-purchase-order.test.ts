// apps/web/src/components/purchasing/vendor-bill/bill-lines-from-purchase-order.test.ts
//
// The two decisions in `bill-lines-from-purchase-order.ts`: which lines are
// offered, and which fields a created line carries.
//
// The second is the one worth a test. Prefilling a match input is not a visible
// mistake — the bill looks filled in, the match runs, and it agrees with itself.
// `matchBill` weighs `quantityBilled` against `quantityReceived` and
// `unitPriceBilled` against `unitPriceExpected`, so a prefill of either is the
// system answering its own question.

import type { RecordId } from '@auxx/types/resource'
import { describe, expect, it } from 'vitest'
import type { PurchaseOrderLineRow } from '../purchase-order/use-purchase-order-lines'
import {
  billLinesFromPurchaseOrder,
  billLineValuesFromPurchaseOrderLine,
  GRNI_ACCOUNT_CODE,
  selectBillableLines,
} from './bill-lines-from-purchase-order'

const BILL = 'vendor_bill:bill-1' as RecordId

function poLine(over: Partial<PurchaseOrderLineRow> = {}): PurchaseOrderLineRow {
  return {
    lineRecordId: 'purchase_order_line:pol-1' as RecordId,
    partRecordId: 'part:part-1' as RecordId,
    description: 'M6 hex bolt',
    ordered: 10,
    received: 10,
    billed: 0,
    expectedUnitPrice: 250,
    ...over,
  }
}

describe('which lines are offered', () => {
  it('offers a line that arrived and has not been billed', () => {
    expect(selectBillableLines([poLine()], [])).toHaveLength(1)
  })

  it('skips a line nothing has arrived against', () => {
    expect(selectBillableLines([poLine({ received: 0 })], [])).toEqual([])
  })

  it('skips a line already fully billed elsewhere', () => {
    expect(selectBillableLines([poLine({ received: 10, billed: 10 })], [])).toEqual([])
  })

  it('still offers a partially billed line — a delivery can be split across bills', () => {
    expect(selectBillableLines([poLine({ received: 10, billed: 4 })], [])).toHaveLength(1)
  })

  // 🛑 The regression this guard exists for. A line created by this action starts
  // at the default quantity with no price, so `quantity_billed` barely moves and
  // the received > billed filter keeps offering the same line back. Without the
  // membership check, pressing the button twice duplicates every line.
  it('never offers a line already on this bill, however little was typed into it', () => {
    const line = poLine({ received: 10, billed: 0 })
    expect(selectBillableLines([line], [line.lineRecordId])).toEqual([])
  })

  it('ignores bill lines with no match key when deciding what is taken', () => {
    // A freight line carries no `purchaseOrderLine` and must not mask anything.
    expect(selectBillableLines([poLine()], [null, undefined])).toHaveLength(1)
  })
})

describe('what a created line carries', () => {
  const values = billLineValuesFromPurchaseOrderLine(poLine(), BILL, 3)

  it('carries the match key, which is the fiddly half', () => {
    expect(values.vendor_bill_line_purchase_order_line).toBe('purchase_order_line:pol-1')
    expect(values.vendor_bill_line_vendor_bill).toBe(BILL)
  })

  it('stamps the part and copies the description', () => {
    expect(values.vendor_bill_line_part).toBe('part:part-1')
    expect(values.vendor_bill_line_description).toBe('M6 hex bolt')
  })

  it('codes a PO-matched line to GRNI', () => {
    expect(values.vendor_bill_line_gl_account).toBe(GRNI_ACCOUNT_CODE)
    expect(GRNI_ACCOUNT_CODE).toBe('2160')
  })

  // 🛑 THE assertion in this file. Both arms of the three-way match must arrive
  // empty for a human to fill from the vendor's paper. A prefill here does not
  // look like a bug — it looks like a filled-in bill that matches.
  it('prefills NEITHER match input', () => {
    expect(values).not.toHaveProperty('vendor_bill_line_quantity_billed')
    expect(values).not.toHaveProperty('vendor_bill_line_unit_price')
    expect(values).not.toHaveProperty('vendor_bill_line_line_total')
  })

  it('omits a part and description it does not have, rather than writing null', () => {
    const bare = billLineValuesFromPurchaseOrderLine(
      poLine({ partRecordId: null, description: null }),
      BILL,
      1
    )
    expect(bare).not.toHaveProperty('vendor_bill_line_part')
    expect(bare).not.toHaveProperty('vendor_bill_line_description')
  })
})

describe('the batch', () => {
  it('appends after the lines already on the bill, in the order the PO lists them', () => {
    const lines = [
      poLine({ lineRecordId: 'purchase_order_line:a' as RecordId }),
      poLine({ lineRecordId: 'purchase_order_line:b' as RecordId }),
    ]
    const batch = billLinesFromPurchaseOrder(lines, BILL, 7)
    expect(batch.map((v) => v.vendor_bill_line_sort_order)).toEqual([8, 9])
    expect(batch.map((v) => v.vendor_bill_line_purchase_order_line)).toEqual([
      'purchase_order_line:a',
      'purchase_order_line:b',
    ])
  })

  it('is empty when there is nothing to add', () => {
    expect(billLinesFromPurchaseOrder([], BILL, 0)).toEqual([])
  })
})
