// packages/lib/src/receiving/__tests__/bulk-opening-stock.test.ts
//
// The BULK opening balance — the same five ordered steps as the single-part
// door, asked of a whole org at once (plans/money/tasks/52-parts-costing-page.md
// §5). The org cache, the CRUD handler and `ensureStandardCost` are mocked, so
// nothing here needs a database.
//
// What is pinned:
//
//   - one `initial` movement per part, at the TYPED cost, `cost_basis: standard`,
//     `adjustSubparts: false`, and ONE `occurredAt` for the whole run
//   - the gl account is the ROLE resolved from each part's OWN kind, never a
//     hardcoded number and never the first part's answer applied to all of them
//   - 🛑 a part that already has ANY movement is EXCLUDED, not an error, and the
//     other parts still open. Opening is once
//   - 🛑 `ensureStandardCost` takes ONE cost for a whole array, so entries are
//     grouped by DISTINCT unit cost — a single call over mixed costs would
//     freeze the first group's number onto every part in the run
//   - 🛑 a part left with no usable standard after step 3 gets NO movement
//     (§6.1), because `ensureStandardCost` is NULL-only and `cost_basis:
//     standard` would otherwise lie
//   - it never throws: every entry is accounted for by exactly one of
//     `opened` / `excluded` / `failed`
//   - 🛑 QoH is the CREATE TRIGGER's job. This writes on the ordinary lane, so
//     HANDOFF rule 5 does not apply and `batchRecalculateQoH` must NOT be called

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, NotFoundError } from '../../errors'

const h = vi.hoisted(() => ({
  bulkCreateSpy: vi.fn(),
  bulkSetFieldValueSpy: vi.fn(async () => ({ count: 0 })),
  ensureSpy: vi.fn(),
  batchQohSpy: vi.fn(),
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  /** partId -> display name + stored kind. A missing key models a stale id. */
  parts: new Map<string, { displayName: string | null; kind: string | null }>(),
  /** Parts the ledger has already touched. */
  moved: new Set<string>(),
  /** partId -> stored `part_standard_cost`, as the post-condition read sees it. */
  standards: new Map<string, number | null>(),
  /** Index -> message, to model `bulkCreate`'s per-item failures. */
  createErrors: new Map<number, string>(),
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
    bulkCreate = h.bulkCreateSpy
    bulkSetFieldValue = h.bulkSetFieldValueSpy
  },
}))

vi.mock('../../builds/ensure-standard-cost', () => ({
  ensureStandardCost: h.ensureSpy,
}))

// 🛑 Not because it is called — because it must NOT be. See the header.
vi.mock('../../bom/qoh', () => ({
  batchRecalculateQoH: h.batchQohSpy,
}))

import { bulkOpenStockBalance, bulkSetPartKind } from '../bulk-opening-stock'
import type { BulkOpeningStockSummary, OpeningStockEntry } from '../types'

const ORG = 'org_1'
const USER = 'user_1'
const OCCURRED_AT = new Date('2026-01-01T00:00:00.000Z')

/**
 * A drizzle chain that answers whichever of this module's three reads is being
 * built, told apart by the shape of the query rather than by call order — the
 * order changes the moment an earlier step empties the working set.
 *
 * - `selectDistinct` + `innerJoin` is the "has any movement?" probe
 * - `select` + `leftJoin` is the part/kind read
 * - anything else is the `part_standard_cost` read
 */
const db = {
  select: () => chain(false),
  selectDistinct: () => chain(true),
} as never

function chain(distinct: boolean) {
  const state = { distinct, joined: false }
  const link: Record<string, unknown> = {}
  link.from = () => link
  link.leftJoin = () => {
    state.joined = true
    return link
  }
  link.innerJoin = () => link
  link.where = () => link
  link.groupBy = () => link
  link.limit = () => link
  // biome-ignore lint/suspicious/noThenProperty: the double stands in for a drizzle query builder, which IS awaitable
  link.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(rowsFor(state)).then(resolve, reject)
  return link
}

