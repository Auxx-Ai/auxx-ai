// packages/lib/src/inventory/movements/__tests__/fill-pending-cost.test.ts
// The one lane that prices a `pending` row (111 Q18, fill once). The org cache,
// the system-records reader and the CRUD handler are mocked, so nothing here
// needs a database.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../../errors'

interface StoredMovement {
  id: string
  partId: string
  quantity: number | null
  costBasis: string | null
  glAccount: string | null
  occurredAt: string | null
}

const h = vi.hoisted(() => ({
  updateSpy: vi.fn(async (_recordId: string, _values: Record<string, unknown>) => ({})),
  /** Options every `UnifiedCrudHandler` was constructed with. */
  constructions: [] as (Record<string, unknown> | undefined)[],
  materialised: new Set<string>(),
  /** The rows the reader finds, by id. */
  stored: new Map<string, StoredMovement>(),
}))

vi.mock('../../../cache', () => ({
  requireCachedEntityDefId: vi.fn(async () => 'def_mv'),
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
    constructor(
      _org: string,
      _user: string,
      _db: unknown,
      _socketId: unknown,
      options?: Record<string, unknown>
    ) {
      h.constructions.push(options)
    }
    update = h.updateSpy
  },
}))

vi.mock('../../../resources/system-records', async () => ({
  ...(await vi.importActual<typeof import('../../../resources/system-records')>(
    '../../../resources/system-records'
  )),
  readSystemRecords: async (
    _db: unknown,
    _org: string,
    _ctx: unknown,
    options: { ids: string[] }
  ) =>
    options.ids.flatMap((id) => {
      const row = h.stored.get(id)
      if (!row) return []
      return [
        {
          id,
          option: () => row.costBasis,
          number: () => row.quantity,
          related: () => row.partId,
          text: () => row.glAccount,
          date: () => row.occurredAt,
        },
      ]
    }),
}))

import { fillPendingCost } from '../fill-pending-cost'

const ORG = 'org_1'
const db = {} as never

const ALL_ATTRS = [
  'stock_movement_part',
  'stock_movement_quantity',
  'stock_movement_cost_basis',
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  'stock_movement_occurred_at',
]

function pendingRow(id: string, quantity: number): StoredMovement {
  return {
    id,
    partId: 'part_1',
    quantity,
    costBasis: 'pending',
    glAccount: 'inventory_finished_goods',
    occurredAt: '2026-09-03T12:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.constructions = []
  h.materialised = new Set(ALL_ATTRS)
  h.stored = new Map([
    ['mv_sale', pendingRow('mv_sale', -3)],
    ['mv_adjust', pendingRow('mv_adjust', 7)],
  ])
})

async function expectErr(promise: ReturnType<typeof fillPendingCost>) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

