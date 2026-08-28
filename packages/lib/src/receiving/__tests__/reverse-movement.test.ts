// packages/lib/src/receiving/__tests__/reverse-movement.test.ts
// The correction path. The org cache and the CRUD handler are mocked with the
// same doubles `receive-stock.test.ts` uses, and the three reads are served by a
// db stand-in that routes on table identity — so nothing here needs a database.
//
// What is asserted is the CONTRACT: the quantity is negated, the ORIGINAL's
// frozen unit cost is carried verbatim, the purchase order line is copied (which
// is what rolls `quantityReceived` back), and the two refusals that keep the
// ledger honest — a movement is reversed at most once, and a reversal is never
// itself reversed.
//
// ⚠️ `src/test/setup.ts` mocks `@auxx/database` wholesale, so `schema.Foo` is a
// memoized `{}` and its COLUMNS are `undefined`. Table identity therefore works
// (`.from(schema.FieldValue)` is comparable by reference, which is how the db
// double routes the three reads) but no assertion can name a column.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../../errors'

/** One stored `FieldValue`, in the projection `reverse-movement.ts` selects. */
interface ValueRow {
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  optionId: string | null
  relatedEntityId: string | null
}

const h = vi.hoisted(() => ({
  createSpy: vi.fn(async (_defId: string, _values: Record<string, unknown>) => ({
    instance: { id: 'mv_rev' },
  })),
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  /** The `EntityInstance` existence probe. Empty models "no such movement". */
  instanceRows: [] as { id: string }[],
  /** The original movement's stored field values. */
  valueRows: [] as ValueRow[],
  /** The "is it already reversed?" probe. Non-empty models a standing reversal. */
  reversalRows: [] as { id: string }[],
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

import { reverseMovement } from '../reverse-movement'

const ORG = 'org_1'
const USER = 'user_1'
const MOVEMENT = 'mv_1'

/** Every systemAttribute a fully migrated org has for this path. */
const ALL_MOVEMENT_ATTRS = [
  'stock_movement_part',
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_cost_basis',
  'stock_movement_unit_cost',
  'stock_movement_gl_account',
  'stock_movement_vendor_unit_price',
  'stock_movement_vendor_part',
  'stock_movement_purchase_order_line',
  'stock_movement_reverses_movement',
]

/**
 * A db stand-in for the three reads the module makes, routed by table identity:
 * `.from(EntityInstance)` is the existence probe, `.from(FieldValue)` alone is
 * the value read, and `.from(FieldValue).innerJoin(EntityInstance)` is the
 * already-reversed probe.
 */
const db = {
  select: () => {
    const state = { table: null as unknown, joined: false }
    const rows = () => {
      if (state.table === schema.EntityInstance) return h.instanceRows
      if (state.joined) return h.reversalRows
      return h.valueRows
    }
    // `where()` returns a real Promise carrying a `limit`, rather than a hand-
    // rolled thenable: one read is awaited straight off `where()` and two go on
    // to `.limit(1)`, and an object with its own `then` is both a lint error and
    // a trap the moment anything else awaits the chain.
    const chain: Record<string, unknown> = {
      from: (table: unknown) => {
        state.table = table
        return chain
      },
      innerJoin: () => {
        state.joined = true
        return chain
      },
      where: () => Object.assign(Promise.resolve(rows()), { limit: () => Promise.resolve(rows()) }),
    }
    return chain
  },
} as never

function value(attr: string, over: Partial<ValueRow>): ValueRow {
  return {
    fieldId: `fld_${attr}`,
    valueText: null,
    valueNumber: null,
    optionId: null,
    relatedEntityId: null,
    ...over,
  }
}

/**
 * A fully costed `receive` of 10 units at 4443c against `pol_1`, as
 * `receiveStock` would have written it. Attributes named in `omit` are dropped,
 * which models a movement that never carried them.
 */
function originalReceipt(
  over: Partial<Record<string, ValueRow>> = {},
  omit: string[] = []
): ValueRow[] {
  const rows: Record<string, ValueRow> = {
    stock_movement_part: value('stock_movement_part', { relatedEntityId: 'part_1' }),
    stock_movement_type: value('stock_movement_type', { optionId: 'receive' }),
    stock_movement_quantity: value('stock_movement_quantity', { valueNumber: 10 }),
    stock_movement_cost_basis: value('stock_movement_cost_basis', { optionId: 'actual' }),
    stock_movement_unit_cost: value('stock_movement_unit_cost', { valueNumber: 4443 }),
    stock_movement_gl_account: value('stock_movement_gl_account', {
      valueText: 'inventory_raw_materials',
    }),
    stock_movement_vendor_unit_price: value('stock_movement_vendor_unit_price', {
      valueNumber: 4133,
    }),
    stock_movement_vendor_part: value('stock_movement_vendor_part', { relatedEntityId: 'vp_1' }),
    stock_movement_purchase_order_line: value('stock_movement_purchase_order_line', {
      relatedEntityId: 'pol_1',
    }),
    ...over,
  }
  for (const attr of omit) delete rows[attr]
  return Object.values(rows)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.materialised = new Set(ALL_MOVEMENT_ATTRS)
  h.defs = new Map([
    ['part', 'def_part'],
    ['stock_movement', 'def_mv'],
    ['vendor_part', 'def_vp'],
    ['purchase_order_line', 'def_pol'],
  ])
  h.instanceRows = [{ id: MOVEMENT }]
  h.valueRows = originalReceipt()
  h.reversalRows = []
  h.createSpy.mockResolvedValue({ instance: { id: 'mv_rev' } })
})

/** The value bag handed to `UnifiedCrudHandler.create` on the single write. */
function writtenValues(): Record<string, unknown> {
  expect(h.createSpy).toHaveBeenCalledTimes(1)
  return h.createSpy.mock.calls[0]![1]
}

async function expectErr(promise: ReturnType<typeof reverseMovement>) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

async function reverseAndRead(
  input: Parameters<typeof reverseMovement>[3] = { movementId: MOVEMENT }
): Promise<Record<string, unknown>> {
  const result = await reverseMovement(db, ORG, USER, input)
  expect(result.isOk()).toBe(true)
  return writtenValues()
}

describe('reverseMovement — the row it writes', () => {
  it('writes ONE movement, on the stock_movement definition', async () => {
    await reverseAndRead()
    expect(h.createSpy).toHaveBeenCalledTimes(1)
    expect(h.createSpy.mock.calls[0]![0]).toBe('def_mv')
  })

  it('negates the original quantity', async () => {
    expect((await reverseAndRead()).stock_movement_quantity).toBe(-10)
  })

  it('🛑 carries the ORIGINAL frozen unit cost, never a fresh one', async () => {
    // The whole point. A reversal valued at today's price nets a receipt and its
    // undo to a non-zero amount of inventory value out of nothing.
    expect((await reverseAndRead()).stock_movement_unit_cost).toBe(4443)
  })

  it('recomputes the extended cost so it is signed like the quantity', async () => {
    // The subledger sums to the inventory balance because of that sign, not in
    // spite of it.
    expect((await reverseAndRead()).stock_movement_extended_cost).toBe(-44430)
  })

  it('copies the purchase order line, which is what rolls quantityReceived back', async () => {
    expect((await reverseAndRead()).stock_movement_purchase_order_line).toBe('def_pol:pol_1')
  })

  it('points reversesMovement at the row it undoes', async () => {
    expect((await reverseAndRead()).stock_movement_reverses_movement).toBe('def_mv:mv_1')
  })

  it('copies the GL account, the vendor price, the vendor part and the part', async () => {
    const values = await reverseAndRead()
    expect(values.stock_movement_gl_account).toBe('inventory_raw_materials')
    expect(values.stock_movement_vendor_unit_price).toBe(4133)
    expect(values.stock_movement_vendor_part).toBe('def_vp:vp_1')
    expect(values.stock_movement_part).toBe('def_part:part_1')
  })

  it("carries the original's cost basis rather than re-deciding it", async () => {
    expect((await reverseAndRead()).stock_movement_cost_basis).toBe('actual')
  })

  it('NEVER sets adjustSubparts', async () => {
    // Load-bearing. explodeBomMovement inherits the parent's type AND sign, so a
    // reversal with the flag set would explode the negation across the BOM.
    expect((await reverseAndRead()).stock_movement_adjust_subparts).toBe(false)
  })

  it('stamps the reason when one is given, and omits it otherwise', async () => {
    const withReason = await reverseAndRead({ movementId: MOVEMENT, reason: 'Keyed twice' })
    expect(withReason.stock_movement_reason).toBe('Keyed twice')

    h.createSpy.mockClear()
    expect(await reverseAndRead()).not.toHaveProperty('stock_movement_reason')
  })

  it('stamps the accounting date as now', async () => {
    const before = Date.now()
    const stamped = new Date(
      (await reverseAndRead()).stock_movement_occurred_at as string
    ).getTime()
    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(stamped).toBeLessThanOrEqual(Date.now())
  })

  it('omits the relations the original did not carry', async () => {
    h.valueRows = originalReceipt({}, [
      'stock_movement_vendor_part',
      'stock_movement_purchase_order_line',
      'stock_movement_vendor_unit_price',
    ])
    const values = await reverseAndRead()
    expect(values).not.toHaveProperty('stock_movement_vendor_part')
    expect(values).not.toHaveProperty('stock_movement_purchase_order_line')
    expect(values).not.toHaveProperty('stock_movement_vendor_unit_price')
  })

  it('returns exactly what it stored', async () => {
    const result = await reverseMovement(db, ORG, USER, { movementId: MOVEMENT })
    expect(result._unsafeUnwrap()).toMatchObject({
      movementId: 'mv_rev',
      recordId: 'def_mv:mv_rev',
      partInstanceId: 'part_1',
      quantity: -10,
      unitCost: 4443,
      extendedCost: -44430,
      vendorUnitPrice: 4133,
      vendorPartId: 'vp_1',
      glAccount: 'inventory_raw_materials',
      purchaseOrderLineId: 'pol_1',
    })
  })
})

describe('reverseMovement — the type it writes', () => {
  it('undoes a receipt as a return_out — the goods go back out the door', async () => {
    expect((await reverseAndRead()).stock_movement_type).toBe('return_out')
  })

  it.each([
    ['ship', 'return_in'],
    ['sale', 'return_in'],
    ['return_out', 'return_in'],
    ['return_in', 'return_out'],
  ])('mirrors a %s as a %s', async (original, expected) => {
    h.valueRows = originalReceipt({
      stock_movement_type: value('stock_movement_type', { optionId: original }),
    })
    expect((await reverseAndRead()).stock_movement_type).toBe(expected)
  })

  it.each([
    'adjust',
    'scrap',
    'initial',
    'build_consume',
    'build_produce',
  ])('labels the undo of a %s as an adjust rather than inventing an event', async (original) => {
    // Undoing a build_consume is not a production run, and there is no
    // "unscrap". `adjust` is the honest label — and unlike a hand-keyed
    // adjustment this one carries the original's frozen cost.
    h.valueRows = originalReceipt({
      stock_movement_type: value('stock_movement_type', { optionId: original }),
    })
    expect((await reverseAndRead()).stock_movement_type).toBe('adjust')
  })
})

describe('reverseMovement — the refusals', () => {
  it('🛑 refuses a movement that has ALREADY been reversed', async () => {
    // Double-reversal would decrement quantityReceived twice off one mistake,
    // and because the roll-up re-SUMs rather than increments, the wrong number
    // would look exactly as authoritative as the right one.
    h.reversalRows = [{ id: 'mv_existing_reversal' }]
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(ConflictError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses to reverse a reversal', async () => {
    // The correction of an over-correction is a fresh receipt or adjustment, not
    // a chain of undos.
    h.valueRows = originalReceipt({
      stock_movement_reverses_movement: value('stock_movement_reverses_movement', {
        relatedEntityId: 'mv_original',
      }),
    })
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('fails with NotFound when the movement does not exist in this org', async () => {
    h.instanceRows = []
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: 'mv_missing' }))
    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('fails with NotFound when the org has no stock_movement definition', async () => {
    h.defs.delete('stock_movement')
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses a movement carrying no frozen unit cost', async () => {
    // A hand-keyed stock adjustment, or a pre-migration row. There is no cost to
    // preserve and writing the negation at zero is worse than writing nothing.
    h.valueRows = originalReceipt({}, ['stock_movement_unit_cost'])
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses a movement carrying a cost but no GL account', async () => {
    h.valueRows = originalReceipt({}, ['stock_movement_gl_account'])
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses a movement with no quantity to reverse', async () => {
    h.valueRows = originalReceipt({
      stock_movement_quantity: value('stock_movement_quantity', { valueNumber: 0 }),
    })
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses before entity migration 108 has provisioned reversesMovement', async () => {
    // Without it there is nothing to record WHAT the row undoes, and therefore
    // no way to refuse the second reversal.
    h.materialised.delete('stock_movement_reverses_movement')
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('fails cleanly when the org has no purchase_order_line definition', async () => {
    h.defs.delete('purchase_order_line')
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
  })
})
