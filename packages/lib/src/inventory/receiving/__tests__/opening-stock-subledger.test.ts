// packages/lib/src/inventory/receiving/__tests__/opening-stock-subledger.test.ts
//
// The opening-stock subledger read. The org cache and the drizzle chain are
// doubles, so nothing here needs a database.
//
// What is pinned:
//
//   - Σ SIGNED `extendedCost` per FROZEN role, all three roles always present
//   - 🛑 a role-less or uncosted `initial` movement is a HARD STOP, never
//     filtered - the offender scan runs before the sum and refuses naming ids
//   - 🛑 an unknown role reaching the sum still throws, so the scan cannot be
//     defeated by a later edit

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  /** What the offender scan (the `.limit(...)` statement) returns. */
  offenderRows: [] as Array<{ id: string }>,
  /** What the grouped sum returns. */
  sumRows: [] as Array<{ role: string | null; total: string | number }>,
  /** How many statements were issued. */
  queries: 0,
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])
        ),
    }),
  }),
}))

import { UnprocessableEntityError } from '../../../errors'
import { readOpeningStockSubledgerTotals } from '../opening-stock-subledger'

const ORG = 'org_1'

/**
 * A drizzle chain told apart by shape: `limit` is the offender scan and
 * `groupBy` is the sum.
 */
const db = { select: () => chain() } as never

function chain() {
  h.queries += 1
  const state = { limited: false }
  const link: Record<string, unknown> = {}
  link.from = () => link
  link.leftJoin = () => link
  link.innerJoin = () => link
  link.where = () => link
  link.groupBy = () => link
  link.limit = () => {
    state.limited = true
    return link
  }
  // biome-ignore lint/suspicious/noThenProperty: the double stands in for a drizzle query builder, which IS awaitable
  link.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => {
    const rows = state.limited ? h.offenderRows : h.sumRows
    return Promise.resolve(rows as unknown[]).then(resolve, reject)
  }
  return link
}

const ALL_ATTRS = [
  'stock_movement_type',
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
]

beforeEach(() => {
  vi.clearAllMocks()
  h.queries = 0
  h.materialised = new Set(ALL_ATTRS)
  h.defs = new Map([['stock_movement', 'def_mv']])
  h.offenderRows = []
  h.sumRows = []
})

describe('readOpeningStockSubledgerTotals', () => {
  it('sums the signed extended cost per frozen role, with every role present', async () => {
    h.sumRows = [
      { role: 'inventory_raw_materials', total: '4730000' },
      { role: 'inventory_finished_goods', total: 1200 },
    ]

    const result = await readOpeningStockSubledgerTotals(db, ORG)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      inventory_raw_materials: 4_730_000,
      inventory_wip: 0,
      inventory_finished_goods: 1200,
    })
  })

  it('keeps the sum signed, so a negated reversal nets its original out', async () => {
    h.sumRows = [{ role: 'inventory_raw_materials', total: '-500' }]

    const result = await readOpeningStockSubledgerTotals(db, ORG)

    expect(result._unsafeUnwrap().inventory_raw_materials).toBe(-500)
  })

  it('reports zero for an org with no stock_movement definition', async () => {
    h.defs = new Map()

    const result = await readOpeningStockSubledgerTotals(db, ORG)

    expect(result._unsafeUnwrap()).toEqual({
      inventory_raw_materials: 0,
      inventory_wip: 0,
      inventory_finished_goods: 0,
    })
    expect(h.queries).toBe(0)
  })

  it('refuses when the costing fields are not provisioned', async () => {
    h.materialised = new Set(['stock_movement_type'])

    const result = await readOpeningStockSubledgerTotals(db, ORG)

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('stock_movement_gl_account')
  })

  it('HARD STOPS on an uncosted or role-less movement rather than skipping it', async () => {
    h.offenderRows = [{ id: 'mv_1' }, { id: 'mv_2' }]
    h.sumRows = [{ role: 'inventory_raw_materials', total: 100 }]

    const result = await readOpeningStockSubledgerTotals(db, ORG)

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('mv_1, mv_2')
    // The scan runs FIRST: the sum is never issued once it finds anything.
    expect(h.queries).toBe(1)
  })

  it('says "and more" rather than naming an unbounded list of movements', async () => {
    h.offenderRows = Array.from({ length: 11 }, (_, index) => ({ id: `mv_${index}` }))

    const result = await readOpeningStockSubledgerTotals(db, ORG)

    expect(result._unsafeUnwrapErr().message).toContain('(and more)')
  })

  it('still throws when an unknown role reaches the sum', async () => {
    h.sumRows = [{ role: 'inventory_spare_parts', total: 100 }]

    const result = await readOpeningStockSubledgerTotals(db, ORG)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('inventory_spare_parts')
  })

  it('refuses a fractional total rather than rounding it away', async () => {
    h.sumRows = [{ role: 'inventory_raw_materials', total: '100.5' }]

    const result = await readOpeningStockSubledgerTotals(db, ORG)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('whole number of minor units')
  })
})
