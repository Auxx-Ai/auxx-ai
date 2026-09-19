// packages/lib/src/accounting/purchasing/bill-intake/__tests__/fold.test.ts

import type { Database } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as unknown[][],
  update: vi.fn(),
  remove: vi.fn(),
  flush: vi.fn(),
  events: [] as string[],
}))

vi.mock('../../../../cache', () => ({
  getCachedEntityDefId: async (_org: string, type: string) => `def_${type}`,
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((attr) => [attr, { id: attr }])),
    }),
  }),
}))
vi.mock('../../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = h.update
    delete = h.remove
  },
}))
vi.mock('../../../../resources/crud/tx-write-scope', () => ({
  runInTxWrite: async (_args: unknown, fn: () => Promise<unknown>) => ({
    result: await fn(),
    scope: {},
    owned: true,
  }),
}))
vi.mock('../../../../resources/crud/tx-write-flush', () => ({ flushTxWriteScope: h.flush }))

import { foldBillLineIntoShipping } from '../fold'

function chain(rows: unknown[]): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'then' ? (resolve: (rows: unknown[]) => void) => resolve(rows) : () => proxy,
    }
  )
  return proxy
}
const tx = { select: () => chain(h.rows.shift() ?? []) }
const db = {
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    try {
      const result = await fn(tx)
      h.events.push('commit')
      return result
    } catch (error) {
      h.events.push('rollback')
      throw error
    }
  },
} as unknown as Database
const input = {
  billRecordId: toRecordId('def_vendor_bill', 'bill'),
  lineRecordId: toRecordId('def_vendor_bill_line', 'line'),
}

function rows({
  shipping = null,
  parent = 'bill',
  linked = null,
  total = 4321,
}: {
  shipping?: number | null
  parent?: string
  linked?: string | null
  total?: number | null
} = {}) {
  h.rows = [
    [{ id: 'bill' }],
    [{ id: 'line' }],
    [
      { entityId: 'bill', fieldId: 'vendor_bill_shipping_total', valueNumber: shipping },
      { entityId: 'line', fieldId: 'vendor_bill_line_vendor_bill', relatedEntityId: parent },
      {
        entityId: 'line',
        fieldId: 'vendor_bill_line_purchase_order_line',
        relatedEntityId: linked,
      },
      { entityId: 'line', fieldId: 'vendor_bill_line_line_total', valueNumber: total },
    ],
    [{ valueNumber: total }],
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.events = []
  h.update.mockImplementation(async () => {
    h.events.push('update')
  })
  h.remove.mockImplementation(async () => {
    h.events.push('delete')
  })
  h.flush.mockImplementation(async () => {
    h.events.push('flush')
  })
  rows()
})

describe('foldBillLineIntoShipping', () => {
  it('copies only the printed amount and announces changes after commit', async () => {
    const result = await foldBillLineIntoShipping(db, 'org', 'user', input)
    expect(result._unsafeUnwrap()).toEqual({ shippingTotal: 4321 })
    expect(h.update).toHaveBeenCalledWith(input.billRecordId, { vendor_bill_shipping_total: 4321 })
    expect(h.remove).toHaveBeenCalledWith(input.lineRecordId)
    expect(h.events).toEqual(['update', 'delete', 'commit', 'flush'])
  })

  it.each([
    [{ shipping: 100 }, 'already has a shipping'],
    [{ parent: 'other_bill' }, 'does not belong'],
    [{ linked: 'order_line' }, 'linked to an order'],
    [{ total: null }, 'printed line total'],
  ] as const)('refuses an unsafe move before any writes: %o', async (state, message) => {
    rows(state)
    const result = await foldBillLineIntoShipping(db, 'org', 'user', input)
    expect(result._unsafeUnwrapErr().message).toContain(message)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.remove).not.toHaveBeenCalled()
    expect(h.flush).not.toHaveBeenCalled()
  })

  it('keeps a line when a field guard silently refuses the shipping write', async () => {
    h.rows[3] = [{ valueNumber: null }]
    const result = await foldBillLineIntoShipping(db, 'org', 'user', input)
    expect(result.isErr()).toBe(true)
    expect(h.remove).not.toHaveBeenCalled()
    expect(h.events).toEqual(['update', 'rollback'])
  })

  it('rolls back shipping when deletion fails, with no notifications', async () => {
    h.remove.mockRejectedValueOnce(new Error('delete failed'))
    const result = await foldBillLineIntoShipping(db, 'org', 'user', input)
    expect(result.isErr()).toBe(true)
    expect(h.events).toEqual(['update', 'rollback'])
    expect(h.flush).not.toHaveBeenCalled()
  })

  it('rejects a record id from the wrong definition', async () => {
    const result = await foldBillLineIntoShipping(db, 'org', 'user', {
      ...input,
      lineRecordId: toRecordId('company', 'line'),
    })
    expect(result.isErr()).toBe(true)
    expect(h.update).not.toHaveBeenCalled()
  })
})