function rowsFor(state: { distinct: boolean; joined: boolean }): unknown[] {
  if (state.distinct) return [...h.moved].map((partId) => ({ partId }))
  if (state.joined) {
    return [...h.parts].map(([partId, part]) => ({
      partId,
      displayName: part.displayName,
      kind: part.kind,
    }))
  }
  return [...h.standards]
    .filter(([, standardCost]) => standardCost != null)
    .map(([partId, standardCost]) => ({ partId, standardCost }))
}

/** Every systemAttribute a fully migrated org has for this write path. */
const ALL_ATTRS = [
  'part_kind',
  'part_standard_cost',
  'stock_movement_part',
  'stock_movement_unit_cost',
  'stock_movement_cost_basis',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  'stock_movement_occurred_at',
]

beforeEach(() => {
  vi.clearAllMocks()
  h.materialised = new Set(ALL_ATTRS)
  h.defs = new Map([
    ['part', 'def_part'],
    ['stock_movement', 'def_mv'],
  ])
  h.parts = new Map([
    ['part_1', { displayName: 'Widget 9000', kind: null }],
    ['part_2', { displayName: 'Bracket', kind: 'finished_good' }],
    ['part_3', { displayName: 'Rivet', kind: 'subassembly' }],
  ])
  h.moved = new Set()
  h.standards = new Map()
  h.createErrors = new Map()

  // The real thing writes only where `part_standard_cost IS NULL`, and this door
  // always supplies a cost, so a part with no standard comes out holding the
  // typed number and one that already has a standard keeps it.
  h.ensureSpy.mockImplementation(
    async (
      _db: unknown,
      _org: string,
      partIds: string[],
      source: { kind: string; unitCost?: number }
    ) => {
      const { ok } = await import('neverthrow')
      for (const partId of partIds) {
        if (h.standards.get(partId) == null && source.unitCost != null) {
          h.standards.set(partId, source.unitCost)
        }
      }
      return ok({ writtenPartIds: partIds })
    }
  )

  h.bulkCreateSpy.mockImplementation(async (_defId: string, items: Record<string, unknown>[]) => ({
    created: items
      .map((_item, index) => index)
      .filter((index) => !h.createErrors.has(index))
      .map((index) => ({ id: `mv_${index}` })),
    errors: [...h.createErrors].map(([index, error]) => ({ index, error })),
  }))
})

const ENTRIES: OpeningStockEntry[] = [
  { partId: 'part_1', quantity: 10, unitCost: 1200 },
  { partId: 'part_2', quantity: 4, unitCost: 550 },
]

async function run(entries: OpeningStockEntry[] = ENTRIES): Promise<BulkOpeningStockSummary> {
  const result = await bulkOpenStockBalance(db, ORG, USER, { occurredAt: OCCURRED_AT, entries })
  expect(result.isOk()).toBe(true)
  return result._unsafeUnwrap()
}

/** The value bags handed to `bulkCreate`, keyed by the part they name. */
function writtenByPart(): Map<string, Record<string, unknown>> {
  expect(h.bulkCreateSpy).toHaveBeenCalledTimes(1)
  const items = h.bulkCreateSpy.mock.calls[0]![1] as Record<string, unknown>[]
  return new Map(items.map((item) => [String(item.stock_movement_part).split(':')[1] ?? '', item]))
}

