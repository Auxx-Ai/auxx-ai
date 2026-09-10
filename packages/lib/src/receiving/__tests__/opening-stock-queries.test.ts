// packages/lib/src/receiving/__tests__/opening-stock-queries.test.ts
//
// The read behind the Parts > Settings > Costing checklist
// (plans/money/tasks/52-parts-costing-page.md §5). The org cache is mocked and
// the drizzle chain is a double, so nothing here needs a database.
//
// What is pinned:
//
//   - one row per part, carrying every fact the five row states and the
//     `finished_good` suggestion are decided from — and no part needs a second
//     read to render
//   - 🛑 FOUR bulk reads, never a per-part loop. 495 parts through the
//     single-part door's five questions is roughly 2,500 queries
//   - `hasMovements` and `hasInitialMovement` come from ONE grouped scan, so
//     they cannot disagree about which movements were visible
//   - an org missing an optional field still gets rows, with that column null

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  /** The part rows the candidate join returns. */
  partRows: [] as Array<{
    partId: string
    title: string | null
    sku: string | null
    partKind: string | null
    standardCost: number | null
    productId: string | null
  }>,
  /** The grouped movement scan's answer. */
  coverageRows: [] as Array<{ partId: string | null; hasInitial: boolean }>,
  /** Parts that are somebody's `subpart_child_part`. */
  subpartChildRows: [] as Array<{ partId: string | null }>,
  /** How many statements the read issued, so a per-part loop cannot hide. */
  queries: 0,
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

import { listOpeningStockCandidates } from '../opening-stock-queries'

const ORG = 'org_1'

/**
 * A drizzle chain that answers whichever of the three statements is being
 * built, told apart by shape: `groupBy` is the movement scan, `selectDistinct`
 * is the subpart probe, and everything else is the candidate join.
 */
const db = {
  select: () => chain(false),
  selectDistinct: () => chain(true),
} as never

function chain(distinct: boolean) {
  h.queries += 1
  const state = { distinct, grouped: false }
  const link: Record<string, unknown> = {}
  link.from = () => link
  link.leftJoin = () => link
  link.innerJoin = () => link
  link.where = () => link
  link.groupBy = () => {
    state.grouped = true
    return link
  }
  // biome-ignore lint/suspicious/noThenProperty: the double stands in for a drizzle query builder, which IS awaitable
  link.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => {
    const rows = state.grouped ? h.coverageRows : state.distinct ? h.subpartChildRows : h.partRows
    return Promise.resolve(rows as unknown[]).then(resolve, reject)
  }
  return link
}

const ALL_ATTRS = [
  'part_sku',
  'part_kind',
  'part_standard_cost',
  'part_product',
  'subpart_child_part',
  'stock_movement_part',
  'stock_movement_type',
]

beforeEach(() => {
  vi.clearAllMocks()
  h.queries = 0
  h.materialised = new Set(ALL_ATTRS)
  h.defs = new Map([
    ['part', 'def_part'],
    ['stock_movement', 'def_mv'],
  ])
  h.partRows = [
    {
      partId: 'part_1',
      title: 'Widget 9000',
      sku: 'W-9000',
      partKind: 'component',
      standardCost: 1200,
      productId: 'prod_1',
    },
    {
      partId: 'part_2',
      title: null,
      sku: null,
      partKind: null,
      standardCost: null,
      productId: null,
    },
  ]
  h.coverageRows = []
  h.subpartChildRows = []
})

async function list() {
  const result = await listOpeningStockCandidates(db, ORG)
  expect(result.isOk()).toBe(true)
  return result._unsafeUnwrap()
}

describe('listOpeningStockCandidates — the checklist row', () => {
  it('returns one row per part, carrying what the row state is decided from', async () => {
    const rows = await list()
    expect(rows).toEqual([
      {
        partId: 'part_1',
        title: 'Widget 9000',
        sku: 'W-9000',
        partKind: 'component',
        standardCost: 1200,
        hasMovements: false,
        hasInitialMovement: false,
        hasProduct: true,
        isSubpartOfAssembly: false,
      },
      {
        partId: 'part_2',
        title: '',
        sku: null,
        partKind: null,
        standardCost: null,
        hasMovements: false,
        hasInitialMovement: false,
        hasProduct: false,
        isSubpartOfAssembly: false,
      },
    ])
  })

  // 🛑 A per-part loop is the bug, not the implementation: 495 parts through the
  // single-part door's five questions is roughly 2,500 statements.
  it('asks every question of the whole set — a fixed number of statements', async () => {
    await list()
    const forTwoParts = h.queries

    h.partRows = Array.from({ length: 200 }, (_unused, index) => ({
      partId: `part_${index}`,
      title: `Part ${index}`,
      sku: null,
      partKind: null,
      standardCost: null,
      productId: null,
    }))
    h.queries = 0
    await list()
    expect(h.queries).toBe(forTwoParts)
    expect(h.queries).toBeLessThanOrEqual(4)
  })

  // The two facts come from one scan, so they cannot disagree about which
  // movements were visible.
  it('reports a part with movements but no initial as MOVED, not opened', async () => {
    h.coverageRows = [{ partId: 'part_1', hasInitial: false }]
    const [first] = await list()
    expect(first).toMatchObject({ hasMovements: true, hasInitialMovement: false })
  })

  it('reports a part with an initial movement as opened', async () => {
    h.coverageRows = [{ partId: 'part_1', hasInitial: true }]
    const [first] = await list()
    expect(first).toMatchObject({ hasMovements: true, hasInitialMovement: true })
  })

  it('carries both suggestion conditions on the same row', async () => {
    h.subpartChildRows = [{ partId: 'part_1' }]
    const [first] = await list()
    // (a) has a product and (b) IS somebody's subpart, so the suggestion is off.
    expect(first).toMatchObject({ hasProduct: true, isSubpartOfAssembly: true })
  })
})

describe('listOpeningStockCandidates — an org that is not fully provisioned', () => {
  it('reports every part as never moved when there is no stock_movement definition', async () => {
    h.defs.delete('stock_movement')
    h.coverageRows = [{ partId: 'part_1', hasInitial: true }]
    const rows = await list()
    expect(rows.every((row) => !row.hasMovements)).toBe(true)
  })

  it('reports every part as never moved when the movement part link is missing', async () => {
    h.materialised.delete('stock_movement_part')
    h.coverageRows = [{ partId: 'part_1', hasInitial: true }]
    const rows = await list()
    expect(rows.every((row) => !row.hasMovements)).toBe(true)
  })

  it('reports nobody as a subpart when the subpart field is missing', async () => {
    h.materialised.delete('subpart_child_part')
    h.subpartChildRows = [{ partId: 'part_1' }]
    const rows = await list()
    expect(rows.every((row) => !row.isSubpartOfAssembly)).toBe(true)
  })

  it('errors when the org has no part definition at all', async () => {
    h.defs.delete('part')
    const result = await listOpeningStockCandidates(db, ORG)
    expect(result.isErr()).toBe(true)
  })
})
