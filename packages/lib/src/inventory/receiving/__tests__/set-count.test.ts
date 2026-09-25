// packages/lib/src/inventory/receiving/__tests__/set-count.test.ts
//
// The one count door (111 D21, Q15, Q19, Q26): what a first count anchors, what a further
// count adjusts, and what posts. The org cache, the CRUD handler, the dated reads and the
// part reads are mocked; the movement writer and the document poster's call are real.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, UnprocessableEntityError } from '../../../errors'

const h = vi.hoisted(() => ({
  createSpy: vi.fn(async (_defId: string, _values: Record<string, unknown>) => ({
    instance: { id: 'mv_new' },
  })),
  ensureSpy: vi.fn(),
  postSpy: vi.fn(async (..._args: unknown[]) => null as unknown),
  batchQohSpy: vi.fn(async () => {}),
  upsertWorkItem: vi.fn(async () => ({ isOk: () => true })),
  materialised: new Set<string>(),
  partKind: null as string | null,
  standardCost: null as number | null,
  /** net(through) per part, as the dated read answers. */
  net: 0,
  earliest: null as Date | null,
  /** The part's `initial`, or none. */
  initial: null as null | {
    movementId: string
    quantity: number
    occurredAt: Date
    countQuantity: number | null
    countDate: string | null
  },
  zone: 'UTC',
}))

vi.mock('../../../accounting/work-items/write', () => ({ upsertWorkItem: h.upsertWorkItem }))
vi.mock('../../../accounting/ledger/setup/book-time-zone', () => ({
  readBookTimeZoneOrUtc: async () => h.zone,
}))
vi.mock('../../../accounting/ledger/post/post-inventory-document', () => ({
  postInventoryDocumentInTx: (...args: unknown[]) => h.postSpy(...args),
}))
vi.mock('../../../accounting/ledger/post/post-inventory-movement', () => ({
  exportInventoryMovement: async () => null,
}))
vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn(async () => undefined),
  requireCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => `def_${entityType}`),
  getOrgCache: () => ({
    get: async () => 'user_system',
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])
        ),
    }),
  }),
}))
vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    create = h.createSpy
  },
}))
vi.mock('../../../resources/system-records', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  systemDefId: async () => 'def_stock_movement',
}))
vi.mock('../../builds/build-queries', () => ({
  readPartKinds: async (_db: unknown, _org: string, ids: string[]) =>
    new Map(h.partKind ? ids.map((id) => [id, h.partKind as string]) : []),
}))
vi.mock('../receipt-queries', async () => {
  const { ok } = await import('neverthrow')
  return {
    readPartKind: vi.fn(async () => ok(h.partKind)),
    readPartStandardCost: vi.fn(async () =>
      ok({ standardCost: h.standardCost, displayName: 'Widget 9000' })
    ),
  }
})
vi.mock('../../costing/ensure-standard-cost', () => ({ ensureStandardCost: h.ensureSpy }))
vi.mock('../../costing/qoh', () => ({ batchRecalculateQoH: h.batchQohSpy }))
vi.mock('../../costing/dated-reads', () => ({
  readPartNetThrough: async (_org: string, ids: string[]) => new Map(ids.map((id) => [id, h.net])),
  readEarliestMovementAt: async (_org: string, ids: string[]) =>
    new Map(ids.map((id) => [id, h.earliest])),
}))
vi.mock('../../movements/initial-queries', () => ({
  readPartInitials: async (_db: unknown, _org: string, ids: string[]) =>
    new Map(h.initial ? ids.map((id) => [id, { ...h.initial, partInstanceId: id }]) : []),
}))

import { anchorDayFor, endOfDayInstant, setCount } from '../set-count'

const ORG = 'org_1'
const db = { transaction: async (fn: (tx: unknown) => unknown) => fn(db) } as never
const D = '2026-03-10'

