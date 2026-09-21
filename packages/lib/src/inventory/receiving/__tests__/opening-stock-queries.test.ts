// packages/lib/src/inventory/receiving/__tests__/opening-stock-queries.test.ts
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

/** The registry type each attribute's field carries, so a cell types correctly. */
const FIELD_TYPE: Record<string, string> = {
  part_sku: 'TEXT',
  part_kind: 'SINGLE_SELECT',
  part_standard_cost: 'CURRENCY',
  part_product: 'RELATIONSHIP',
}

const h = vi.hoisted(() => ({
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  /** The `part` instance rows the reader's first statement returns. */
  partRows: [] as Record<string, unknown>[],
  /** Their stored values, the reader's second statement. */
  partValueRows: [] as Record<string, unknown>[],
  /** The grouped movement scan's answer. */
  coverageRows: [] as Array<{ partId: string | null; hasInitial: boolean }>,
  /** Parts that are somebody's `subpart_child_part`. */
  subpartChildRows: [] as Array<{ partId: string | null }>,
  /** How many statements the read issued, so a per-part loop cannot hide. */
  queries: 0,
}))

vi.mock('../../../cache', () => ({
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
          attrs.map((a) => [
            a,
            h.materialised.has(a) ? { id: `fld_${a}`, type: FIELD_TYPE[a] ?? 'TEXT' } : null,
          ])
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
  select: (columns?: unknown) => chain(false, columns === undefined),
  selectDistinct: () => chain(true, false),
} as never

function chain(distinct: boolean, values: boolean) {
  h.queries += 1
  const state = { distinct, values, grouped: false }
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
  link.orderBy = () => link
  link.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => {
    const rows = state.grouped
      ? h.coverageRows
      : state.distinct
        ? h.subpartChildRows
        : state.values
          ? h.partValueRows
          : h.partRows
    return Promise.resolve(rows as unknown[]).then(resolve, reject)
  }
  return link
}

/** One `part` instance row, as `readSystemRecords` selects it. */
function part(id: string, displayName: string | null) {
  return {
    id,
    organizationId: ORG,
    entityDefinitionId: 'def_part',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    archivedAt: null,
    displayName,
  }
}

/** One stored `FieldValue` row for a part. */
function value(entityId: string, fieldId: string, columns: Record<string, unknown>) {
  return { id: `${entityId}:${fieldId}`, entityId, fieldId, sortKey: 'a', ...columns }
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
  h.partRows = [part('part_1', 'Widget 9000'), part('part_2', null)]
  h.partValueRows = [
    value('part_1', 'fld_part_sku', { valueText: 'W-9000' }),
    value('part_1', 'fld_part_kind', { optionId: 'component' }),
    value('part_1', 'fld_part_standard_cost', { valueNumber: 1200 }),
    value('part_1', 'fld_part_product', { relatedEntityId: 'prod_1' }),
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

    h.partRows = Array.from({ length: 200 }, (_unused, index) =>
      part(`part_${index}`, `Part ${index}`)
    )
    h.partValueRows = []
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
