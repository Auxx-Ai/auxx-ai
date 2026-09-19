// packages/lib/src/purchasing/vendor-credit/__tests__/stock-return.test.ts
//
// 73 §8.2. The flag decides whether goods move, and a flagged line that cannot
// be valued refuses the ISSUE rather than writing half a return.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VendorCreditLineRecord } from '../reads'

const h = vi.hoisted(() => ({
  readStandardCost: vi.fn(),
  readPartKind: vi.fn(),
}))

vi.mock('../../../inventory/costing/standard-cost-queries', () => ({
  readStandardCost: h.readStandardCost,
}))
vi.mock('../../../inventory/receiving/receipt-queries', () => ({
  readPartKind: h.readPartKind,
}))
vi.mock('../../../inventory/movements/client', () => ({
  resolveInventoryRoleForPartKind: () => 'inventory_raw_materials',
}))

import { planVendorCreditStockReturns } from '../stock-return'

const db = {} as never

function line(overrides: Partial<VendorCreditLineRecord> = {}): VendorCreditLineRecord {
  return {
    id: 'vcl_1',
    description: 'Motor M',
    quantity: 2,
    unitPriceMinor: 1_200,
    lineTotalMinor: 2_400,
    glAccountId: 'acc_grni',
    partInstanceId: 'part_m',
    purchaseOrderLineInstanceId: 'poline_1',
    returnsStock: true,
    sortOrder: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.readStandardCost.mockResolvedValue(ok(new Map([['part_m', { standardCost: 1_600 }]])))
  h.readPartKind.mockResolvedValue(ok('raw_material'))
})

describe('planning a supplier return', () => {
  it('values the return at the standard and carries the credited amount to GRNI', async () => {
    const [plan] = await planVendorCreditStockReturns(db, 'org_1', [line()])

    expect(plan).toEqual({
      lineId: 'vcl_1',
      partInstanceId: 'part_m',
      quantity: 2,
      standardUnitCost: 1_600,
      glAccountRole: 'inventory_raw_materials',
      purchaseOrderLineInstanceId: 'poline_1',
      grniReliefMinor: 2_400,
    })
  })

  // The price-adjustment credit: a quantity, and nothing leaves the shelf.
  it('moves nothing for a line with the flag off, whatever it carries', async () => {
    expect(
      await planVendorCreditStockReturns(db, 'org_1', [line({ returnsStock: false })])
    ).toEqual([])
    expect(h.readStandardCost).not.toHaveBeenCalled()
  })

  // The short shipment: the credit clears GRNI's debit with money alone.
  it('moves nothing for a credit with no part at all and the flag off', async () => {
    expect(
      await planVendorCreditStockReturns(db, 'org_1', [
        line({ partInstanceId: null, purchaseOrderLineInstanceId: null, returnsStock: false }),
      ])
    ).toEqual([])
  })

  it('refuses a flagged line with no part, by name', async () => {
    await expect(
      planVendorCreditStockReturns(db, 'org_1', [line({ partInstanceId: null })])
    ).rejects.toThrow(/Motor M has no part/)
  })

  it('refuses a flagged line with no quantity, by name', async () => {
    await expect(
      planVendorCreditStockReturns(db, 'org_1', [line({ quantity: 0 })])
    ).rejects.toThrow(/Motor M returns stock but has no quantity/)
  })

  it('refuses a flagged line whose part has no standard, by name', async () => {
    h.readStandardCost.mockResolvedValue(ok(new Map()))

    await expect(planVendorCreditStockReturns(db, 'org_1', [line()])).rejects.toThrow(
      /Motor M has no standard cost/
    )
  })

  it('names every bad line in one refusal, not just the first', async () => {
    await expect(
      planVendorCreditStockReturns(db, 'org_1', [
        line({ partInstanceId: null }),
        line({ id: 'vcl_2', description: 'Bracket', quantity: 0 }),
      ])
    ).rejects.toThrow(/Motor M has no part.*Bracket returns stock but has no quantity/)
  })

  it('falls back to the line’s position when the supplier named it nothing', async () => {
    await expect(
      planVendorCreditStockReturns(db, 'org_1', [line({ description: null, partInstanceId: null })])
    ).rejects.toThrow(/Line 1 has no part/)
  })
})
