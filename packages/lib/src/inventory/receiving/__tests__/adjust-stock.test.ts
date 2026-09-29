// packages/lib/src/inventory/receiving/__tests__/adjust-stock.test.ts
// The hand-keyed count correction — the third movement writer. The write seam
// and the two part reads are mocked, so nothing here needs a database.
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
// And what replaces the old zero-cost refusal: a part with no standard cost
// writes a PENDING row with no cost keys and parks at stage `price` (111 Q18);
// it never falls back to `part_cost` and never writes a zero.

import type { CreateStockMovementInput } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, UnprocessableEntityError } from '../../../errors'
import { fakeSeam } from './support/fake-seam'

const h = vi.hoisted(() => ({
  partKind: null as string | null,
  /** What `readPartStandardCost` answers. `null` = the part was never rolled. */
  standardCost: 4400 as number | null,
  displayName: 'Widget 9000' as string | null,
  upsertWorkItem: vi.fn(async () => ({ isOk: () => true })),
}))

vi.mock('../../../accounting/work-items/write', () => ({
  upsertWorkItem: h.upsertWorkItem,
}))

vi.mock('../../movements', async (importOriginal) =>
  (await import('./support/fake-seam')).movementsMock(importOriginal)
)

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
// The write and its posting share one transaction, so the stub has to run it.
const db = { transaction: async (fn: (tx: unknown) => unknown) => fn(db) } as never

/** The four cost columns a costed movement must stamp — now in BOTH directions. */
const COST_FIELDS = ['unitCostMinor', 'extendedCostMinor', 'glRole', 'costBasis'] as const

beforeEach(() => {
  vi.clearAllMocks()
  fakeSeam.reset()
  h.partKind = null
  h.standardCost = 4400
  h.displayName = 'Widget 9000'
})

/** The row handed to the write seam on the single write. */
function writtenValues(): CreateStockMovementInput {
  return fakeSeam.only()
}

async function expectErr(promise: ReturnType<typeof adjustStock>) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

async function adjustAndRead(
  input: Parameters<typeof adjustStock>[3]
): Promise<CreateStockMovementInput> {
  const result = await adjustStock(db, ORG, USER, input)
  expect(result.isOk()).toBe(true)
  return writtenValues()
}

describe('adjustStock — step 1, the quantity guard', () => {
  it('refuses a zero adjustment rather than writing a row that changes nothing', async () => {
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 0 }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(fakeSeam.rows).toHaveLength(0)
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
    expect(fakeSeam.rows).toHaveLength(0)
  })

  it('runs the quantity guard before anything else', async () => {
    h.partKind = 'service'
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 0 }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(error.message).toMatch(/zero/)
  })
})

describe('adjustStock — every adjustment carries the part standard cost', () => {
  it.each([5, -3])('stamps all four cost fields (quantity %s)', async (quantity) => {
    // The defect in one assertion: this is what the popover's `record.create`
    // wrote none of, and what the NEGATIVE branch still wrote none of before
    // `G12`.
    const values = await adjustAndRead({ partId: 'part_1', quantity })
    for (const field of COST_FIELDS) expect(values[field]).not.toBeNull()
    expect(values.unitCostMinor).toBe(4400)
    expect(values.glRole).toBe('inventory_raw_materials')
  })

  // 🛑 `standard`, never `actual`. An adjustment has no supplier and no invoice,
  // so there is no actual to record — the number is the part's own frozen
  // standard cost, read by the server.
  it.each([5, -3])('stamps cost_basis STANDARD (quantity %s)', async (quantity) => {
    const values = await adjustAndRead({ partId: 'part_1', quantity })
    expect(values.costBasis).toBe('standard')
  })

  it('signs the extended cost like the quantity, so a removal nets out', async () => {
    expect((await adjustAndRead({ partId: 'part_1', quantity: 5 })).extendedCostMinor).toBe(22000)
    fakeSeam.reset()
    expect((await adjustAndRead({ partId: 'part_1', quantity: -3 })).extendedCostMinor).toBe(-13200)
  })

  it('keeps a fractional standard cost at RATE precision, not rounded to a whole cent', async () => {
    h.standardCost = 4442.975
    const values = await adjustAndRead({ partId: 'part_1', quantity: 10 })
    expect(values.unitCostMinor).toBe(4442.975)
    // Rounded AFTER multiplying, never as a sum of rounded units. This IS an
    // AMOUNT, so it still collapses to a whole minor unit.
    expect(values.extendedCostMinor).toBe(44430)
  })

  it('stamps the GL account resolved from the part kind', async () => {
    h.partKind = 'finished_good'
    const values = await adjustAndRead({ partId: 'part_1', quantity: 1 })
    expect(values.glRole).toBe('inventory_finished_goods')
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
    expect(values.unitCostMinor).toBe(4400)
  })
})