beforeEach(() => {
  vi.clearAllMocks()
  h.materialised = new Set([
    'stock_movement_part',
    'stock_movement_unit_cost',
    'stock_movement_cost_basis',
    'stock_movement_extended_cost',
    'stock_movement_gl_account',
    'stock_movement_occurred_at',
  ])
  h.partKind = null
  h.standardCost = null
  h.net = 0
  h.earliest = null
  h.initial = null
  h.zone = 'UTC'
  h.createSpy.mockResolvedValue({ instance: { id: 'mv_new' } })
  h.ensureSpy.mockImplementation(async (_db: unknown, _org: string, _ids: string[], source) => {
    const { ok } = await import('neverthrow')
    if (h.standardCost == null && source.unitCost != null) h.standardCost = source.unitCost
    return ok({ writtenPartIds: ['part_1'] })
  })
})

function written(): Record<string, unknown> {
  expect(h.createSpy).toHaveBeenCalledTimes(1)
  return h.createSpy.mock.calls[0]![1]
}

async function count(input: Partial<Parameters<typeof setCount>[2]> = {}) {
  const result = await setCount(db, ORG, { partId: 'part_1', quantity: 42, day: D, ...input })
  if (result.isErr()) throw result.error
  return result.value
}

describe('a first count on a part with history reconstructs the opening', () => {
  it('writes ONE initial at the ledger start for N − net(D), carrying the count fact', async () => {
    h.earliest = new Date('2026-01-15T10:00:00.000Z')
    h.net = -830
    h.standardCost = 500
    const result = await count()
    expect(result.outcome).toBe('initial')
    expect(result).toMatchObject({
      net: -830,
      delta: 872,
      countQuantity: 42,
      countDate: '2026-03-10',
    })
    const values = written()
    expect(values).toMatchObject({
      stock_movement_type: 'initial',
      stock_movement_quantity: 872,
      stock_movement_occurred_at: '2026-01-14T00:00:00.000Z',
      stock_movement_count_quantity: 42,
      stock_movement_count_date: '2026-03-10T00:00:00.000Z',
      stock_movement_cost_basis: 'standard',
      stock_movement_unit_cost: 500,
      stock_movement_extended_cost: 436_000,
      stock_movement_gl_account: 'inventory_raw_materials',
      stock_movement_adjust_subparts: false,
    })
  })

  it('never dates the anchor after the count day, whatever the earliest movement is', async () => {
    h.earliest = new Date('2026-06-01T00:00:00.000Z')
    h.standardCost = 500
    await count()
    expect(written().stock_movement_occurred_at).toBe('2026-03-10T00:00:00.000Z')
    expect(anchorDayFor('2026-03-10', new Date('2026-06-01T00:00:00.000Z'), 'UTC')).toBe(
      '2026-03-10'
    )
    expect(anchorDayFor('2026-03-10', new Date('2026-01-15T00:00:00.000Z'), 'UTC')).toBe(
      '2026-01-14'
    )
    expect(anchorDayFor('2026-03-10', null, 'UTC')).toBe('2026-03-10')
  })

  // Q15/Q26: a count of zero on a part with earlier sales is a real anchor.
  it('accepts a count of zero when the ledger has history, writing a non-zero initial', async () => {
    h.earliest = new Date('2026-01-15T10:00:00.000Z')
    h.net = -5
    h.standardCost = 100
    const result = await count({ quantity: 0 })
    expect(result.outcome).toBe('initial')
    expect(written().stock_movement_quantity).toBe(5)
  })

  it('reads net through the END of the count day in the book zone', () => {
    expect(endOfDayInstant('2026-03-10', 'UTC').toISOString()).toBe('2026-03-10T23:59:59.999Z')
    // March 10 is already PDT (UTC−7).
    expect(endOfDayInstant('2026-03-10', 'America/Los_Angeles').toISOString()).toBe(
      '2026-03-11T06:59:59.999Z'
    )
  })
})

