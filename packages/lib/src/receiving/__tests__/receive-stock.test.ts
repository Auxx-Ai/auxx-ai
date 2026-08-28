// packages/lib/src/receiving/__tests__/receive-stock.test.ts
// The single-line receipt write. The org cache, the CRUD handler and the two
// field reads are mocked, so nothing here needs a database — what is asserted is
// the CONTRACT: the order of the guards, the zero-cost refusal, the rounding,
// and the exact value bag handed to `UnifiedCrudHandler.create`.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'

const h = vi.hoisted(() => ({
  createSpy: vi.fn(async (_defId: string, _values: Record<string, unknown>) => ({
    instance: { id: 'mv_1' },
  })),
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  partKind: null as string | null,
  vendorTerms: null as {
    unitPrice: number | null
    shippingCost?: number | null
    tariffRate?: number | null
    otherCost?: number | null
  } | null,
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  requireCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => {
    const id = h.defs.get(entityType)
    if (!id) throw new Error(`EntityDefinition not found for entityType: ${entityType}`)
    return id
  }),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])
        ),
    }),
  }),
}))

vi.mock('../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    create = h.createSpy
  },
}))

vi.mock('../receipt-queries', async () => {
  const { ok } = await import('neverthrow')
  return {
    readPartKind: vi.fn(async () => ok(h.partKind)),
    readVendorPartCostInputs: vi.fn(async () => ok(h.vendorTerms)),
  }
})

import { receiveStock } from '../receive-stock'

const ORG = 'org_1'
const USER = 'user_1'
const db = {} as never

/** Every systemAttribute a fully migrated org has for this write path. */
const ALL_MOVEMENT_ATTRS = [
  'stock_movement_unit_cost',
  'stock_movement_cost_basis',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  'stock_movement_occurred_at',
  'stock_movement_vendor_unit_price',
]

beforeEach(() => {
  vi.clearAllMocks()
  h.materialised = new Set(ALL_MOVEMENT_ATTRS)
  h.defs = new Map([
    ['part', 'def_part'],
    ['stock_movement', 'def_mv'],
    ['vendor_part', 'def_vp'],
    ['purchase_order_line', 'def_pol'],
  ])
  h.partKind = null
  h.vendorTerms = null
  h.createSpy.mockResolvedValue({ instance: { id: 'mv_1' } })
})

/** The value bag handed to `UnifiedCrudHandler.create` on the single write. */
function writtenValues(): Record<string, unknown> {
  expect(h.createSpy).toHaveBeenCalledTimes(1)
  return h.createSpy.mock.calls[0]![1]
}

async function expectErr(promise: ReturnType<typeof receiveStock>) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

