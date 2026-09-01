// packages/lib/src/receiving/__tests__/adjust-stock.test.ts
// The hand-keyed count correction — the third movement writer. The org cache,
// the CRUD handler and the two part reads are mocked, so nothing here needs a
// database.
//
// What is asserted is the CONTRACT after decision `G12`, which reversed both of
// the asymmetries the first version of this file pinned:
//
//   - a POSITIVE adjustment no longer takes a caller-supplied `unitCost` and no
//     longer stamps `cost_basis: actual`. An adjustment has no supplier row, no
//     purchase order and no packing slip, so there is no ACTUAL to record; the
//     server reads the part's frozen `part_standard_cost`.
//   - a NEGATIVE adjustment no longer stamps NOTHING. A shrinkage carrying no
//     cost is invisible to every period total that sums the ledger, so the L1
//     month-end assertion absorbed it into the COGS plug — precisely the
//     separation `G12` exists to get.
//
// And the refusal that replaces the old zero-cost one: a part with no standard
// cost fails CLOSED, naming the part, and never falls back to `part_cost`.

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
  /** What `readPartStandardCost` answers. `null` = the part was never rolled. */
  standardCost: 4400 as number | null,
  displayName: 'Widget 9000' as string | null,
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
    readPartStandardCost: vi.fn(async () =>
      ok({ standardCost: h.standardCost, displayName: h.displayName })
    ),
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

/** The four fields a costed movement must stamp — now in BOTH directions. */
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
  h.standardCost = 4400
  h.displayName = 'Widget 9000'
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
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 0 }))
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
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('runs the quantity guard before anything else', async () => {
    // No defs at all: if the quantity check ran second this would surface as a
    // NotFound and the caller would fix the wrong problem.
    h.defs = new Map()
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 0 }))
    expect(error).toBeInstanceOf(BadRequestError)
  })

  it('fails with NotFound when the org has no stock_movement definition', async () => {
    h.defs.delete('stock_movement')
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 }))
    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })
})

describe('adjustStock — every adjustment carries the part standard cost', () => {
  it.each([5, -3])('stamps all four cost fields (quantity %s)', async (quantity) => {
    // The defect in one assertion: this is what the popover's `record.create`
    // wrote none of, and what the NEGATIVE branch still wrote none of before
    // `G12`.
    const values = await adjustAndRead({ partId: 'part_1', quantity })
    for (const field of COST_FIELDS) expect(values).toHaveProperty(field)
    expect(values.stock_movement_unit_cost).toBe(4400)
    expect(values.stock_movement_gl_account).toBe('inventory_raw_materials')
  })

  // 🛑 `standard`, never `actual`. An adjustment has no supplier and no invoice,
  // so there is no actual to record — the number is the part's own frozen
  // standard cost, read by the server.
  it.each([5, -3])('stamps cost_basis STANDARD (quantity %s)', async (quantity) => {
    const values = await adjustAndRead({ partId: 'part_1', quantity })
    expect(values.stock_movement_cost_basis).toBe('standard')
  })

  it('signs the extended cost like the quantity, so a removal nets out', async () => {
    expect(
      (await adjustAndRead({ partId: 'part_1', quantity: 5 })).stock_movement_extended_cost
    ).toBe(22000)
    h.createSpy.mockClear()
    expect(
      (await adjustAndRead({ partId: 'part_1', quantity: -3 })).stock_movement_extended_cost
    ).toBe(-13200)
  })

  it('keeps a fractional standard cost at RATE precision, not rounded to a whole cent', async () => {
    h.standardCost = 4442.975
    const values = await adjustAndRead({ partId: 'part_1', quantity: 10 })
    expect(values.stock_movement_unit_cost).toBe(4442.975)
    // Rounded AFTER multiplying, never as a sum of rounded units. This IS an
    // AMOUNT, so it still collapses to a whole minor unit.
    expect(values.stock_movement_extended_cost).toBe(44430)
  })

  it('stamps the GL account resolved from the part kind', async () => {
    h.partKind = 'finished_good'
    const values = await adjustAndRead({ partId: 'part_1', quantity: 1 })
    expect(values.stock_movement_gl_account).toBe('inventory_finished_goods')
  })

  // The caller has no say in the valuation at all. There is no `unitCost` on
  // `AdjustStockInput`, and an object carrying one must not reach the ledger.
  it('ignores anything a caller tries to say about cost', async () => {
    const values = await adjustAndRead({
      partId: 'part_1',
      quantity: 5,
      // @ts-expect-error — `unitCost` was removed from AdjustStockInput by `G12`
      unitCost: 999_999,
    })
    expect(values.stock_movement_unit_cost).toBe(4400)
  })
})

