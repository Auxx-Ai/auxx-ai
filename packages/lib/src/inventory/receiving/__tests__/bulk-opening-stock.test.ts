// packages/lib/src/inventory/receiving/__tests__/bulk-opening-stock.test.ts
//
// The bulk door is `setCount` per part with a per-part count day (103 O1, 111 D21). What is
// pinned: the per-entry guards, the exclusion of an anchored part unless the caller opted into
// the adjust leg, the per-part date, and that every entry lands in exactly one of
// `opened` / `excluded` / `failed`. `bulkSetPartKind` is pinned beside it.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, NotFoundError } from '../../../errors'

const h = vi.hoisted(() => ({
  setCount: vi.fn(),
  bulkSetFieldValueSpy: vi.fn(async () => ({ count: 0 })),
  materialised: new Set<string>(),
  defs: new Map<string, string>(),
  parts: new Map<string, { displayName: string | null; kind: string | null }>(),
  /** Parts that already carry an `initial`. */
  anchored: new Set<string>(),
  serviceBlockers: new Map<string, string>(),
}))

vi.mock('../set-count', () => ({ setCount: h.setCount }))
vi.mock('../../movements/initial-queries', () => ({
  readPartInitials: async (_db: unknown, _org: string, ids: string[]) =>
    new Map(ids.filter((id) => h.anchored.has(id)).map((id) => [id, { movementId: `mv_${id}` }])),
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
            h.materialised.has(a) ? { id: `fld_${a}`, type: 'SINGLE_SELECT' } : null,
          ])
        ),
    }),
  }),
}))
vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    bulkSetFieldValue = h.bulkSetFieldValueSpy
  },
}))
vi.mock('../../costing/service-kind-blockers', () => ({
  readServiceKindBlockers: vi.fn(async () => h.serviceBlockers),
  serviceKindRefusal: (reason: string) => `refused: ${reason}`,
}))

import { bulkOpenStockBalance, bulkSetPartKind } from '../bulk-opening-stock'
import type { BulkOpeningStockSummary, OpeningStockEntry } from '../types'

const ORG = 'org_1'
const USER = 'user_1'
const RUN_DAY = '2026-01-01'

/** The reader's two statements: `select(columns)` from `EntityInstance` is the instance read, `select()` the value read. */
const db = {
  select: (columns?: unknown) => chain(columns === undefined),
} as never

function chain(values: boolean) {
  let instances = false
  const link: Record<string, unknown> = {}
  link.from = (table: unknown) => {
    instances = table === schema.EntityInstance && !values
    return link
  }
  for (const step of ['leftJoin', 'innerJoin', 'where', 'groupBy', 'limit', 'orderBy']) {
    link[step] = () => link
  }
  // biome-ignore lint/suspicious/noThenProperty: the double stands in for a drizzle query builder, which IS awaitable
  link.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(rowsFor(instances, values)).then(resolve, reject)
  return link
}

function rowsFor(instances: boolean, values: boolean): unknown[] {
  if (instances) {
    return [...h.parts].map(([partId, part]) => ({
      id: partId,
      organizationId: ORG,
      entityDefinitionId: 'def_part',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      archivedAt: null,
      displayName: part.displayName,
    }))
  }
  if (values) {
    return [...h.parts].flatMap(([partId, part]) =>
      part.kind === null
        ? []
        : [
            {
              id: `${partId}:kind`,
              entityId: partId,
              fieldId: 'fld_part_kind',
              sortKey: 'a',
              optionId: part.kind,
            },
          ]
    )
  }
  return []
}

const ALL_ATTRS = [
  'part_kind',
  'stock_movement_part',
  'stock_movement_unit_cost',
  'stock_movement_cost_basis',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  'stock_movement_occurred_at',
]