describe('bulkOpenStockBalance — the movements it writes', () => {
  it('writes one initial movement per part, in ONE bulk call', async () => {
    const summary = await run()
    expect(h.bulkCreateSpy).toHaveBeenCalledTimes(1)
    expect(summary.opened).toHaveLength(2)
    for (const values of writtenByPart().values()) {
      expect(values.stock_movement_type).toBe('initial')
    }
  })

  it('freezes the TYPED unit cost and an extended cost signed like the quantity', async () => {
    await run()
    const written = writtenByPart()
    expect(written.get('part_1')?.stock_movement_unit_cost).toBe(1200)
    expect(written.get('part_1')?.stock_movement_extended_cost).toBe(12000)
    expect(written.get('part_2')?.stock_movement_unit_cost).toBe(550)
    expect(written.get('part_2')?.stock_movement_extended_cost).toBe(2200)
  })

  it('stamps cost_basis STANDARD, never actual', async () => {
    await run()
    for (const values of writtenByPart().values()) {
      expect(values.stock_movement_cost_basis).toBe('standard')
    }
  })

  // 🛑 `explodeBomMovement` inherits the parent movement's type AND its sign, so
  // a true flag would open a balance for every component in the BOM as well.
  it('never explodes into the bill of materials', async () => {
    await run()
    for (const values of writtenByPart().values()) {
      expect(values.stock_movement_adjust_subparts).toBe(false)
    }
  })

  // 🛑 Per part, from that part's OWN kind. One role resolved once and reused
  // would post finished goods to Raw Materials on an `updatable: false` row.
  it('resolves the inventory ROLE from each part kind separately', async () => {
    await run([
      { partId: 'part_1', quantity: 1, unitCost: 100 },
      { partId: 'part_2', quantity: 1, unitCost: 100 },
      { partId: 'part_3', quantity: 1, unitCost: 100 },
    ])
    const written = writtenByPart()
    // null reads as `component`, and a `subassembly` sits in raw materials too:
    // work in process is where a part sits DURING a build.
    expect(written.get('part_1')?.stock_movement_gl_account).toBe('inventory_raw_materials')
    expect(written.get('part_2')?.stock_movement_gl_account).toBe('inventory_finished_goods')
    expect(written.get('part_3')?.stock_movement_gl_account).toBe('inventory_raw_materials')
  })

  // One event, one date. A date per row invites 495 dates for one opening.
  it('stamps the run’s single accounting date on every movement', async () => {
    const summary = await run()
    for (const values of writtenByPart().values()) {
      expect(values.stock_movement_occurred_at).toBe('2026-01-01T00:00:00.000Z')
    }
    expect(summary.occurredAt).toEqual(OCCURRED_AT)
  })

  it('returns the rows it wrote, with the role and the extended cost it stored', async () => {
    const summary = await run()
    expect(summary.opened).toEqual([
      {
        partId: 'part_1',
        movementId: 'mv_0',
        recordId: 'def_mv:mv_0',
        quantity: 10,
        unitCost: 1200,
        extendedCost: 12000,
        glAccount: 'inventory_raw_materials',
      },
      {
        partId: 'part_2',
        movementId: 'mv_1',
        recordId: 'def_mv:mv_1',
        quantity: 4,
        unitCost: 550,
        extendedCost: 2200,
        glAccount: 'inventory_finished_goods',
      },
    ])
  })

  it('totals the opening journal entry by inventory account', async () => {
    const summary = await run()
    expect(summary.totalsByGlAccount).toEqual([
      { glAccount: 'inventory_finished_goods', partCount: 1, extendedCost: 2200 },
      { glAccount: 'inventory_raw_materials', partCount: 1, extendedCost: 12000 },
    ])
  })
})

describe('bulkOpeningStock — quantity on hand has exactly one owner', () => {
  // ✅ The ordinary lane, so `mfg-stock-movements-created` fires and
  // `recalculatePartQoH` is what writes `part_quantity_on_hand`. HANDOFF rule 5
  // applies to a QUIET lane; a second writer here would give the number two.
  it('writes on the ordinary lane and never recalculates QoH itself', async () => {
    await run()
    expect(h.batchQohSpy).not.toHaveBeenCalled()
    // No `skipEvents`, no session: the create trigger has to be able to fire.
    expect(h.bulkCreateSpy.mock.calls[0]![2]).toBeUndefined()
  })
})