describe('receiveStock — step 1, the quantity guard', () => {
  it.each([0, -1, -0.5])('refuses a non-positive quantity (%s)', async (quantity) => {
    const error = await expectErr(
      receiveStock(db, ORG, USER, { partId: 'part_1', quantity, unitCost: 4400 })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('refuses a non-finite quantity (%s)', async (quantity) => {
    // NaN passes `<= 0` as false, and Infinity survives Math.round into the
    // doublePrecision column and poisons every later SUM.
    const error = await expectErr(
      receiveStock(db, ORG, USER, { partId: 'part_1', quantity, unitCost: 4400 })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('runs the quantity guard before anything else', async () => {
    // No defs at all: if the quantity check ran second this would surface as a
    // NotFound instead, and the caller would fix the wrong problem.
    h.defs = new Map()
    const error = await expectErr(
      receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 0, unitCost: 4400 })
    )
    expect(error).toBeInstanceOf(BadRequestError)
  })
})

describe('receiveStock — step 2, the zero-cost guard', () => {
  it('refuses when neither a price nor a supplier part is given', async () => {
    const error = await expectErr(receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 10 }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses when the supplier part exists but is unpriced', async () => {
    // An unpriced supplier row is not a free part.
    h.vendorTerms = { unitPrice: null, shippingCost: 500 }
    const error = await expectErr(
      receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 10, vendorPartId: 'vp_1' })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses an explicit zero unit cost instead of defaulting it', async () => {
    const error = await expectErr(
      receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 10, unitCost: 0 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/zero cost/i)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses a negative unit cost', async () => {
    const error = await expectErr(
      receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 10, unitCost: -100 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses a sub-half-cent price rather than storing the zero it rounds to', async () => {
    // The check is applied AFTER rounding on purpose: 0.4c stored as 0 is a
    // receipt the ledger cannot explain.
    const error = await expectErr(
      receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 10, unitCost: 0.4 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('surfaces a missing supplier part as NotFound, not as a zero-cost receipt', async () => {
    h.vendorTerms = null
    const error = await expectErr(
      receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 10, vendorPartId: 'vp_missing' })
    )
    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses to write at all before the cost fields are provisioned', async () => {
    h.materialised.delete('stock_movement_unit_cost')
    const error = await expectErr(
      receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 10, unitCost: 4400 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })
})

describe('receiveStock — step 2, resolving the price', () => {
  it('uses a supplied unit cost as-is, applying no vendor terms on top', async () => {
    // `unitCost` is the internal seam receivePurchaseOrder passes an
    // already-resolved cost through. It is not a browser field.
    h.vendorTerms = { unitPrice: 4000, shippingCost: 500 }
    const result = await receiveStock(db, ORG, USER, {
      partId: 'part_1',
      quantity: 2,
      vendorPartId: 'vp_1',
      unitCost: 4711,
    })
    expect(result.isOk()).toBe(true)
    expect(writtenValues().stock_movement_unit_cost).toBe(4711)
  })

  it('derives the landed cost from the supplier row when no price is supplied', async () => {
    h.vendorTerms = { unitPrice: 4000, shippingCost: 500, tariffRate: 10, otherCost: 100 }
    await receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 1, vendorPartId: 'vp_1' })
    expect(writtenValues().stock_movement_unit_cost).toBe(5000)
  })

  it('still freezes the raw supplier price when the landed cost was typed in', async () => {
    // vendorUnitPrice is provenance for the three-way match, not an input to
    // the valuation, so the two are resolved independently.
    h.vendorTerms = { unitPrice: 4000, shippingCost: 500 }
    await receiveStock(db, ORG, USER, {
      partId: 'part_1',
      quantity: 1,
      vendorPartId: 'vp_1',
      unitCost: 4711,
    })
    const values = writtenValues()
    expect(values.stock_movement_vendor_unit_price).toBe(4000)
    expect(values.stock_movement_unit_cost).toBe(4711)
  })

  it('prefers an explicitly supplied vendor unit price over the supplier row', async () => {
    h.vendorTerms = { unitPrice: 4000 }
    await receiveStock(db, ORG, USER, {
      partId: 'part_1',
      quantity: 1,
      vendorPartId: 'vp_1',
      vendorUnitPrice: 4123,
      unitCost: 4500,
    })
    expect(writtenValues().stock_movement_vendor_unit_price).toBe(4123)
  })

  it('omits the vendor unit price entirely when it is not known', async () => {
    const values = await receiveAndRead({ partId: 'part_1', quantity: 1, unitCost: 4400 })
    expect(values).not.toHaveProperty('stock_movement_vendor_unit_price')
  })
})

describe('receiveStock — door 1, the SENT price is the base', () => {
  it('🛑 uses the sent vendorUnitPrice as the base, NOT the stored supplier price', async () => {
    // This is the regression the whole change exists for. The packing slip says
    // $50.00; the supplier row still says $40.00 from months ago. Valuing the
    // receipt from the stored price freezes a cost nobody typed onto a movement
    // whose every field is `updatable: false`, and nothing throws.
    h.vendorTerms = { unitPrice: 4000, shippingCost: 500, tariffRate: 10, otherCost: 100 }
    await receiveStock(db, ORG, USER, {
      partId: 'part_1',
      quantity: 1,
      vendorPartId: 'vp_1',
      vendorUnitPrice: 5000,
    })
    const values = writtenValues()
    // 5000 base + 500 freight + 10% of 5000 + 100 other.
    expect(values.stock_movement_unit_cost).toBe(6100)
    // What the OLD behaviour produced, from the price the user replaced.
    expect(values.stock_movement_unit_cost).not.toBe(5000)
    expect(values.stock_movement_vendor_unit_price).toBe(5000)
  })

  it('takes the adders from the supplier row while ignoring its price', async () => {
    // Same row, same adders, two different sent bases: the landed costs differ
    // by exactly the difference in the base.
    h.vendorTerms = { unitPrice: 9999, shippingCost: 500, tariffRate: 10, otherCost: 100 }
    await receiveStock(db, ORG, USER, {
      partId: 'part_1',
      quantity: 1,
      vendorPartId: 'vp_1',
      vendorUnitPrice: 1000,
    })
    // 1000 + 500 + 100 + 100 — the tariff is 10% of the SENT base, not of 9999.
    expect(writtenValues().stock_movement_unit_cost).toBe(1700)
  })

  it('lands at exactly the sent base when no supplier row is named', async () => {
    // A part with no supplier row at all: the terms resolve empty and there is
    // nothing to capitalise.
    h.vendorTerms = null
    const values = await receiveAndRead({
      partId: 'part_1',
      quantity: 3,
      vendorUnitPrice: 4400,
    })
    expect(values.stock_movement_unit_cost).toBe(4400)
    expect(values.stock_movement_vendor_unit_price).toBe(4400)
    expect(values.stock_movement_extended_cost).toBe(13200)
  })

  it('still refuses a sent base of zero rather than writing a free receipt', async () => {
    h.vendorTerms = { unitPrice: 4000, shippingCost: 0 }
    const error = await expectErr(
      receiveStock(db, ORG, USER, {
        partId: 'part_1',
        quantity: 1,
        vendorPartId: 'vp_1',
        vendorUnitPrice: 0,
      })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/zero cost/i)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('does not read the supplier row when both the cost and the price are given', async () => {
    const { readVendorPartCostInputs } = await import('../receipt-queries')
    await receiveStock(db, ORG, USER, {
      partId: 'part_1',
      quantity: 1,
      vendorPartId: 'vp_1',
      vendorUnitPrice: 4123,
      unitCost: 4500,
    })
    expect(vi.mocked(readVendorPartCostInputs)).not.toHaveBeenCalled()
    const values = writtenValues()
    expect(values.stock_movement_unit_cost).toBe(4500)
    expect(values.stock_movement_vendor_unit_price).toBe(4123)
  })
})

describe('receiveStock — step 3, rounding', () => {
  it('rounds the fractional cent the landed formula leaves behind', async () => {
    // 4133 at 7.5% is 4442.975; CURRENCY is cents in a doublePrecision column.
    h.vendorTerms = { unitPrice: 4133, tariffRate: 7.5 }
    await receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 1, vendorPartId: 'vp_1' })
    expect(writtenValues().stock_movement_unit_cost).toBe(4443)
  })

  it('rounds a supplied fractional price too', async () => {
    await receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 1, unitCost: 4442.975 })
    expect(writtenValues().stock_movement_unit_cost).toBe(4443)
  })

  it('rounds the vendor unit price as well as the landed cost', async () => {
    h.vendorTerms = { unitPrice: 4000.6 }
    await receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 1, vendorPartId: 'vp_1' })
    expect(writtenValues().stock_movement_vendor_unit_price).toBe(4001)
  })

  it('computes the extended cost from the ROUNDED unit cost times the quantity', async () => {
    h.vendorTerms = { unitPrice: 4133, tariffRate: 7.5 }
    await receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 10, vendorPartId: 'vp_1' })
    const values = writtenValues()
    expect(values.stock_movement_unit_cost).toBe(4443)
    expect(values.stock_movement_extended_cost).toBe(44430)
  })

  it('returns exactly what it stored', async () => {
    h.vendorTerms = { unitPrice: 4133, tariffRate: 7.5 }
    const result = await receiveStock(db, ORG, USER, {
      partId: 'part_1',
      quantity: 10,
      vendorPartId: 'vp_1',
    })
    expect(result._unsafeUnwrap()).toMatchObject({
      movementId: 'mv_1',
      recordId: 'def_mv:mv_1',
      partInstanceId: 'part_1',
      quantity: 10,
      unitCost: 4443,
      extendedCost: 44430,
      vendorUnitPrice: 4133,
      vendorPartId: 'vp_1',
      glAccount: 'inventory_raw_materials',
      purchaseOrderLineId: null,
    })
  })
})