describe('fillPendingCost - the fill', () => {
  it('writes unit cost, an extended cost signed like the quantity, and basis standard onto the same row', async () => {
    const result = await fillPendingCost(db, ORG, [
      { movementId: 'mv_sale', unitCost: 1_000 },
      { movementId: 'mv_adjust', unitCost: 1_000 },
    ])
    expect(result.isOk()).toBe(true)
    expect(h.updateSpy).toHaveBeenCalledTimes(2)
    expect(h.updateSpy).toHaveBeenCalledWith('def_mv:mv_sale', {
      stock_movement_unit_cost: 1_000,
      stock_movement_extended_cost: -3_000,
      stock_movement_cost_basis: 'standard',
    })
    expect(h.updateSpy).toHaveBeenCalledWith('def_mv:mv_adjust', {
      stock_movement_unit_cost: 1_000,
      stock_movement_extended_cost: 7_000,
      stock_movement_cost_basis: 'standard',
    })
    expect(result._unsafeUnwrap()).toEqual([
      expect.objectContaining({
        movementId: 'mv_sale',
        partInstanceId: 'part_1',
        quantity: -3,
        unitCost: 1_000,
        extendedCost: -3_000,
        glAccount: 'inventory_finished_goods',
        occurredAt: new Date('2026-09-03T12:00:00.000Z'),
      }),
      expect.objectContaining({ movementId: 'mv_adjust', extendedCost: 7_000 }),
    ])
  })

  it('rounds the unit cost to rate precision and multiplies before rounding', async () => {
    h.stored.set('mv_adjust', pendingRow('mv_adjust', 3))
    await fillPendingCost(db, ORG, [{ movementId: 'mv_adjust', unitCost: 0.4 }])
    expect(h.updateSpy).toHaveBeenCalledWith('def_mv:mv_adjust', {
      stock_movement_unit_cost: 0.4,
      stock_movement_extended_cost: 1,
      stock_movement_cost_basis: 'standard',
    })
  })

  // 103 §5a: a stored $0 standard is a real cost, and pricing at it is a real fill.
  it('accepts a $0 standard', async () => {
    const result = await fillPendingCost(db, ORG, [{ movementId: 'mv_sale', unitCost: 0 }])
    expect(result.isOk()).toBe(true)
    expect(h.updateSpy).toHaveBeenCalledWith('def_mv:mv_sale', {
      stock_movement_unit_cost: 0,
      stock_movement_extended_cost: 0,
      stock_movement_cost_basis: 'standard',
    })
  })

  // `updatable: false` is advisory and unread on this path; the quiet automation
  // session is what keeps the fill off the interactive doors and their events.
  it('writes through one CRUD handler on a quiet session, and never an interactive one', async () => {
    await fillPendingCost(db, ORG, [{ movementId: 'mv_sale', unitCost: 100 }])
    expect(h.constructions).toHaveLength(1)
    expect(h.constructions[0]).toMatchObject({
      session: { origin: { kind: 'automation' }, mode: { kind: 'quiet' } },
    })
  })

  it('writes nothing for an empty batch', async () => {
    const result = await fillPendingCost(db, ORG, [])
    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.updateSpy).not.toHaveBeenCalled()
  })
})

describe('fillPendingCost - fill ONCE', () => {
  it('refuses a row whose basis is already standard, and writes nothing for the batch', async () => {
    h.stored.set('mv_adjust', { ...pendingRow('mv_adjust', 7), costBasis: 'standard' })
    const error = await expectErr(
      fillPendingCost(db, ORG, [
        { movementId: 'mv_sale', unitCost: 100 },
        { movementId: 'mv_adjust', unitCost: 100 },
      ])
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/written once/)
    expect(h.updateSpy).not.toHaveBeenCalled()
  })

  it('refuses a pre-regime row with a null basis - null is not pending', async () => {
    h.stored.set('mv_sale', { ...pendingRow('mv_sale', -3), costBasis: null })
    const error = await expectErr(
      fillPendingCost(db, ORG, [{ movementId: 'mv_sale', unitCost: 100 }])
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.updateSpy).not.toHaveBeenCalled()
  })

  it('refuses a movement that does not exist', async () => {
    const error = await expectErr(
      fillPendingCost(db, ORG, [{ movementId: 'mv_ghost', unitCost: 100 }])
    )
    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.updateSpy).not.toHaveBeenCalled()
  })

  it('refuses a movement named twice in one pass', async () => {
    const error = await expectErr(
      fillPendingCost(db, ORG, [
        { movementId: 'mv_sale', unitCost: 100 },
        { movementId: 'mv_sale', unitCost: 200 },
      ])
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.updateSpy).not.toHaveBeenCalled()
  })

  it('refuses a negative or non-finite cost', async () => {
    for (const unitCost of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = await expectErr(fillPendingCost(db, ORG, [{ movementId: 'mv_sale', unitCost }]))
      expect(error).toBeInstanceOf(BadRequestError)
    }
    expect(h.updateSpy).not.toHaveBeenCalled()
  })

  it('refuses a pending row with no quantity rather than inventing an extended cost', async () => {
    h.stored.set('mv_sale', { ...pendingRow('mv_sale', -3), quantity: null })
    const error = await expectErr(
      fillPendingCost(db, ORG, [{ movementId: 'mv_sale', unitCost: 100 }])
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.updateSpy).not.toHaveBeenCalled()
  })

  it('refuses before the cost fields are provisioned', async () => {
    h.materialised.delete('stock_movement_unit_cost')
    const error = await expectErr(
      fillPendingCost(db, ORG, [{ movementId: 'mv_sale', unitCost: 100 }])
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.updateSpy).not.toHaveBeenCalled()
  })
})