describe('bulkOpenStockBalance — opening is ONCE', () => {
  // 🛑 An exclusion, not an error. `initial` is the only movement type that
  // accepts a caller's cost, so a second one would let anybody state any value
  // for any quantity on an append-only row — but refusing the whole run for it
  // would lose the 494 parts that were fine.
  it('excludes a part that already has a movement, and still opens the others', async () => {
    h.moved = new Set(['part_1'])
    const summary = await run()
    expect(summary.excluded).toEqual([
      {
        partId: 'part_1',
        reason: 'already_has_movements',
        detail: expect.stringMatching(/already has stock movements/i),
      },
    ])
    expect(summary.opened.map((row) => row.partId)).toEqual(['part_2'])
    expect(writtenByPart().has('part_1')).toBe(false)
  })

  it('names the adjustment as the way to correct a count instead', async () => {
    h.moved = new Set(['part_1'])
    const summary = await run()
    expect(summary.excluded[0]?.detail).toMatch(/adjustment/i)
  })

  it('never sets a standard cost for an already-moved part', async () => {
    h.moved = new Set(['part_1'])
    await run()
    for (const call of h.ensureSpy.mock.calls) {
      expect(call[2]).not.toContain('part_1')
    }
  })

  // The candidate list the page was rendered from is not an authority (§6.2).
  it('re-reads the movement guard inside the run', async () => {
    h.moved = new Set(['part_1', 'part_2'])
    const summary = await run()
    expect(summary.opened).toHaveLength(0)
    expect(h.bulkCreateSpy).not.toHaveBeenCalled()
  })

  it('opens a part named twice exactly once, and says so', async () => {
    const summary = await run([
      { partId: 'part_1', quantity: 10, unitCost: 1200 },
      { partId: 'part_1', quantity: 3, unitCost: 900 },
    ])
    expect(summary.opened.map((row) => row.quantity)).toEqual([10])
    expect(summary.excluded[0]).toMatchObject({ partId: 'part_1', reason: 'duplicate_entry' })
  })
})

