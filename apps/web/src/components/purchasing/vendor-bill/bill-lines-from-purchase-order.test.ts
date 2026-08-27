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

  // 🛑 The gate is `billed < ordered`, NOT `received > billed`. A vendor that will
  // not ship until the invoice is paid — full prepayment on Chinese supply, a
  // deposit, a freight-forwarder invoice — bills before anything arrives, and
  // under the old rule that bill offered zero lines and said nothing about why.
  it('offers a line nothing has arrived against yet — the bill can precede the goods', () => {
    expect(selectBillableLines([poLine({ received: 0, billed: 0 })], [])).toHaveLength(1)
  })

  it('skips a line already fully billed elsewhere, received or not', () => {
    expect(selectBillableLines([poLine({ received: 10, billed: 10 })], [])).toEqual([])
    expect(selectBillableLines([poLine({ received: 0, billed: 10 })], [])).toEqual([])
  })

  it('skips an over-billed line', () => {
    expect(selectBillableLines([poLine({ received: 10, billed: 12 })], [])).toEqual([])
  })

  it('still offers a partially billed line — an order can be split across bills', () => {
    expect(selectBillableLines([poLine({ received: 10, billed: 4 })], [])).toHaveLength(1)
    // Same split, nothing received: a deposit invoice then a balance invoice.
    expect(selectBillableLines([poLine({ received: 0, billed: 4 })], [])).toHaveLength(1)
  })

  // 🛑 The regression this guard exists for, and the new gate does NOT weaken it —
  // if anything it leans harder on it. A line created by this action starts at the
  // default quantity of 1 with no price, so against an ordered 10 the `billed <
  // ordered` filter keeps offering the same line straight back. Without the
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
