// packages/lib/src/inventory/movements/__tests__/row.test.ts

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import { toStockMovementRow } from '../row'
import type { StockMovementInput } from '../types'

const META = { id: 'm1', organizationId: 'org', userId: 'u1', createdAt: new Date(0) }
const BASE: StockMovementInput = {
  partInstanceId: 'part_1',
  type: 'adjust',
  quantity: 5,
  unitCost: 1234,
  costBasis: 'standard',
  glRole: 'inventory_raw_materials',
  occurredAt: new Date('2026-09-01T00:00:00.000Z'),
}
const row = (input: Partial<StockMovementInput>) => toStockMovementRow(META, { ...BASE, ...input })

describe('toStockMovementRow - a costed row', () => {
  it('stores the unit cost and an extended cost signed like the quantity', () => {
    expect(row({})).toMatchObject({
      id: 'm1',
      partId: 'part_1',
      unitCostMinor: 1234,
      extendedCostMinor: 6170,
      costBasis: 'standard',
      glRole: 'inventory_raw_materials',
      adjustSubparts: false,
    })
  })

  it('takes the caller-supplied extended cost over the recomputed one', () => {
    expect(row({ quantity: -3, unitCost: 1, extendedCost: -4 }).extendedCostMinor).toBe(-4)
  })

  it('refuses a fractional amount rather than rounding it away', () => {
    expect(() => row({ extendedCost: 10.5 })).toThrow(UnprocessableEntityError)
    expect(() => row({ accrued: { freightMinor: 0.5 } })).toThrow(UnprocessableEntityError)
  })

  it('maps links onto their columns as bare ids', () => {
    expect(
      row({
        links: { purchaseOrderLineId: 'pol_1', vendorPartId: 'vp_1', reversesMovementId: 'm0' },
      })
    ).toMatchObject({
      purchaseOrderLineId: 'pol_1',
      vendorPartId: 'vp_1',
      reversesMovementId: 'm0',
    })
  })
})

describe('toStockMovementRow - a pending row (111 Q18)', () => {
  it('stores null costs, never 0', () => {
    const pending = row({ unitCost: null, costBasis: 'pending' })
    expect(pending).toMatchObject({
      unitCostMinor: null,
      extendedCostMinor: null,
      costBasis: 'pending',
    })
  })

  it('refuses a null unit cost on any other basis', () => {
    expect(() => row({ unitCost: null })).toThrow(UnprocessableEntityError)
    expect(() => row({ unitCost: null, costBasis: undefined })).toThrow(UnprocessableEntityError)
  })

  it('refuses a pending row that carries a cost', () => {
    expect(() => row({ costBasis: 'pending' })).toThrow(UnprocessableEntityError)
    expect(() => row({ unitCost: null, extendedCost: 5, costBasis: 'pending' })).toThrow(
      UnprocessableEntityError
    )
  })
})

describe('toStockMovementRow - ledger rules', () => {
  it('allows quantity 0 on revalue only', () => {
    expect(row({ type: 'revalue', quantity: 0, extendedCost: 100 }).quantity).toBe(0)
    expect(() => row({ quantity: 0 })).toThrow(UnprocessableEntityError)
  })

  it('carries a count fact on initial only', () => {
    const count = { quantity: 7, date: '2026-01-31' }
    expect(row({ type: 'initial', count })).toMatchObject({
      countQuantity: 7,
      countDate: '2026-01-31',
    })
    expect(() => row({ count })).toThrow(UnprocessableEntityError)
  })

  it('refuses an unknown type or cost basis', () => {
    expect(() => row({ type: 'teleport' })).toThrow(UnprocessableEntityError)
    expect(() => row({ costBasis: 'guess' })).toThrow(UnprocessableEntityError)
  })
})
