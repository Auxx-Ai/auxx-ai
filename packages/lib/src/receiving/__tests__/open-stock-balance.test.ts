// packages/lib/src/receiving/__tests__/open-stock-balance.test.ts
//
// The opening balance — the FOURTH movement writer, and the only one whose unit
// cost a caller is entitled to state (plans/money/tasks/15-costing-usability.md
// §2.2). The org cache, the CRUD handler, the two part reads and
// `ensureStandardCost` are mocked, so nothing here needs a database.
//
// What is pinned:
//
//   - one `initial` movement, at the TYPED cost, `cost_basis: standard`, with
//     the inventory role resolved from the part kind
//   - the standard cost is set BEFORE the movement is written, from the same
//     number, so the opening balance carries no variance
//   - 🛑 a part that already has ANY movement is refused. That guard is what
//     stops the create form becoming a back door into hand-valuing an
//     adjustment, since `initial` is the one type that takes a caller's cost
//   - zero and negative quantities and costs are refused, and nothing is written
//   - 🛑 `adjustStock` still has no unit-cost input. `G12` stands, and the
//     existence of a typed cost one file over must not be read as permission.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'

const h = vi.hoisted(() => ({
  createSpy: vi.fn(async (_defId: string, _values: Record<string, unknown>) => ({
    instance: { id: 'mv_1' },
  })),
  ensureSpy: vi.fn(),
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  partKind: null as string | null,
  /** What `readPartStandardCost` answers AFTER `ensureStandardCost` has run. */
  standardCost: null as number | null,
  displayName: 'Widget 9000' as string | null,
  /** Rows `assertPartHasNoMovements`' probe finds. Non-empty = already opened. */
  existingMovements: [] as { id: string }[],
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

vi.mock('../../builds/ensure-standard-cost', () => ({
  ensureStandardCost: h.ensureSpy,
}))

import { adjustStock } from '../adjust-stock'
import { openStockBalance } from '../open-stock-balance'
import type { AdjustStockInput } from '../types'

const ORG = 'org_1'
const USER = 'user_1'

/**
 * A drizzle chain that ends in whatever `assertPartHasNoMovements`' probe is
 * told to find. Every link returns itself, so the shape of the query is free to
 * change without the double having to know about it.
 */
const db = {
  select: () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.innerJoin = () => chain
    chain.where = () => chain
    chain.limit = async () => h.existingMovements
    return chain
  },
} as never

/** Every systemAttribute a fully migrated org has for this write path. */
const ALL_MOVEMENT_ATTRS = [
  'stock_movement_part',
  'stock_movement_unit_cost',
  'stock_movement_cost_basis',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  'stock_movement_occurred_at',
]

beforeEach(() => {
  vi.clearAllMocks()
  h.materialised = new Set(ALL_MOVEMENT_ATTRS)
  h.defs = new Map([
    ['part', 'def_part'],
    ['stock_movement', 'def_mv'],
  ])
  h.partKind = null
  h.displayName = 'Widget 9000'
  h.standardCost = null
  h.existingMovements = []
  h.createSpy.mockResolvedValue({ instance: { id: 'mv_1' } })
  // The real thing writes only where `part_standard_cost IS NULL`, and this door
  // always supplies a cost, so the part comes out holding the typed number.
  h.ensureSpy.mockImplementation(
    async (
      _db: unknown,
      _org: string,
      partIds: string[],
      source: { kind: string; unitCost?: number }
    ) => {
      const { ok } = await import('neverthrow')
      if (h.standardCost == null && source.unitCost != null) h.standardCost = source.unitCost
      return ok({ writtenPartIds: partIds })
    }
  )
})

/** The value bag handed to `UnifiedCrudHandler.create` on the single write. */
function writtenValues(): Record<string, unknown> {
  expect(h.createSpy).toHaveBeenCalledTimes(1)
  return h.createSpy.mock.calls[0]![1]
}

async function expectErr(promise: ReturnType<typeof openStockBalance>) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

async function openAndRead(
  input: Parameters<typeof openStockBalance>[3]
): Promise<Record<string, unknown>> {
  const result = await openStockBalance(db, ORG, USER, input)
  expect(result.isOk()).toBe(true)
  return writtenValues()
}

const OPENING = { partId: 'part_1', quantity: 10, unitCost: 1200 }

describe('openStockBalance — the one movement it writes', () => {
  it('writes exactly one movement, of type initial', async () => {
    const values = await openAndRead(OPENING)
    expect(values.stock_movement_type).toBe('initial')
    expect(values.stock_movement_quantity).toBe(10)
  })

  // 🛑 The typed number, not a server read. This is the one movement type where
  // that is correct: an opening balance IS what was paid for the stock on hand,
  // and there is no supplier row or packing slip to read it from.
  it('freezes the TYPED unit cost, and an extended cost signed like the quantity', async () => {
    const values = await openAndRead(OPENING)
    expect(values.stock_movement_unit_cost).toBe(1200)
    expect(values.stock_movement_extended_cost).toBe(12000)
  })

  // `standard`, never `actual`: there is no vendor, no order and no invoice, and
  // the standard was just made to agree with this number.
  it('stamps cost_basis STANDARD', async () => {
    expect((await openAndRead(OPENING)).stock_movement_cost_basis).toBe('standard')
  })

  it('stamps the inventory ROLE resolved from the part kind, never an account code', async () => {
    expect((await openAndRead(OPENING)).stock_movement_gl_account).toBe('inventory_raw_materials')
  })

  it('follows the part kind to the finished-goods account', async () => {
    h.partKind = 'finished_good'
    expect((await openAndRead(OPENING)).stock_movement_gl_account).toBe('inventory_finished_goods')
  })

  // 🛑 `explodeBomMovement` inherits the parent movement's type AND its sign, so
  // a true flag here would open a balance for every component in the BOM as
  // well: ten assemblies on the shelf claiming ten of every screw inside them.
  it('never explodes into the bill of materials', async () => {
    expect((await openAndRead(OPENING)).stock_movement_adjust_subparts).toBe(false)
  })

  it('stamps the accounting date the caller gave, not the moment of the keystroke', async () => {
    const occurredAt = new Date('2026-01-01T00:00:00.000Z')
    const values = await openAndRead({ ...OPENING, occurredAt })
    expect(values.stock_movement_occurred_at).toBe('2026-01-01T00:00:00.000Z')
  })

  it('records the note as the movement reason', async () => {
    const values = await openAndRead({ ...OPENING, notes: 'Opening count 2026-01-01' })
    expect(values.stock_movement_reason).toBe('Opening count 2026-01-01')
  })

  it('returns the row it wrote, with no vendor and no purchase order', async () => {
    const result = await openStockBalance(db, ORG, USER, OPENING)
    expect(result.isOk()).toBe(true)
    const record = result._unsafeUnwrap()
    expect(record).toMatchObject({
      movementId: 'mv_1',
      recordId: 'def_mv:mv_1',
      partInstanceId: 'part_1',
      quantity: 10,
      unitCost: 1200,
      extendedCost: 12000,
      vendorPartId: null,
      vendorUnitPrice: null,
      purchaseOrderLineId: null,
      glAccount: 'inventory_raw_materials',
    })
  })
})

describe('openStockBalance — it sets the first standard cost', () => {
  it('calls ensureStandardCost with the opening-stock source and the typed cost', async () => {
    await openAndRead(OPENING)
    expect(h.ensureSpy).toHaveBeenCalledTimes(1)
    expect(h.ensureSpy).toHaveBeenCalledWith(db, ORG, ['part_1'], {
      kind: 'opening-stock',
      unitCost: 1200,
    })
  })

  // The order is the contract: a movement written first, with the standard write
  // failing after it, is a part holding stock that nothing can value.
  it('sets the standard BEFORE the movement is written', async () => {
    const order: string[] = []
    h.ensureSpy.mockImplementation(async () => {
      order.push('ensure')
      const { ok } = await import('neverthrow')
      h.standardCost = 1200
      return ok({ writtenPartIds: ['part_1'] })
    })
    h.createSpy.mockImplementation(async () => {
      order.push('create')
      return { instance: { id: 'mv_1' } }
    })
    await openStockBalance(db, ORG, USER, OPENING)
    expect(order).toEqual(['ensure', 'create'])
  })

  it('writes nothing when the standard cost could not be set', async () => {
    h.ensureSpy.mockImplementation(async () => {
      const { err } = await import('neverthrow')
      return err(new Error('boom'))
    })
    await expectErr(openStockBalance(db, ORG, USER, OPENING))
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  // 🛑 The post-condition, not the return value. A part that comes out of this
  // holding stock and no standard refuses every later adjustment, build and
  // close, so it is checked while a refusal is still possible.
  it('refuses, naming the part, when the part still has no standard afterwards', async () => {
    h.ensureSpy.mockImplementation(async () => {
      const { ok } = await import('neverthrow')
      return ok({ writtenPartIds: [] })
    })
    const error = await expectErr(openStockBalance(db, ORG, USER, OPENING))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('Widget 9000')
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  // A part somebody already rolled keeps its standard: `ensureStandardCost`
  // never overwrites, and this door does not ask it to.
  it('leaves an existing standard cost alone', async () => {
    h.standardCost = 9999
    await openAndRead(OPENING)
    expect(h.standardCost).toBe(9999)
  })
})

describe('openStockBalance — opening is ONCE', () => {
  // 🛑 The load-bearing guard. `initial` is the only movement type that accepts
  // a caller's cost, so a second one against a part that already has a ledger
  // would let anybody state any value for any quantity, on an append-only row.
  it('refuses a part that already has a stock movement, and writes nothing', async () => {
    h.existingMovements = [{ id: 'mv_earlier' }]
    const error = await expectErr(openStockBalance(db, ORG, USER, OPENING))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/already has stock movements/i)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('does not set a standard cost on the refused second attempt', async () => {
    h.existingMovements = [{ id: 'mv_earlier' }]
    await expectErr(openStockBalance(db, ORG, USER, OPENING))
    expect(h.ensureSpy).not.toHaveBeenCalled()
  })

  // The refusal has to point somewhere. An adjustment is the door for a count
  // that disagrees with the system after the part has a history.
  it('names the adjustment as the way to correct a count instead', async () => {
    h.existingMovements = [{ id: 'mv_earlier' }]
    const error = await expectErr(openStockBalance(db, ORG, USER, OPENING))
    expect(error.message).toMatch(/adjustment/i)
  })
})

describe('openStockBalance — the quantity and cost guards', () => {
  it.each([0, -5])('refuses a quantity of %s and writes nothing', async (quantity) => {
    const error = await expectErr(openStockBalance(db, ORG, USER, { ...OPENING, quantity }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('refuses a non-finite quantity (%s)', async (quantity) => {
    // Infinity survives Math.round into the doublePrecision column and poisons
    // every later SUM; NaN passes `<= 0` as false.
    const error = await expectErr(openStockBalance(db, ORG, USER, { ...OPENING, quantity }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it.each([0, -1200])('refuses a unit cost of %s and writes nothing', async (unitCost) => {
    // The same hard refusal `receiveStock` gives at zero: a zero frozen onto an
    // append-only row sums into inventory as nothing and cannot be told apart
    // from a genuinely free part.
    const error = await expectErr(openStockBalance(db, ORG, USER, { ...OPENING, unitCost }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    12.5,
  ])('refuses a unit cost that is not a whole number of minor units (%s)', async (unitCost) => {
    // Not rounded into a legal value: a fraction arriving here means the caller
    // is working in the wrong units, and rounding would freeze that forever.
    const error = await expectErr(openStockBalance(db, ORG, USER, { ...OPENING, unitCost }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('runs the input guards before anything else', async () => {
    // No defs at all: if the quantity check ran second this would surface as a
    // NotFound and the caller would fix the wrong problem.
    h.defs = new Map()
    const error = await expectErr(openStockBalance(db, ORG, USER, { ...OPENING, quantity: 0 }))
    expect(error).toBeInstanceOf(BadRequestError)
  })

  it('fails with NotFound when the org has no stock_movement definition', async () => {
    h.defs.delete('stock_movement')
    const error = await expectErr(openStockBalance(db, ORG, USER, OPENING))
    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('refuses before the cost fields of entity migration 108 are materialised', async () => {
    h.materialised.delete('stock_movement_unit_cost')
    const error = await expectErr(openStockBalance(db, ORG, USER, OPENING))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })
})

// 🛑 The regression guard `plans/money/tasks/15-costing-usability.md` §5 asks
// for by name: "`adjustStock` regaining a unit-cost input. Refused in §2.2.
// `G12` stands." An opening balance takes a typed cost because it HAS one; an
// adjustment has no supplier row, no purchase order and no packing slip, so a
// number typed there would make the ledger's valuation depend on who counted.
describe('adjustStock still has no unit-cost input', () => {
  it('does not accept one at the type level', () => {
    // @ts-expect-error — `unitCost` is not on AdjustStockInput and must not be.
    const input: AdjustStockInput = { partId: 'part_1', quantity: 5, unitCost: 1200 }
    expect(input.partId).toBe('part_1')
  })

  it('ignores one at runtime, valuing the adjustment at the part standard', async () => {
    h.standardCost = 4400
    const result = await adjustStock(db, ORG, USER, {
      partId: 'part_1',
      quantity: 5,
      // @ts-expect-error — see above.
      unitCost: 999_999,
    })
    expect(result.isOk()).toBe(true)
    expect(writtenValues().stock_movement_unit_cost).toBe(4400)
  })
})