describe('bulkOpenStockBalance — the per-entry guards', () => {
  it.each([
    0,
    -5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('fails an entry with a quantity of %s and still opens the rest', async (quantity) => {
    const summary = await run([{ partId: 'part_1', quantity, unitCost: 1200 }, ...ENTRIES.slice(1)])
    expect(summary.failed).toEqual([
      { partId: 'part_1', reason: 'invalid_quantity', detail: expect.any(String) },
    ])
    expect(summary.opened.map((row) => row.partId)).toEqual(['part_2'])
  })

  it.each([
    0,
    -1200,
    Number.NaN,
  ])('fails an entry with a unit cost of %s and still opens the rest', async (unitCost) => {
    const summary = await run([{ partId: 'part_1', quantity: 10, unitCost }, ...ENTRIES.slice(1)])
    expect(summary.failed).toEqual([
      { partId: 'part_1', reason: 'invalid_unit_cost', detail: expect.any(String) },
    ])
    expect(summary.opened.map((row) => row.partId)).toEqual(['part_2'])
  })

  // 🛑 NOT rounded down into a legal value. A receipt derives its cost from
  // supplier terms; an opening balance is typed, so a value finer than the
  // column can hold means the caller is working in the wrong units.
  it('fails a unit cost finer than five decimal places rather than rounding it', async () => {
    const summary = await run([{ partId: 'part_1', quantity: 1, unitCost: 1.234567 }])
    expect(summary.failed[0]).toMatchObject({ reason: 'invalid_unit_cost' })
    expect(h.bulkCreateSpy).not.toHaveBeenCalled()
  })

  it('fails a stale part id rather than inventing a write target', async () => {
    const summary = await run([{ partId: 'ghost', quantity: 1, unitCost: 100 }, ...ENTRIES])
    expect(summary.failed).toEqual([
      { partId: 'ghost', reason: 'unknown_part', detail: expect.any(String) },
    ])
    expect(summary.opened).toHaveLength(2)
  })

  it('accounts for every entry exactly once', async () => {
    h.moved = new Set(['part_3'])
    const summary = await run([
      ...ENTRIES,
      { partId: 'part_3', quantity: 1, unitCost: 100 },
      { partId: 'ghost', quantity: 1, unitCost: 100 },
      { partId: 'part_1', quantity: 0, unitCost: 100 },
    ])
    expect(summary.requested).toBe(5)
    expect(summary.opened.length + summary.excluded.length + summary.failed.length).toBe(5)
  })
})

describe('bulkOpenStockBalance — the first standard cost', () => {
  // 🛑 `ensureStandardCost` takes `partIds: string[]` but ONE `source.unitCost`.
  // A single call over mixed costs would freeze the first cost onto every part.
  it('calls ensureStandardCost once per DISTINCT unit cost', async () => {
    await run([
      { partId: 'part_1', quantity: 1, unitCost: 1200 },
      { partId: 'part_2', quantity: 1, unitCost: 1200 },
      { partId: 'part_3', quantity: 1, unitCost: 550 },
    ])
    expect(h.ensureSpy).toHaveBeenCalledTimes(2)
    expect(h.ensureSpy).toHaveBeenCalledWith(db, ORG, ['part_1', 'part_2'], {
      kind: 'opening-stock',
      unitCost: 1200,
    })
    expect(h.ensureSpy).toHaveBeenCalledWith(db, ORG, ['part_3'], {
      kind: 'opening-stock',
      unitCost: 550,
    })
  })

  // The order is the contract: a movement written first, with the standard write
  // failing after it, is a part holding stock that nothing can value.
  it('sets the standards BEFORE any movement is written', async () => {
    const order: string[] = []
    h.ensureSpy.mockImplementation(async (_db, _org, partIds: string[], source) => {
      order.push('ensure')
      const { ok } = await import('neverthrow')
      for (const partId of partIds) h.standards.set(partId, source.unitCost ?? 1)
      return ok({ writtenPartIds: partIds })
    })
    h.bulkCreateSpy.mockImplementation(async () => {
      order.push('create')
      return { created: [{ id: 'mv_0' }, { id: 'mv_1' }], errors: [] }
    })
    await run()
    expect(order).toEqual(['ensure', 'ensure', 'create'])
  })

  it('fails only the group whose standard cost could not be set', async () => {
    h.ensureSpy.mockImplementation(async (_db, _org, partIds: string[], source) => {
      const { err, ok } = await import('neverthrow')
      if (source.unitCost === 1200) return err(new Error('boom'))
      for (const partId of partIds) h.standards.set(partId, source.unitCost ?? 1)
      return ok({ writtenPartIds: partIds })
    })
    const summary = await run()
    expect(summary.failed).toEqual([
      { partId: 'part_1', reason: 'no_standard_cost', detail: 'boom' },
    ])
    expect(summary.opened.map((row) => row.partId)).toEqual(['part_2'])
  })

  // 🛑 §6.1: `ensureStandardCost` is NULL-only, so "it ran" is not "the part has
  // a usable standard". A movement stamped `cost_basis: standard` for a part
  // whose standard is null or zero is a row nothing downstream can value.
  it.each([
    null,
    0,
    -5,
  ])('writes no movement for a part left holding a standard of %s', async (standardCost) => {
    h.ensureSpy.mockImplementation(async (_db, _org, partIds: string[]) => {
      const { ok } = await import('neverthrow')
      for (const partId of partIds) h.standards.set(partId, standardCost)
      return ok({ writtenPartIds: [] })
    })
    const summary = await run([ENTRIES[0]!])
    expect(summary.failed[0]).toMatchObject({ partId: 'part_1', reason: 'no_standard_cost' })
    expect(summary.failed[0]?.detail).toContain('Widget 9000')
    expect(h.bulkCreateSpy).not.toHaveBeenCalled()
  })

  // A part somebody already rolled keeps its standard: `ensureStandardCost`
  // never overwrites, and this door does not ask it to.
  it('leaves an existing standard cost alone', async () => {
    h.standards.set('part_1', 9999)
    await run()
    expect(h.standards.get('part_1')).toBe(9999)
    expect(writtenByPart().get('part_1')?.stock_movement_unit_cost).toBe(1200)
  })
})

describe('bulkOpenStockBalance — it never throws', () => {
  it('reports a refused movement against the right part, by index', async () => {
    h.createErrors = new Map([[0, 'refused']])
    const summary = await run()
    expect(summary.failed).toEqual([
      { partId: 'part_1', reason: 'write_failed', detail: 'refused' },
    ])
    // The success that DID land is still paired with its own part.
    expect(summary.opened).toEqual([
      expect.objectContaining({ partId: 'part_2', movementId: 'mv_1' }),
    ])
  })

  it('returns an empty summary rather than an error when every entry is refused', async () => {
    const summary = await run([{ partId: 'part_1', quantity: -1, unitCost: 1200 }])
    expect(summary.opened).toHaveLength(0)
    expect(summary.failed).toHaveLength(1)
    expect(h.bulkCreateSpy).not.toHaveBeenCalled()
  })

  // A whole-run precondition IS an error: it is not about a part, and it refuses
  // every entry identically.
  it('errors when the org has no stock_movement definition', async () => {
    h.defs.delete('stock_movement')
    const result = await bulkOpenStockBalance(db, ORG, USER, {
      occurredAt: OCCURRED_AT,
      entries: ENTRIES,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('errors when the movement cost fields are not materialised', async () => {
    h.materialised.delete('stock_movement_unit_cost')
    const result = await bulkOpenStockBalance(db, ORG, USER, {
      occurredAt: OCCURRED_AT,
      entries: ENTRIES,
    })
    expect(result.isErr()).toBe(true)
    expect(h.bulkCreateSpy).not.toHaveBeenCalled()
  })
})

describe('bulkSetPartKind', () => {
  it('sets the kind on every named part in one write', async () => {
    h.bulkSetFieldValueSpy.mockResolvedValue({ count: 2 })
    const result = await bulkSetPartKind(db, ORG, USER, ['part_1', 'part_2'], 'finished_good')
    expect(result.isOk()).toBe(true)
    expect(h.bulkSetFieldValueSpy).toHaveBeenCalledWith(
      ['def_part:part_1', 'def_part:part_2'],
      'fld_part_kind',
      'finished_good'
    )
    expect(result._unsafeUnwrap()).toEqual({ count: 2 })
  })

  it('de-duplicates the selection', async () => {
    await bulkSetPartKind(db, ORG, USER, ['part_1', 'part_1', ''], 'component')
    expect(h.bulkSetFieldValueSpy).toHaveBeenCalledWith(
      ['def_part:part_1'],
      'fld_part_kind',
      'component'
    )
  })

  // 🛑 An unrecognised value stores as an optionId nothing maps, which
  // `resolveInventoryRoleForPartKind` then reads as the default — silently
  // posting a finished good to Raw Materials on an `updatable: false` row.
  it('refuses a value that is not a part kind, and writes nothing', async () => {
    const result = await bulkSetPartKind(db, ORG, USER, ['part_1'], 'widget')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(h.bulkSetFieldValueSpy).not.toHaveBeenCalled()
  })

  it('writes nothing for an empty selection', async () => {
    const result = await bulkSetPartKind(db, ORG, USER, [], 'component')
    expect(result._unsafeUnwrap()).toEqual({ count: 0 })
    expect(h.bulkSetFieldValueSpy).not.toHaveBeenCalled()
  })
})