describe('a first count on a part with no history', () => {
  it('dates the initial on the count day itself', async () => {
    h.standardCost = 500
    await count({ quantity: 10 })
    const values = written()
    expect(values.stock_movement_type).toBe('initial')
    expect(values.stock_movement_quantity).toBe(10)
    expect(values.stock_movement_occurred_at).toBe('2026-03-10T00:00:00.000Z')
    expect(values.stock_movement_count_date).toBe('2026-03-10T00:00:00.000Z')
  })

  it('refuses a bare zero: there is nothing to anchor', async () => {
    const result = await setCount(db, ORG, { partId: 'part_1', quantity: 0, day: D })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })
})

describe('a further count on an anchored part', () => {
  beforeEach(() => {
    h.initial = {
      movementId: 'mv_initial',
      quantity: 50,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      countQuantity: 50,
      countDate: '2026-01-01',
    }
    h.earliest = new Date('2026-01-01T00:00:00.000Z')
    h.standardCost = 500
  })

  it('writes ONE adjust dated the count day for the delta, with no count fact', async () => {
    h.net = 47
    const result = await count()
    expect(result.outcome).toBe('adjust')
    expect(result.delta).toBe(-5)
    const values = written()
    expect(values.stock_movement_type).toBe('adjust')
    expect(values.stock_movement_quantity).toBe(-5)
    expect(values.stock_movement_occurred_at).toBe('2026-03-10T00:00:00.000Z')
    expect(values).not.toHaveProperty('stock_movement_count_quantity')
  })

  // Q15: the adjust is dated D for N − net(D); what happened after D is not re-read here.
  it('allows a count dated before the latest movement and leaves later movements standing', async () => {
    h.net = 40
    const result = await count({ day: '2026-02-01' })
    expect(result.outcome).toBe('adjust')
    expect(result.delta).toBe(2)
    expect(written().stock_movement_occurred_at).toBe('2026-02-01T00:00:00.000Z')
  })

  it('writes nothing for a zero delta and says so', async () => {
    h.net = 42
    const result = await count()
    expect(result).toMatchObject({ outcome: 'unchanged', delta: 0, movement: null })
    expect(h.createSpy).not.toHaveBeenCalled()
    expect(h.ensureSpy).not.toHaveBeenCalled()
  })
})