beforeEach(async () => {
  vi.clearAllMocks()
  h.serviceBlockers = new Map()
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
  h.anchored = new Set()
  const { ok } = await import('neverthrow')
  h.setCount.mockImplementation(
    async (_db: unknown, _org: string, input: { partId: string; quantity: number; day: string }) =>
      ok({
        outcome: h.anchored.has(input.partId) ? 'adjust' : 'initial',
        partId: input.partId,
        countQuantity: input.quantity,
        countDate: input.day,
        net: 0,
        delta: input.quantity,
        pending: false,
        movement: {
          movementId: `mv_${input.partId}`,
          recordId: `def_mv:mv_${input.partId}`,
          partInstanceId: input.partId,
          quantity: input.quantity,
          unitCost: 100,
          extendedCost: 100 * input.quantity,
          glAccount:
            input.partId === 'part_2' ? 'inventory_finished_goods' : 'inventory_raw_materials',
          occurredAt: new Date(`${input.day}T00:00:00.000Z`),
          vendorUnitPrice: null,
          vendorPartId: null,
          purchaseOrderLineId: null,
        },
      })
  )
})

const ENTRIES: OpeningStockEntry[] = [
  { partId: 'part_1', quantity: 10, unitCost: 1200 },
  { partId: 'part_2', quantity: 4, unitCost: 550 },
]

async function run(
  entries: OpeningStockEntry[] = ENTRIES,
  extra: { adjustAnchored?: boolean } = {}
): Promise<BulkOpeningStockSummary> {
  const result = await bulkOpenStockBalance(db, ORG, USER, {
    day: RUN_DAY,
    entries,
    ...extra,
  })
  expect(result.isOk()).toBe(true)
  return result._unsafeUnwrap()
}

function countInputs(): Array<{
  partId: string
  quantity: number
  unitCost?: number
  day?: string
}> {
  return h.setCount.mock.calls.map((call) => call[2] as never)
}

describe('bulkOpenStockBalance is setCount per part', () => {
  it('calls setCount once per accepted part, as the actor, with the typed cost', async () => {
    const summary = await run()
    expect(countInputs()).toEqual([
      { partId: 'part_1', quantity: 10, unitCost: 1200, day: RUN_DAY, actorUserId: USER },
      { partId: 'part_2', quantity: 4, unitCost: 550, day: RUN_DAY, actorUserId: USER },
    ])
    expect(summary.opened.map((row) => [row.partId, row.outcome, row.movementId])).toEqual([
      ['part_1', 'initial', 'mv_part_1'],
      ['part_2', 'initial', 'mv_part_2'],
    ])
  })

  it('dates each part on its own count day, falling back to the run date', async () => {
    const own = '2026-02-14'
    const summary = await run([
      { partId: 'part_1', quantity: 1, day: own },
      { partId: 'part_2', quantity: 1 },
    ])
    expect(countInputs().map((input) => input.day)).toEqual([own, RUN_DAY])
    expect(summary.opened.map((row) => row.countDate)).toEqual(['2026-02-14', '2026-01-01'])
    expect(summary.day).toBe(RUN_DAY)
  })

  it('totals the run by inventory account from the rows written', async () => {
    const summary = await run()
    expect(summary.totalsByGlAccount).toEqual([
      { glAccount: 'inventory_finished_goods', partCount: 1, extendedCost: 400 },
      { glAccount: 'inventory_raw_materials', partCount: 1, extendedCost: 1000 },
    ])
  })
})

describe('a typed unit cost that changed the standard', () => {
  it('rides on the opened row, and on an unchanged count', async () => {
    const { ok } = await import('neverthrow')
    const change = { action: 'restated', standardCost: 1200, revaluationPostedMinor: 300 }
    const base = h.setCount.getMockImplementation()
    h.setCount.mockImplementationOnce(async (...args: unknown[]) => {
      const result = await (base as (...a: unknown[]) => Promise<{ value: object }>)(...args)
      return ok({ ...result.value, standardCostChange: change })
    })
    h.setCount.mockResolvedValueOnce(
      ok({
        outcome: 'unchanged',
        partId: 'part_2',
        countQuantity: 4,
        countDate: RUN_DAY,
        net: 4,
        delta: 0,
        movement: null,
        pending: false,
        standardCostChange: change,
      })
    )
    const summary = await run()
    expect(summary.opened[0]?.standardCostChange).toEqual(change)
    expect(summary.excluded[0]).toMatchObject({
      partId: 'part_2',
      reason: 'unchanged',
      standardCostChange: change,
      detail: expect.stringContaining('only the standard cost'),
    })
  })
})

