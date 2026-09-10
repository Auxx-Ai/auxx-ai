// packages/lib/src/receiving/__tests__/opening-stock-subledger.test.ts
//
// The opening-stock subledger read and the finalize reconciliation. The org
// cache, the settings service and the drizzle chain are all doubles, so nothing
// here needs a database.
//
// What is pinned:
//
//   - Σ SIGNED `extendedCost` per FROZEN role, all three roles always present
//   - 🛑 a role-less or uncosted `initial` movement is a HARD STOP, never
//     filtered - the offender scan runs before the sum and refuses naming ids
//   - 🛑 an unknown role reaching the sum still throws, so the scan cannot be
//     defeated by a later edit
//   - the reconciliation compares ONLY the two derivable roles: WIP is never a
//     divergence, whatever the setting says
//   - unset is not zero: an unset setting diverges only when something is counted
//   - a divergence carries the account and BOTH numbers, so a panel can name them
//
// 🛑 There is no assert/gate here on purpose. This comparison must never refuse
// a finalize - the close replaces pre-cutoff history with the baseline rather
// than reconciling against it. See the module header.

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
  /** settingKey -> stored value. */
  settings: new Map<string, unknown>(),
  /** How many statements were issued. */
  queries: 0,
}))

vi.mock('../../cache', () => ({
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

vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: vi.fn(async ({ key }: { key: string }) => h.settings.get(key) ?? null),
}))

import { UnprocessableEntityError } from '../../errors'
import {
  DERIVABLE_OPENING_STOCK_ROLES,
  findOpeningStockDivergences,
  OPENING_STOCK_INVENTORY_ROLES,
  readOpeningStockSubledgerTotals,
} from '../opening-stock-subledger'

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
  h.settings = new Map()
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

describe('findOpeningStockDivergences', () => {
  it('compares only the two derivable roles', () => {
    expect([...DERIVABLE_OPENING_STOCK_ROLES]).toEqual([
      'inventory_raw_materials',
      'inventory_finished_goods',
    ])
    expect([...OPENING_STOCK_INVENTORY_ROLES]).toContain('inventory_wip')
  })

  it('finds nothing when both derivable roles match to the cent', async () => {
    h.sumRows = [
      { role: 'inventory_raw_materials', total: 5_000_000 },
      { role: 'inventory_finished_goods', total: 250 },
    ]
    h.settings.set('accounting.openingRawMaterials', 5_000_000)
    h.settings.set('accounting.openingFinishedGoods', 250)

    const result = await findOpeningStockDivergences(db, ORG)

    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('never reports WIP, whatever the setting holds', async () => {
    h.settings.set('accounting.openingWip', 999_999)

    const result = await findOpeningStockDivergences(db, ORG)

    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('treats an unset setting as unset, not as zero, when nothing is counted', async () => {
    const result = await findOpeningStockDivergences(db, ORG)

    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('reports an unset setting as a divergence once the subledger holds something', async () => {
    h.sumRows = [{ role: 'inventory_raw_materials', total: 4_730_000 }]

    const result = await findOpeningStockDivergences(db, ORG)

    expect(result._unsafeUnwrap()).toEqual([
      {
        role: 'inventory_raw_materials',
        accountCode: '1310',
        accountName: 'Raw Materials / Parts',
        settingKey: 'accounting.openingRawMaterials',
        countedMinor: 4_730_000,
        baselineMinor: null,
      },
    ])
  })

  it('reports a set setting that differs, carrying both numbers', async () => {
    h.sumRows = [{ role: 'inventory_finished_goods', total: 4_730_000 }]
    h.settings.set('accounting.openingFinishedGoods', 5_000_000)

    const [divergence] = (await findOpeningStockDivergences(db, ORG))._unsafeUnwrap()

    expect(divergence).toMatchObject({
      accountCode: '1330',
      countedMinor: 4_730_000,
      baselineMinor: 5_000_000,
    })
  })

  it('propagates the read refusal rather than reconciling against a partial sum', async () => {
    h.offenderRows = [{ id: 'mv_1' }]

    const result = await findOpeningStockDivergences(db, ORG)

    expect(result.isErr()).toBe(true)
  })
})
