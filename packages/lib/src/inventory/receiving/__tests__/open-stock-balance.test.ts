// packages/lib/src/inventory/receiving/__tests__/open-stock-balance.test.ts
//
// The create form's opening balance is `setCount` dated `occurredAt` (103 O1, 111 D21): this
// pins the delegation. `setCount` itself is tested in `set-count.test.ts`; `G12`'s guard on
// `adjustStock` stays pinned here because the typed count cost one file over is what it
// must not be read as permission for.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../../errors'

const h = vi.hoisted(() => ({
  setCount: vi.fn(),
  createSpy: vi.fn(async (_defId: string, _values: Record<string, unknown>) => ({
    instance: { id: 'mv_1' },
  })),
  partKind: null as string | null,
  standardCost: null as number | null,
}))

vi.mock('../set-count', () => ({ setCount: h.setCount }))
vi.mock('../../../accounting/work-items/write', () => ({ upsertWorkItem: vi.fn() }))
vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn(async () => undefined),
  requireCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => `def_${entityType}`),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, { id: `fld_${a}` }])),
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
vi.mock('../../costing/qoh', () => ({ batchRecalculateQoH: vi.fn() }))
vi.mock('../../../accounting/ledger/post/post-inventory-document', () => ({
  postInventoryDocumentInTx: async () => null,
}))
vi.mock('../../../accounting/ledger/post/post-inventory-movement', () => ({
  exportInventoryMovement: async () => null,
}))

import { adjustStock } from '../adjust-stock'
import { openStockBalance } from '../open-stock-balance'
import type { AdjustStockInput } from '../types'

const ORG = 'org_1'
const USER = 'user_1'
const db = { transaction: async (fn: (tx: unknown) => unknown) => fn(db) } as never

beforeEach(async () => {
  vi.clearAllMocks()
  h.partKind = null
  h.standardCost = null
  const { ok } = await import('neverthrow')
  h.setCount.mockResolvedValue(ok({ outcome: 'initial', partId: 'part_1' }))
})

describe('openStockBalance is setCount', () => {
  it('hands the part, quantity, cost, notes and actor through, dated occurredAt', async () => {
    const occurredAt = new Date('2026-01-01T00:00:00.000Z')
    const result = await openStockBalance(db, ORG, USER, {
      partId: 'part_1',
      quantity: 10,
      unitCost: 1200,
      occurredAt,
      notes: 'Opening count',
    })
    expect(result.isOk()).toBe(true)
    expect(h.setCount).toHaveBeenCalledWith(db, ORG, {
      partId: 'part_1',
      quantity: 10,
      date: occurredAt,
      unitCost: 1200,
      actorUserId: USER,
      notes: 'Opening count',
    })
  })

  it('dates the count today when no occurredAt is given', async () => {
    const before = Date.now()
    await openStockBalance(db, ORG, USER, { partId: 'part_1', quantity: 10, unitCost: 1200 })
    const { date } = h.setCount.mock.calls[0]![2] as { date: Date }
    expect(date.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('returns exactly what setCount answered', async () => {
    const { err } = await import('neverthrow')
    h.setCount.mockResolvedValue(err(new BadRequestError('refused')))
    const result = await openStockBalance(db, ORG, USER, { partId: 'part_1', quantity: 10 })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })
})

// 🛑 The regression guard `plans/money/tasks/15-costing-usability.md` §5 asks for by name:
// "`adjustStock` regaining a unit-cost input. Refused in §2.2. `G12` stands."
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
    expect(h.createSpy.mock.calls[0]![1].stock_movement_unit_cost).toBe(4400)
  })

  it('refuses a service as a service, not as a part missing a standard (107-D10)', async () => {
    h.partKind = 'service'
    const result = await adjustStock(db, ORG, USER, { partId: 'part_1', quantity: 5 })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(h.createSpy).not.toHaveBeenCalled()
  })
})