describe('adjustStock — a part with no standard cost writes PENDING (111 Q18)', () => {
  it.each([
    5, -3,
  ])('writes the row with no cost keys and basis pending (quantity %s)', async (quantity) => {
    h.standardCost = null
    const values = await adjustAndRead({ partId: 'part_1', quantity })
    expect(values.quantity).toBe(quantity)
    expect(values.costBasis).toBe('pending')
    // Absent, never 0: a zero would read as a valuation.
    expect(values.unitCostMinor).toBeNull()
    expect(values.extendedCostMinor).toBeNull()
    // The account is known now, whatever the cost turns out to be.
    expect(values.glRole).toBe('inventory_raw_materials')
  })

  it('parks the movement at stage price, grouped by the part it needs a cost for', async () => {
    h.standardCost = null
    await adjustAndRead({ partId: 'part_1', quantity: 5 })
    expect(h.upsertWorkItem).toHaveBeenCalledTimes(1)
    expect(h.upsertWorkItem).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'stock_movement',
      sourceId: 'mv_1',
      stage: 'price',
      reasonCode: 'STANDARD_COST_MISSING',
      externalRef: 'part_1',
      detail: { partIds: ['part_1'], pendingMovementIds: ['mv_1'], partName: 'Widget 9000' },
    })
  })

  it('omits the part name from the park when the part has none', async () => {
    h.standardCost = null
    h.displayName = null
    await adjustAndRead({ partId: 'part_1', quantity: 5 })
    const [, , item] = h.upsertWorkItem.mock.calls[0]! as unknown as [
      unknown,
      unknown,
      { detail: object },
    ]
    expect(item.detail).not.toHaveProperty('partName')
  })

  it('returns the pending row with null costs, never zero', async () => {
    h.standardCost = null
    const result = await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 })
    expect(result._unsafeUnwrap()).toMatchObject({ unitCost: null, extendedCost: null })
  })

  it('does not park a priced adjustment', async () => {
    await adjustAndRead({ partId: 'part_1', quantity: 5 })
    expect(h.upsertWorkItem).not.toHaveBeenCalled()
  })

  it('refuses a standard cost that STILL rounds to zero at five places, rather than storing the zero', async () => {
    // 0.4 of a cent used to round to zero at whole-cent precision and was
    // refused; it is now a legitimate RATE (0.0001 is the value that actually
    // rounds to zero at RATE_DECIMALS).
    h.standardCost = 0.0001
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/rounds to zero/i)
    expect(fakeSeam.rows).toHaveLength(0)
  })

  it('accepts a sub-cent standard cost that used to round to zero, at five places', async () => {
    h.standardCost = 0.4
    const values = await adjustAndRead({ partId: 'part_1', quantity: 5 })
    expect(values.unitCostMinor).toBe(0.4)
    expect(values.extendedCostMinor).toBe(2) // round(0.4 x 5)
  })

  // The reader has already dropped an origin-less legacy zero, so a 0 here is deliberate (103 §5a).
  it('adjusts a part standing at a $0 standard at $0', async () => {
    h.standardCost = 0
    const values = await adjustAndRead({ partId: 'part_1', quantity: 5 })
    expect(values.unitCostMinor).toBe(0)
    expect(values.extendedCostMinor).toBe(0)
  })

  it('refuses a negative standard cost', async () => {
    h.standardCost = -100
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(fakeSeam.rows).toHaveLength(0)
  })

  it('refuses a non-finite standard cost', async () => {
    h.standardCost = Number.POSITIVE_INFINITY
    const error = await expectErr(adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(fakeSeam.rows).toHaveLength(0)
  })
})

