// packages/lib/src/receiving/__tests__/adjust-stock.test.ts
// The hand-keyed count correction — the third movement writer. The org cache,
// the CRUD handler and the part-kind read are mocked, so nothing here needs a
// database. What is asserted is the CONTRACT of section 1.5: a positive
// adjustment carries a cost or nothing is written, and a negative one is exactly
// as unencumbered as it was before this writer existed.

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
  }
})

import { adjustStock } from '../adjust-stock'

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
]

/** The four fields a costed movement must stamp, per section 1.5. */
const COST_FIELDS = [
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  'stock_movement_cost_basis',
] as const

beforeEach(() => {
  vi.clearAllMocks()
  h.materialised = new Set(ALL_MOVEMENT_ATTRS)
  h.defs = new Map([
    ['part', 'def_part'],
    ['stock_movement', 'def_mv'],
  ])
  h.partKind = null
  h.createSpy.mockResolvedValue({ instance: { id: 'mv_1' } })
})

/** The value bag handed to `UnifiedCrudHandler.create` on the single write. */
function writtenValues(): Record<string, unknown> {
  expect(h.createSpy).toHaveBeenCalledTimes(1)
  return h.createSpy.mock.calls[0]![1]
}

async function expectErr(promise: ReturnType<typeof adjustStock>) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

async function adjustAndRead(
  input: Parameters<typeof adjustStock>[3]
): Promise<Record<string, unknown>> {
  const result = await adjustStock(db, ORG, USER, input)
  expect(result.isOk()).toBe(true)
  return writtenValues()
}

describe('adjustStock — step 1, the quantity guard', () => {
  it('refuses a zero adjustment rather than writing a row that changes nothing', async () => {
    const error = await expectErr(
      adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 0, unitCost: 4400 })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('refuses a non-finite quantity (%s)', async (quantity) => {
    // Infinity survives Math.round into the doublePrecision column and poisons
    // every later SUM; NaN passes `=== 0` as false.
    const error = await expectErr(
      adjustStock(db, ORG, USER, { partId: 'part_1', quantity, unitCost: 4400 })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('runs the quantity guard before anything else', async () => {
    // No defs at all: if the quantity check ran second this would surface as a
    // NotFound and the caller would fix the wrong problem.
    h.defs = new Map()
    const error = await expectErr(
      adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 0, unitCost: 4400 })
    )
    expect(error).toBeInstanceOf(BadRequestError)
  })

  it('fails with NotFound when the org has no stock_movement definition', async () => {
    h.defs.delete('stock_movement')
    const error = await expectErr(
      adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5, unitCost: 4400 })
    )
    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })
})