// plans/mrp/09 §10.1: a day key is resolved in the book zone, never read back from UTC midnight.
describe('the count day west of UTC', () => {
  beforeEach(() => {
    h.zone = 'America/Los_Angeles'
    h.standardCost = 500
  })

  it('anchors a first count on the day given, at its start in the book zone', async () => {
    const result = await count({ quantity: 10, day: '2026-09-22' })
    expect(result.countDate).toBe('2026-09-22')
    expect(written()).toMatchObject({
      stock_movement_occurred_at: '2026-09-22T07:00:00.000Z',
      stock_movement_count_date: '2026-09-22T00:00:00.000Z',
    })
  })

  it('dates an adjust at the same resolved instant', async () => {
    h.initial = {
      movementId: 'mv_initial',
      quantity: 50,
      occurredAt: new Date('2026-09-10T07:00:00.000Z'),
      countQuantity: 50,
      countDate: '2026-09-10',
    }
    h.net = 4
    await count({ quantity: 3, day: '2026-09-22' })
    expect(written().stock_movement_occurred_at).toBe('2026-09-22T07:00:00.000Z')
    expect(h.postSpy.mock.calls[0]![2]).toEqual([
      expect.objectContaining({ occurredAt: new Date('2026-09-22T07:00:00.000Z') }),
    ])
  })

  it('defaults to today in the book zone', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-23T03:00:00.000Z'), toFake: ['Date'] })
    try {
      const result = await count({ quantity: 10, day: undefined })
      expect(result.countDate).toBe('2026-09-22')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('what it refuses', () => {
  it('a count day that is not YYYY-MM-DD', async () => {
    const result = await setCount(db, ORG, {
      partId: 'part_1',
      quantity: 1,
      day: '2026-09-22T00:00:00.000Z',
    })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('a service', async () => {
    h.partKind = 'service'
    const result = await setCount(db, ORG, { partId: 'part_1', quantity: 1, day: D })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })

  it('a negative count', async () => {
    const result = await setCount(db, ORG, { partId: 'part_1', quantity: -1, day: D })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('a unit cost finer than a rate, or negative', async () => {
    for (const unitCost of [12.5001, -1]) {
      const result = await setCount(db, ORG, { partId: 'part_1', quantity: 1, day: D, unitCost })
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    }
  })

  it('a part holding a negative standard', async () => {
    h.standardCost = -5
    const result = await setCount(db, ORG, { partId: 'part_1', quantity: 1, day: D })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })
})

describe('cost', () => {
  it('offers a typed unit cost as the first standard, and writes the row at it', async () => {
    await count({ quantity: 3, unitCost: 1200 })
    expect(h.ensureSpy).toHaveBeenCalledWith(db, ORG, ['part_1'], {
      kind: 'opening-stock',
      unitCost: 1200,
    })
    expect(written()).toMatchObject({
      stock_movement_unit_cost: 1200,
      stock_movement_extended_cost: 3600,
      stock_movement_cost_basis: 'standard',
    })
  })

  // 103 §5a: a typed $0 is a real cost.
  it('accepts a typed $0 as a real standard', async () => {
    h.ensureSpy.mockImplementation(async () => {
      const { ok } = await import('neverthrow')
      h.standardCost = 0
      return ok({ writtenPartIds: ['part_1'] })
    })
    const result = await count({ quantity: 3, unitCost: 0 })
    expect(result.pending).toBe(false)
    expect(written()).toMatchObject({
      stock_movement_unit_cost: 0,
      stock_movement_cost_basis: 'standard',
    })
    expect(h.upsertWorkItem).not.toHaveBeenCalled()
  })

  it('writes a PENDING row with no cost keys and parks it when the part has no standard', async () => {
    const result = await count({ quantity: 3 })
    expect(result.pending).toBe(true)
    const values = written()
    expect(values.stock_movement_cost_basis).toBe('pending')
    expect(values).not.toHaveProperty('stock_movement_unit_cost')
    expect(h.postSpy).not.toHaveBeenCalled()
    expect(h.upsertWorkItem).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'stock_movement',
      sourceId: 'mv_new',
      stage: 'price',
      reasonCode: 'STANDARD_COST_MISSING',
      externalRef: 'part_1',
      detail: { partIds: ['part_1'], pendingMovementIds: ['mv_new'], partName: 'Widget 9000' },
    })
  })
})

describe('posting and QoH', () => {
  it('posts a valued row through the document poster, typed as the row it wrote', async () => {
    h.standardCost = 500
    h.initial = {
      movementId: 'mv_initial',
      quantity: 1,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      countQuantity: 1,
      countDate: '2026-01-01',
    }
    h.net = 40
    await count()
    expect(h.postSpy).toHaveBeenCalledTimes(1)
    const [, org, rows, options] = h.postSpy.mock.calls[0]!
    expect(org).toBe(ORG)
    expect(rows).toEqual([
      expect.objectContaining({
        movementId: 'mv_new',
        type: 'adjust',
        quantity: 2,
        extendedCost: 1000,
        glAccount: 'inventory_raw_materials',
        occurredAt: new Date('2026-03-10T00:00:00.000Z'),
      }),
    ])
    expect(options).toMatchObject({ actorUserId: 'user_system' })
  })

  it('recalculates QoH after the write', async () => {
    h.standardCost = 500
    await count({ quantity: 3 })
    expect(h.batchQohSpy).toHaveBeenCalledWith(ORG, ['part_1'])
  })

  it('attributes the write to the actor when one is named', async () => {
    h.standardCost = 500
    await count({ quantity: 3, actorUserId: 'user_1' })
    expect(h.postSpy.mock.calls[0]![3]).toMatchObject({ actorUserId: 'user_1' })
  })
})
