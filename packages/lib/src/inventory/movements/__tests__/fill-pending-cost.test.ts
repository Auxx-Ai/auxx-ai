// packages/lib/src/inventory/movements/__tests__/fill-pending-cost.test.ts
// The one lane that prices a `pending` row (111 Q18, fill once). The table reads and the
// in-place UPDATE are mocked, so nothing here needs a database.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, NotFoundError } from '../../../errors'
import { computeExtendedCost } from '../client'

interface StoredMovement {
  id: string
  partId: string
  quantity: number
  costBasis: string | null
  glRole: string | null
  occurredAt: Date | null
}

const h = vi.hoisted(() => ({
  fillSpy: vi.fn(),
  stored: new Map<string, StoredMovement>(),
}))

vi.mock('../reads', () => ({
  readMovementsByIds: async (_db: unknown, _org: string, ids: string[]) =>
    ids.flatMap((id) => (h.stored.has(id) ? [h.stored.get(id)!] : [])),
}))

// The UPDATE's `costBasis = 'pending'` predicate is the claim; here, what the fake store says.
vi.mock('../update-movements', () => ({
  fillPendingMovementCosts: async (
    tx: unknown,
    org: string,
    fills: Array<{ id: string; unitCostMinor: number }>
  ) => {
    h.fillSpy(tx, org, fills)
    return fills.flatMap((fill) => {
      const row = h.stored.get(fill.id)
      if (row?.costBasis !== 'pending') return []
      return [
        {
          id: row.id,
          partId: row.partId,
          quantity: row.quantity,
          unitCostMinor: fill.unitCostMinor,
          extendedCostMinor: computeExtendedCost(fill.unitCostMinor, row.quantity) || 0,
          glRole: row.glRole,
          occurredAt: row.occurredAt,
        },
      ]
    })
  },
}))

import { fillPendingCost } from '../fill-pending-cost'

const ORG = 'org_1'
const db = { transaction: async (run: (tx: unknown) => unknown) => run({}) } as never

function pendingRow(id: string, quantity: number): StoredMovement {
  return {
    id,
    partId: 'part_1',
    quantity,
    costBasis: 'pending',
    glRole: 'inventory_finished_goods',
    occurredAt: new Date('2026-09-03T12:00:00.000Z'),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
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
  it('fills unit cost and an extended cost signed like the quantity', async () => {
    const result = await fillPendingCost(db, ORG, [
      { movementId: 'mv_sale', unitCost: 1_000 },
      { movementId: 'mv_adjust', unitCost: 1_000 },
    ])
    expect(result.isOk()).toBe(true)
    expect(h.fillSpy).toHaveBeenCalledWith({}, ORG, [
      { id: 'mv_sale', unitCostMinor: 1_000 },
      { id: 'mv_adjust', unitCostMinor: 1_000 },
    ])
    expect(result._unsafeUnwrap()).toEqual([
      {
        movementId: 'mv_sale',
        partInstanceId: 'part_1',
        quantity: -3,
        unitCost: 1_000,
        extendedCost: -3_000,
        glRole: 'inventory_finished_goods',
        occurredAt: new Date('2026-09-03T12:00:00.000Z'),
      },
      expect.objectContaining({ movementId: 'mv_adjust', extendedCost: 7_000 }),
    ])
  })

  it('rounds the unit cost to rate precision before the fill', async () => {
    await fillPendingCost(db, ORG, [{ movementId: 'mv_adjust', unitCost: 0.4000001 }])
    expect(h.fillSpy).toHaveBeenCalledWith({}, ORG, [{ id: 'mv_adjust', unitCostMinor: 0.4 }])
  })

  // 103 §5a: a stored $0 standard is a real cost, and pricing at it is a real fill.
  it('accepts a $0 standard', async () => {
    const result = await fillPendingCost(db, ORG, [{ movementId: 'mv_sale', unitCost: 0 }])
    expect(result._unsafeUnwrap()).toEqual([
      expect.objectContaining({ unitCost: 0, extendedCost: 0 }),
    ])
  })

  it('writes nothing for an empty batch', async () => {
    const result = await fillPendingCost(db, ORG, [])
    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.fillSpy).not.toHaveBeenCalled()
  })
})

describe('fillPendingCost - fill ONCE', () => {
  it('skips a row another pass already priced, and fills the rest', async () => {
    h.stored.set('mv_adjust', { ...pendingRow('mv_adjust', 7), costBasis: 'standard' })
    const result = await fillPendingCost(db, ORG, [
      { movementId: 'mv_sale', unitCost: 100 },
      { movementId: 'mv_adjust', unitCost: 100 },
    ])
    expect(result._unsafeUnwrap().map((row) => row.movementId)).toEqual(['mv_sale'])
  })

  it('skips a pre-regime row with a null basis - null is not pending', async () => {
    h.stored.set('mv_sale', { ...pendingRow('mv_sale', -3), costBasis: null })
    const result = await fillPendingCost(db, ORG, [{ movementId: 'mv_sale', unitCost: 100 }])
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('refuses a movement that does not exist', async () => {
    const error = await expectErr(
      fillPendingCost(db, ORG, [{ movementId: 'mv_ghost', unitCost: 100 }])
    )
    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.fillSpy).not.toHaveBeenCalled()
  })

  it('refuses a movement named twice in one pass', async () => {
    const error = await expectErr(
      fillPendingCost(db, ORG, [
        { movementId: 'mv_sale', unitCost: 100 },
        { movementId: 'mv_sale', unitCost: 200 },
      ])
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.fillSpy).not.toHaveBeenCalled()
  })

  it('refuses a negative or non-finite cost', async () => {
    for (const unitCost of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = await expectErr(fillPendingCost(db, ORG, [{ movementId: 'mv_sale', unitCost }]))
      expect(error).toBeInstanceOf(BadRequestError)
    }
    expect(h.fillSpy).not.toHaveBeenCalled()
  })
})