describe('adjustStock — the movement it writes', () => {
  it('writes ONE movement and settles what it touched', async () => {
    await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 })
    expect(fakeSeam.rows).toHaveLength(1)
    expect(fakeSeam.settle).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ partIds: ['part_1'] })
    )
  })

  it('is an `adjust` against the part', async () => {
    const values = await adjustAndRead({ partId: 'part_1', quantity: 5 })
    expect(values.type).toBe('adjust')
    expect(values.partId).toBe('part_1')
  })

  it.each([5, -5])('NEVER sets adjustSubparts (quantity %s)', async (quantity) => {
    // Load-bearing. explodeBomMovement inherits the parent's type AND sign, so
    // "add 10" of a finished good would raise every component's stock too.
    const values = await adjustAndRead({ partId: 'part_1', quantity })
    expect(values.adjustSubparts).toBe(false)
  })

  it('carries the reason and the reference through', async () => {
    const values = await adjustAndRead({
      partId: 'part_1',
      quantity: -2,
      reason: 'Damaged goods',
      reference: 'RMA-567',
    })
    expect(values.reason).toBe('Damaged goods')
    expect(values.reference).toBe('RMA-567')
  })

  it('omits the reason and the reference when they are empty', async () => {
    const values = await adjustAndRead({ partId: 'part_1', quantity: -2 })
    expect(values.reason).toBeNull()
    expect(values.reference).toBeNull()
  })

  it('never links a supplier part or a purchase order line', async () => {
    // An adjustment is a count correction, not a purchase — which is exactly why
    // it cannot be used to fix a PO mistake.
    const result = await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 })
    const values = writtenValues()
    expect(values.vendorPartId).toBeNull()
    expect(values.purchaseOrderLineId).toBeNull()
    expect(result._unsafeUnwrap()).toMatchObject({
      vendorPartId: null,
      vendorUnitPrice: null,
      purchaseOrderLineId: null,
    })
  })

  it('stamps the supplied accounting date, not the moment it was keyed', async () => {
    const occurredAt = new Date('2026-01-04T09:30:00.000Z')
    const values = await adjustAndRead({ partId: 'part_1', quantity: -1, occurredAt })
    expect(values.occurredAt).toEqual(occurredAt)
  })

  it('defaults the accounting date to now when none is given', async () => {
    const before = Date.now()
    const values = await adjustAndRead({ partId: 'part_1', quantity: -1 })
    const stamped = (values.occurredAt as Date).getTime()
    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(stamped).toBeLessThanOrEqual(Date.now())
  })

  it('returns exactly what it stored', async () => {
    h.standardCost = 4442.975
    const result = await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 10 })
    expect(result._unsafeUnwrap()).toMatchObject({
      id: 'mv_1',
      partInstanceId: 'part_1',
      quantity: 10,
      unitCost: 4442.975,
      extendedCost: 44430,
      glRole: 'inventory_raw_materials',
    })
  })

  it('returns the negative extended cost of a removal', async () => {
    const result = await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: -3 })
    expect(result._unsafeUnwrap()).toMatchObject({
      quantity: -3,
      unitCost: 4400,
      extendedCost: -13200,
      glRole: 'inventory_raw_materials',
    })
  })
})

// The posting seam has its own test (`postings/__tests__/post-inventory-movement.test.ts`);
// this file is about the movements. `vi.mock` is hoisted, so placement is free.
vi.mock('../../../accounting/ledger/post/post-inventory-movement', () => ({
  postInventoryMovementInTx: async () => null,
  exportInventoryMovement: async () => null,
  inventoryTxnDate: (day: Date) => day.toISOString().slice(0, 10),
  reverseInventoryMovementPosting: async () => null,
  reversePostingForMovement: async () => null,
  linkMovementsToPosting: async () => undefined,
}))
