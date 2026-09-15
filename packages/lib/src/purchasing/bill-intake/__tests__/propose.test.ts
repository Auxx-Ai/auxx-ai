// packages/lib/src/purchasing/bill-intake/__tests__/propose.test.ts
//
// `proposeBillLineLinks`, with the two loaders mocked and `assignBillLines`
// left real (it is pure and already covered by `assign.test.ts`) - this file
// only pins the orchestration: which loader runs, in what order, and how a
// loader failure or an order-less bill come out the other side.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../load-bill-lines', () => ({ loadBillLineFacts: vi.fn() }))
vi.mock('../load-order-lines', () => ({ loadOrderLineFacts: vi.fn() }))

import type { Database } from '@auxx/database'
import type { BillLineFactsLoad } from '../load-bill-lines'
import { loadBillLineFacts } from '../load-bill-lines'
import { loadOrderLineFacts } from '../load-order-lines'
import { proposeBillLineLinks } from '../propose'

const db = {} as Database

const loadBillLineFactsMock = vi.mocked(loadBillLineFacts)
const loadOrderLineFactsMock = vi.mocked(loadOrderLineFacts)

function bill(partial: Partial<BillLineFactsLoad> = {}): BillLineFactsLoad {
  return {
    vendorBillInstanceId: 'bill_1',
    vendorRecordId: 'def_company:company_1' as never,
    purchaseOrderRecordId: null,
    currency: 'USD',
    lines: [],
    ...partial,
  }
}

beforeEach(() => {
  loadBillLineFactsMock.mockReset()
  loadOrderLineFactsMock.mockReset()
})

describe('proposeBillLineLinks', () => {
  it('every line is none when the bill carries no order, and the order loader never runs', async () => {
    loadBillLineFactsMock.mockResolvedValue(
      ok(
        bill({
          lines: [
            {
              lineId: 'line_1' as never,
              lineRecordId: 'def_vbl:line_1' as never,
              purchaseOrderLineRecordId: null,
              vendorCode: null,
              customerCode: null,
              description: 'Freight',
              quantity: 1,
              unitPriceCents: 5000,
            },
          ],
        })
      )
    )

    const result = await proposeBillLineLinks(db, 'org_1', 'def_vendor_bill:bill_1' as never)

    const value = result._unsafeUnwrap()
    expect(value.purchaseOrderRecordId).toBeNull()
    expect(value.proposals).toHaveLength(1)
    expect(value.proposals[0]?.tier).toBe('none')
    expect(loadOrderLineFactsMock).not.toHaveBeenCalled()
  })

  it('loads the order and matches when the bill carries one', async () => {
    loadBillLineFactsMock.mockResolvedValue(
      ok(
        bill({
          purchaseOrderRecordId: 'def_purchase_order:po_1' as never,
          lines: [
            {
              lineId: 'line_1' as never,
              lineRecordId: 'def_vbl:line_1' as never,
              purchaseOrderLineRecordId: null,
              vendorCode: 'AF-4420',
              customerCode: null,
              description: null,
              quantity: null,
              unitPriceCents: null,
            },
          ],
        })
      )
    )
    loadOrderLineFactsMock.mockResolvedValue(
      ok([
        {
          orderLineRecordId: 'def_pol:pol_1' as never,
          partRecordId: 'def_part:part_1' as never,
          partSku: null,
          partTitle: null,
          vendorSku: 'AF-4420',
          description: null,
          ordered: 10,
          received: 0,
          billed: 0,
          expectedUnitPriceCents: null,
          sortOrder: 0,
        },
      ])
    )

    const result = await proposeBillLineLinks(db, 'org_1', 'def_vendor_bill:bill_1' as never)

    const value = result._unsafeUnwrap()
    expect(value.purchaseOrderRecordId).toBe('def_purchase_order:po_1')
    expect(value.proposals[0]?.tier).toBe('vendor_sku')
    expect(value.proposals[0]?.linkedOrderLineRecordId).toBe('def_pol:pol_1')
    expect(loadOrderLineFactsMock).toHaveBeenCalledWith(db, 'org_1', 'def_purchase_order:po_1')
  })

  it('propagates a bill-loader failure without ever loading the order', async () => {
    loadBillLineFactsMock.mockResolvedValue(err(new Error('boom')))

    const result = await proposeBillLineLinks(db, 'org_1', 'def_vendor_bill:bill_1' as never)

    expect(result.isErr()).toBe(true)
    expect(loadOrderLineFactsMock).not.toHaveBeenCalled()
  })

  it('propagates an order-loader failure', async () => {
    loadBillLineFactsMock.mockResolvedValue(
      ok(bill({ purchaseOrderRecordId: 'def_purchase_order:po_1' as never }))
    )
    loadOrderLineFactsMock.mockResolvedValue(err(new Error('boom')))

    const result = await proposeBillLineLinks(db, 'org_1', 'def_vendor_bill:bill_1' as never)

    expect(result.isErr()).toBe(true)
  })
})