describe('adjustStock — a part with no standard cost fails CLOSED', () => {
  it.each([5, -3])('refuses (quantity %s) and writes nothing', async (quantity) => {
    h.standardCost = null
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  // 🛑 An error naming a cuid is unactionable when the form is showing a name.
  it('names the part in the refusal', async () => {
    h.standardCost = null
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 }))
    expect(error.message).toContain('Widget 9000')
    expect(error.message).toMatch(/standard cost/i)
  })

  it('falls back to the part id when the part has no display name', async () => {
    h.standardCost = null
    h.displayName = null
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 }))
    expect(error.message).toContain('part_1')
  })

  // 🛑 HANDOFF rule 2: `part_cost` is LIVE REPLACEMENT cost, rewritten on every
  // vendor-price change, and must never value a movement. The refusal says so,
  // because "no standard cost" invites exactly that fix.
  it('says why the live part cost is not an acceptable substitute', async () => {
    h.standardCost = null
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 }))
    expect(error.message).toMatch(/replacement price/i)
  })

  it('refuses a standard cost that STILL rounds to zero at five places, rather than storing the zero', async () => {
    // 0.4 of a cent used to round to zero at whole-cent precision and was
    // refused; it is now a legitimate RATE (0.0001 is the value that actually
    // rounds to zero at RATE_DECIMALS).
    h.standardCost = 0.0001
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/rounds to zero/i)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('accepts a sub-cent standard cost that used to round to zero, at five places', async () => {
    h.standardCost = 0.4
    const values = await adjustAndRead({ partId: 'part_1', quantity: 5 })
    expect(values.stock_movement_unit_cost).toBe(0.4)
    expect(values.stock_movement_extended_cost).toBe(2) // round(0.4 x 5)
  })

  it('refuses a negative standard cost', async () => {
    h.standardCost = -100
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses a non-finite standard cost', async () => {
    h.standardCost = Number.POSITIVE_INFINITY
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  // Both directions now stamp cost fields, so the pre-flight applies to both.
  // Before `G12` a removal wrote none of them and was allowed through.
  it.each([
    5, -3,
  ])('refuses to write before the cost fields are provisioned (quantity %s)', async (quantity) => {
    h.materialised.delete('stock_movement_unit_cost')
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })
})

describe('adjustStock — the movement it writes', () => {
  it('writes ONE movement, on the stock_movement definition', async () => {
    await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 })
    expect(h.createSpy).toHaveBeenCalledTimes(1)
    expect(h.createSpy.mock.calls[0]![0]).toBe('def_mv')
  })

  it('is an `adjust` against the part', async () => {
    const values = await adjustAndRead({ partId: 'part_1', quantity: 5 })
    expect(values.stock_movement_type).toBe('adjust')
    expect(values.stock_movement_part).toBe('def_part:part_1')
  })

  it.each([5, -5])('NEVER sets adjustSubparts (quantity %s)', async (quantity) => {
    // Load-bearing. explodeBomMovement inherits the parent's type AND sign, so
    // "add 10" of a finished good would raise every component's stock too.
    const values = await adjustAndRead({ partId: 'part_1', quantity })
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
    const result = await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 })
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
    h.standardCost = 4442.975
    const result = await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 10 })
    expect(result._unsafeUnwrap()).toMatchObject({
      movementId: 'mv_1',
      recordId: 'def_mv:mv_1',
      partInstanceId: 'part_1',
      quantity: 10,
      unitCost: 4442.975,
      extendedCost: 44430,
      glAccount: 'inventory_raw_materials',
    })
  })

  it('returns the negative extended cost of a removal', async () => {
    const result = await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: -3 })
    expect(result._unsafeUnwrap()).toMatchObject({
      quantity: -3,
      unitCost: 4400,
      extendedCost: -13200,
      glAccount: 'inventory_raw_materials',
    })
  })

  it('adds no trigger of its own — QoH is left to the existing rule', async () => {
    await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 })
    expect(h.createSpy).toHaveBeenCalledTimes(1)
  })
})