describe('adjustStock — a POSITIVE adjustment must carry a cost', () => {
  it('stamps all four cost fields', async () => {
    // The defect in one assertion: this is what the popover's `record.create`
    // wrote none of.
    const values = await adjustAndRead({ partId: 'part_1', quantity: 5, unitCost: 4400 })
    for (const field of COST_FIELDS) expect(values).toHaveProperty(field)
    expect(values.stock_movement_unit_cost).toBe(4400)
    expect(values.stock_movement_extended_cost).toBe(22000)
    expect(values.stock_movement_gl_account).toBe('inventory_raw_materials')
    expect(values.stock_movement_cost_basis).toBe('actual')
  })

  it('🛑 refuses an addition with no cost at all, and writes nothing', async () => {
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses an explicit zero cost instead of defaulting it', async () => {
    const error = await expectErr(
      adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5, unitCost: 0 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/zero cost/i)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses a negative cost', async () => {
    const error = await expectErr(
      adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5, unitCost: -100 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses a sub-half-cent cost rather than storing the zero it rounds to', async () => {
    const error = await expectErr(
      adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5, unitCost: 0.4 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/zero cost/i)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses a non-finite cost', async () => {
    const error = await expectErr(
      adjustStock(db, ORG, USER, {
        partId: 'part_1',
        quantity: 5,
        unitCost: Number.POSITIVE_INFINITY,
      })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('rounds a fractional cost once, at the point of storage', async () => {
    const values = await adjustAndRead({ partId: 'part_1', quantity: 10, unitCost: 4442.975 })
    expect(values.stock_movement_unit_cost).toBe(4443)
    // Rounded AFTER multiplying, never as a sum of rounded units.
    expect(values.stock_movement_extended_cost).toBe(44430)
  })

  it('stamps the GL account resolved from the part kind', async () => {
    h.partKind = 'finished_good'
    const values = await adjustAndRead({ partId: 'part_1', quantity: 1, unitCost: 4400 })
    expect(values.stock_movement_gl_account).toBe('inventory_finished_goods')
  })

  it('refuses to write before the cost fields are provisioned', async () => {
    h.materialised.delete('stock_movement_unit_cost')
    const error = await expectErr(
      adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5, unitCost: 4400 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })
})

describe('adjustStock — a NEGATIVE adjustment carries no cost', () => {
  it('writes the removal with none of the four cost fields', async () => {
    // Deliberate asymmetry: a removal consumes value the ledger already carries,
    // and valuing it needs a costing method this system does not have.
    const values = await adjustAndRead({ partId: 'part_1', quantity: -3 })
    expect(values.stock_movement_quantity).toBe(-3)
    for (const field of COST_FIELDS) expect(values).not.toHaveProperty(field)
  })

  it('ignores a cost supplied on a removal rather than freezing a guess', async () => {
    const values = await adjustAndRead({ partId: 'part_1', quantity: -3, unitCost: 4400 })
    for (const field of COST_FIELDS) expect(values).not.toHaveProperty(field)
  })

  it('writes even when the cost fields are not provisioned at all', async () => {
    // A removal stamps none of them, so requiring them would block a correction
    // that needs nothing they provide.
    h.materialised = new Set()
    const values = await adjustAndRead({ partId: 'part_1', quantity: -3 })
    expect(values.stock_movement_quantity).toBe(-3)
  })

  it('reads no part kind, because it stamps no GL account', async () => {
    const { readPartKind } = await import('../receipt-queries')
    await adjustAndRead({ partId: 'part_1', quantity: -3 })
    expect(vi.mocked(readPartKind)).not.toHaveBeenCalled()
  })

  it('returns nulls for the cost it did not write', async () => {
    const result = await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: -3 })
    expect(result._unsafeUnwrap()).toMatchObject({
      movementId: 'mv_1',
      quantity: -3,
      unitCost: null,
      extendedCost: null,
      glAccount: null,
    })
  })
})

describe('adjustStock — the movement it writes', () => {
  it('writes ONE movement, on the stock_movement definition', async () => {
    await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5, unitCost: 4400 })
    expect(h.createSpy).toHaveBeenCalledTimes(1)
    expect(h.createSpy.mock.calls[0]![0]).toBe('def_mv')
  })

  it('is an `adjust` against the part', async () => {
    const values = await adjustAndRead({ partId: 'part_1', quantity: 5, unitCost: 4400 })
    expect(values.stock_movement_type).toBe('adjust')
    expect(values.stock_movement_part).toBe('def_part:part_1')
  })

  it.each([5, -5])('NEVER sets adjustSubparts (quantity %s)', async (quantity) => {
    // Load-bearing. explodeBomMovement inherits the parent's type AND sign, so
    // "add 10" of a finished good would raise every component's stock too.
    const values = await adjustAndRead({
      partId: 'part_1',
      quantity,
      ...(quantity > 0 ? { unitCost: 4400 } : {}),
    })
    expect(values.stock_movement_adjust_subparts).toBe(false)
  })

  it('carries the reason and the reference through', async () => {
    const values = await adjustAndRead({
      partId: 'part_1',
      quantity: -2,
      reason: 'Damaged goods',
      reference: 'RMA-567',
    })
    expect(values.stock_movement_reason).toBe('Damaged goods')
    expect(values.stock_movement_reference).toBe('RMA-567')
  })

  it('omits the reason and the reference when they are empty', async () => {
    const values = await adjustAndRead({ partId: 'part_1', quantity: -2 })
    expect(values).not.toHaveProperty('stock_movement_reason')
    expect(values).not.toHaveProperty('stock_movement_reference')
  })

  it('never links a supplier part or a purchase order line', async () => {
    // An adjustment is a count correction, not a purchase — which is exactly why
    // it cannot be used to fix a PO mistake.
    const result = await adjustStock(db, ORG, USER, {
      partId: 'part_1',
      quantity: 5,
      unitCost: 4400,
    })
    const values = writtenValues()
    expect(values).not.toHaveProperty('stock_movement_vendor_part')
    expect(values).not.toHaveProperty('stock_movement_purchase_order_line')
    expect(result._unsafeUnwrap()).toMatchObject({
      vendorPartId: null,
      vendorUnitPrice: null,
      purchaseOrderLineId: null,
    })
  })

  it('stamps the supplied accounting date, not the moment it was keyed', async () => {
    const occurredAt = new Date('2026-01-04T09:30:00.000Z')
    const values = await adjustAndRead({ partId: 'part_1', quantity: -1, occurredAt })
    expect(values.stock_movement_occurred_at).toBe('2026-01-04T09:30:00.000Z')
  })

  it('defaults the accounting date to now when none is given', async () => {
    const before = Date.now()
    const values = await adjustAndRead({ partId: 'part_1', quantity: -1 })
    const stamped = new Date(values.stock_movement_occurred_at as string).getTime()
    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(stamped).toBeLessThanOrEqual(Date.now())
  })

  it('returns exactly what it stored', async () => {
    const result = await adjustStock(db, ORG, USER, {
      partId: 'part_1',
      quantity: 10,
      unitCost: 4442.975,
    })
    expect(result._unsafeUnwrap()).toMatchObject({
      movementId: 'mv_1',
      recordId: 'def_mv:mv_1',
      partInstanceId: 'part_1',
      quantity: 10,
      unitCost: 4443,
      extendedCost: 44430,
      glAccount: 'inventory_raw_materials',
    })
  })

  it('adds no trigger of its own — QoH is left to the existing rule', async () => {
    await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5, unitCost: 4400 })
    expect(h.createSpy).toHaveBeenCalledTimes(1)
  })
})