describe('an anchored part', () => {
  it('is excluded by default, with the adjust leg named, and the others still run', async () => {
    h.anchored = new Set(['part_1'])
    const summary = await run()
    expect(summary.excluded).toEqual([
      {
        partId: 'part_1',
        reason: 'already_has_initial',
        detail: expect.stringMatching(/already anchored/i),
      },
    ])
    expect(summary.excluded[0]?.detail).toMatch(/adjustment/i)
    expect(countInputs().map((input) => input.partId)).toEqual(['part_2'])
  })

  it('takes the adjust leg when the caller opted in', async () => {
    h.anchored = new Set(['part_1'])
    const summary = await run(ENTRIES, { adjustAnchored: true })
    expect(summary.excluded).toEqual([])
    expect(summary.opened.map((row) => [row.partId, row.outcome])).toEqual([
      ['part_1', 'adjust'],
      ['part_2', 'initial'],
    ])
  })

  it('reports a count that changed nothing as unchanged, not as a row', async () => {
    const { ok } = await import('neverthrow')
    h.setCount.mockResolvedValueOnce(
      ok({
        outcome: 'unchanged',
        partId: 'part_1',
        countQuantity: 10,
        countDate: '2026-01-01',
        net: 10,
        delta: 0,
        movement: null,
        pending: false,
      })
    )
    const summary = await run()
    expect(summary.excluded).toEqual([
      {
        partId: 'part_1',
        reason: 'unchanged',
        detail: expect.stringContaining('10 on 2026-01-01'),
      },
    ])
    expect(summary.opened.map((row) => row.partId)).toEqual(['part_2'])
  })
})