describe('receiveStock — step 4, the movement it writes', () => {
  it('writes ONE movement, on the stock_movement definition', async () => {
    await receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 10, unitCost: 4400 })
    expect(h.createSpy).toHaveBeenCalledTimes(1)
    expect(h.createSpy.mock.calls[0]![0]).toBe('def_mv')
  })

  it('is a positive `receive` against the part', async () => {
    const values = await receiveAndRead({ partId: 'part_1', quantity: 10, unitCost: 4400 })
    expect(values.stock_movement_type).toBe('receive')
    expect(values.stock_movement_quantity).toBe(10)
    expect(values.stock_movement_part).toBe('def_part:part_1')
  })

  it('NEVER sets adjustSubparts', async () => {
    // Load-bearing. explodeBomMovement inherits the parent's type AND sign, so
    // a receipt with the flag set would create a `receive` for every descendant:
    // receiving 10 motors would add 10 of every screw inside them.
    const values = await receiveAndRead({ partId: 'part_1', quantity: 10, unitCost: 4400 })
    expect(values.stock_movement_adjust_subparts).toBe(false)
  })

  it('keeps adjustSubparts false for a part that has a BOM and a large quantity', async () => {
    h.partKind = 'finished_good'
    const values = await receiveAndRead({ partId: 'part_1', quantity: 1000, unitCost: 4400 })
    expect(values.stock_movement_adjust_subparts).toBe(false)
  })

  it('stamps costBasis `actual` — a receipt is the first writer of it', async () => {
    const values = await receiveAndRead({ partId: 'part_1', quantity: 1, unitCost: 4400 })
    expect(values.stock_movement_cost_basis).toBe('actual')
  })

  it('stamps the GL account resolved from the part kind', async () => {
    h.partKind = 'finished_good'
    const values = await receiveAndRead({ partId: 'part_1', quantity: 1, unitCost: 4400 })
    expect(values.stock_movement_gl_account).toBe('inventory_finished_goods')
  })

  it('stamps raw materials for an unclassified part', async () => {
    h.partKind = null
    const values = await receiveAndRead({ partId: 'part_1', quantity: 1, unitCost: 4400 })
    expect(values.stock_movement_gl_account).toBe('inventory_raw_materials')
  })

  it('stamps the supplied accounting date, not the moment it was keyed', async () => {
    const occurredAt = new Date('2026-01-04T09:30:00.000Z')
    const values = await receiveAndRead({
      partId: 'part_1',
      quantity: 1,
      unitCost: 4400,
      occurredAt,
    })
    expect(values.stock_movement_occurred_at).toBe('2026-01-04T09:30:00.000Z')
  })

  it('defaults the accounting date to now when none is given', async () => {
    const before = Date.now()
    const values = await receiveAndRead({ partId: 'part_1', quantity: 1, unitCost: 4400 })
    const stamped = new Date(values.stock_movement_occurred_at as string).getTime()
    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(stamped).toBeLessThanOrEqual(Date.now())
  })

  it('links the supplier part and the purchase order line when given', async () => {
    h.vendorTerms = { unitPrice: 4000 }
    const values = await receiveAndRead({
      partId: 'part_1',
      quantity: 1,
      unitCost: 4400,
      vendorPartId: 'vp_1',
      purchaseOrderLineId: 'pol_1',
    })
    expect(values.stock_movement_vendor_part).toBe('def_vp:vp_1')
    expect(values.stock_movement_purchase_order_line).toBe('def_pol:pol_1')
  })

  it('omits the relations that were not supplied', async () => {
    const values = await receiveAndRead({ partId: 'part_1', quantity: 1, unitCost: 4400 })
    expect(values).not.toHaveProperty('stock_movement_vendor_part')
    expect(values).not.toHaveProperty('stock_movement_purchase_order_line')
  })

  it('carries the reference and the reason through', async () => {
    const values = await receiveAndRead({
      partId: 'part_1',
      quantity: 1,
      unitCost: 4400,
      reference: 'PS-88213',
      reason: 'Short shipment, remainder to follow',
    })
    expect(values.stock_movement_reference).toBe('PS-88213')
    expect(values.stock_movement_reason).toBe('Short shipment, remainder to follow')
  })

  it('fails cleanly when a purchase order line is referenced before phase 3 ships', async () => {
    h.defs.delete('purchase_order_line')
    const error = await expectErr(
      receiveStock(db, ORG, USER, {
        partId: 'part_1',
        quantity: 1,
        unitCost: 4400,
        purchaseOrderLineId: 'pol_1',
      })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
  })

  it('fails with NotFound when the org has no stock_movement definition', async () => {
    h.defs.delete('stock_movement')
    const error = await expectErr(
      receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 1, unitCost: 4400 })
    )
    expect(error).toBeInstanceOf(NotFoundError)
  })

  it('adds no trigger of its own — QoH is left to the existing rule', async () => {
    // The write is a single `create`; nothing else is called. If this module
    // ever recalculated QoH itself the number would have two owners.
    await receiveStock(db, ORG, USER, { partId: 'part_1', quantity: 10, unitCost: 4400 })
    expect(h.createSpy).toHaveBeenCalledTimes(1)
  })
})

async function receiveAndRead(
  input: Parameters<typeof receiveStock>[3]
): Promise<Record<string, unknown>> {
  const result = await receiveStock(db, ORG, USER, input)
  expect(result.isOk()).toBe(true)
  return writtenValues()
}
