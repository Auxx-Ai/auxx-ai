// packages/lib/src/inventory/movements/__tests__/values.test.ts
// The values bag every movement writer hands to the CRUD handler - in
// particular the `pending` shape (111 Q18): no cost keys, never a 0.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import { buildStockMovementValues } from '../values'

const BASE = {
  partRecordId: 'def_part:part_1' as never,
  type: 'adjust',
  quantity: 5,
  glAccount: 'inventory_raw_materials',
  occurredAt: new Date('2026-09-01T00:00:00.000Z'),
}

describe('buildStockMovementValues - a costed row', () => {
  it('stamps the unit cost and an extended cost signed like the quantity', () => {
    const values = buildStockMovementValues({ ...BASE, unitCost: 1234, costBasis: 'standard' })
    expect(values).toMatchObject({
      stock_movement_unit_cost: 1234,
      stock_movement_extended_cost: 6170,
      stock_movement_cost_basis: 'standard',
      stock_movement_adjust_subparts: false,
    })
  })

  it('takes the caller-supplied extended cost over the recomputed one', () => {
    const values = buildStockMovementValues({
      ...BASE,
      quantity: -3,
      unitCost: 1,
      extendedCost: -4,
      costBasis: 'standard',
    })
    expect(values.stock_movement_extended_cost).toBe(-4)
  })
})

describe('buildStockMovementValues - a pending row (111 Q18)', () => {
  it('writes NO cost keys - absent, never 0 - and the pending basis', () => {
    const values = buildStockMovementValues({ ...BASE, unitCost: null, costBasis: 'pending' })
    expect(values.stock_movement_cost_basis).toBe('pending')
    expect(values).not.toHaveProperty('stock_movement_unit_cost')
    expect(values).not.toHaveProperty('stock_movement_extended_cost')
    // Everything else a movement carries is still there.
    expect(values).toMatchObject({
      stock_movement_part: 'def_part:part_1',
      stock_movement_type: 'adjust',
      stock_movement_quantity: 5,
      stock_movement_gl_account: 'inventory_raw_materials',
    })
    expect(Object.values(values)).not.toContain(0)
  })

  it('refuses a null unit cost on any other basis, instead of multiplying it into a 0', () => {
    expect(() =>
      buildStockMovementValues({ ...BASE, unitCost: null, costBasis: 'standard' })
    ).toThrow(UnprocessableEntityError)
    expect(() => buildStockMovementValues({ ...BASE, unitCost: null })).toThrow(
      UnprocessableEntityError
    )
  })

  it('refuses a pending row that carries a cost - the cost is written once, by the pricer', () => {
    expect(() =>
      buildStockMovementValues({ ...BASE, unitCost: 100, costBasis: 'pending' })
    ).toThrow(UnprocessableEntityError)
    expect(() =>
      buildStockMovementValues({ ...BASE, unitCost: null, extendedCost: 500, costBasis: 'pending' })
    ).toThrow(UnprocessableEntityError)
  })
})