describe('the per-entry guards', () => {
  it.each([
    -5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('fails an entry with a quantity of %s and still counts the rest', async (quantity) => {
    const summary = await run([{ partId: 'part_1', quantity, unitCost: 1200 }, ...ENTRIES.slice(1)])
    expect(summary.failed).toEqual([
      { partId: 'part_1', reason: 'invalid_quantity', detail: expect.any(String) },
    ])
    expect(summary.opened.map((row) => row.partId)).toEqual(['part_2'])
  })

  it('accepts a count of zero', async () => {
    const summary = await run([{ partId: 'part_1', quantity: 0, unitCost: 100 }])
    expect(summary.failed).toEqual([])
    expect(countInputs()[0]?.quantity).toBe(0)
  })

  it.each([
    -1200,
    Number.NaN,
    1.234567,
  ])('fails an entry with a unit cost of %s rather than rounding or reinterpreting it', async (unitCost) => {
    const summary = await run([{ partId: 'part_1', quantity: 10, unitCost }, ...ENTRIES.slice(1)])
    expect(summary.failed).toEqual([
      { partId: 'part_1', reason: 'invalid_unit_cost', detail: expect.any(String) },
    ])
    expect(summary.opened.map((row) => row.partId)).toEqual(['part_2'])
  })

  it('accepts a typed $0 cost and an entry with no cost at all', async () => {
    const summary = await run([
      { partId: 'part_1', quantity: 1, unitCost: 0 },
      { partId: 'part_2', quantity: 1 },
    ])
    expect(summary.failed).toEqual([])
    expect(countInputs().map((input) => input.unitCost)).toEqual([0, undefined])
  })

  it('fails a stale part id rather than inventing a write target', async () => {
    const summary = await run([{ partId: 'ghost', quantity: 1, unitCost: 100 }, ...ENTRIES])
    expect(summary.failed).toEqual([
      { partId: 'ghost', reason: 'unknown_part', detail: expect.any(String) },
    ])
    expect(summary.opened).toHaveLength(2)
  })

  it('fails a service per row and still counts the rest (107-D10)', async () => {
    h.parts.set('part_svc', { displayName: 'Installation', kind: 'service' })
    const summary = await run([{ partId: 'part_svc', quantity: 1, unitCost: 100 }, ...ENTRIES])
    expect(summary.failed).toEqual([
      { partId: 'part_svc', reason: 'service_part', detail: expect.any(String) },
    ])
    expect(countInputs().map((input) => input.partId)).toEqual(['part_1', 'part_2'])
  })

  it('counts a part named twice exactly once, and says so', async () => {
    const summary = await run([
      { partId: 'part_1', quantity: 10, unitCost: 1200 },
      { partId: 'part_1', quantity: 3, unitCost: 900 },
    ])
    expect(countInputs().map((input) => input.quantity)).toEqual([10])
    expect(summary.excluded[0]).toMatchObject({ partId: 'part_1', reason: 'duplicate_entry' })
  })

  it('reports a refused count against its own part and keeps going', async () => {
    const { err } = await import('neverthrow')
    h.setCount.mockResolvedValueOnce(err(new BadRequestError('refused')))
    const summary = await run()
    expect(summary.failed).toEqual([
      { partId: 'part_1', reason: 'write_failed', detail: 'refused' },
    ])
    expect(summary.opened.map((row) => row.partId)).toEqual(['part_2'])
  })

  it('accounts for every entry exactly once', async () => {
    h.anchored = new Set(['part_3'])
    const summary = await run([
      ...ENTRIES,
      { partId: 'part_3', quantity: 1, unitCost: 100 },
      { partId: 'ghost', quantity: 1, unitCost: 100 },
      { partId: 'part_1', quantity: -1, unitCost: 100 },
    ])
    expect(summary.requested).toBe(5)
    expect(summary.opened.length + summary.excluded.length + summary.failed.length).toBe(5)
  })
})

describe('the whole-run preconditions', () => {
  it('errors when the org has no stock_movement definition', async () => {
    h.defs.delete('stock_movement')
    const result = await bulkOpenStockBalance(db, ORG, USER, { entries: ENTRIES })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('errors when the movement cost fields are not materialised', async () => {
    h.materialised.delete('stock_movement_unit_cost')
    const result = await bulkOpenStockBalance(db, ORG, USER, { entries: ENTRIES })
    expect(result.isErr()).toBe(true)
    expect(h.setCount).not.toHaveBeenCalled()
  })
})

describe('bulkSetPartKind', () => {
  it('sets the kind on every named part in one write', async () => {
    h.bulkSetFieldValueSpy.mockResolvedValue({ count: 2 })
    const result = await bulkSetPartKind(db, ORG, USER, ['part_1', 'part_2'], 'finished_good')
    expect(h.bulkSetFieldValueSpy).toHaveBeenCalledWith(
      ['def_part:part_1', 'def_part:part_2'],
      'fld_part_kind',
      'finished_good'
    )
    expect(result._unsafeUnwrap()).toEqual({ count: 2, failed: [] })
  })

  it('de-duplicates the selection', async () => {
    await bulkSetPartKind(db, ORG, USER, ['part_1', 'part_1', ''], 'component')
    expect(h.bulkSetFieldValueSpy).toHaveBeenCalledWith(
      ['def_part:part_1'],
      'fld_part_kind',
      'component'
    )
  })

  // An unrecognised value stores as an optionId nothing maps, which reads as the default account.
  it('refuses a value that is not a part kind, and writes nothing', async () => {
    const result = await bulkSetPartKind(db, ORG, USER, ['part_1'], 'widget')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(h.bulkSetFieldValueSpy).not.toHaveBeenCalled()
  })

  it('writes nothing for an empty selection', async () => {
    const result = await bulkSetPartKind(db, ORG, USER, [], 'component')
    expect(result._unsafeUnwrap()).toEqual({ count: 0, failed: [] })
    expect(h.bulkSetFieldValueSpy).not.toHaveBeenCalled()
  })

  it('refuses service per part when the part is stocked, and writes the rest', async () => {
    h.serviceBlockers = new Map([['part_1', 'it has stock movements']])
    h.bulkSetFieldValueSpy.mockResolvedValue({ count: 1 })
    const result = await bulkSetPartKind(db, ORG, USER, ['part_1', 'part_2'], 'service')
    expect(h.bulkSetFieldValueSpy).toHaveBeenCalledWith(
      ['def_part:part_2'],
      'fld_part_kind',
      'service'
    )
    expect(result._unsafeUnwrap()).toEqual({
      count: 1,
      failed: [{ partId: 'part_1', detail: 'refused: it has stock movements' }],
    })
  })

  it('writes nothing when every part is refused as a service', async () => {
    h.serviceBlockers = new Map([['part_1', 'it has builds']])
    const result = await bulkSetPartKind(db, ORG, USER, ['part_1'], 'service')
    expect(result._unsafeUnwrap().count).toBe(0)
    expect(h.bulkSetFieldValueSpy).not.toHaveBeenCalled()
  })
})
