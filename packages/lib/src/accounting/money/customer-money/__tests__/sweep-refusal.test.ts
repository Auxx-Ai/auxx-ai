// packages/lib/src/accounting/money/customer-money/__tests__/sweep-refusal.test.ts
//
// The acceptance sweep's catch: a deliberate refusal is `REFUSED`, only anything else backs off.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  throws: null as Error | null,
  upsertWorkItem: vi.fn(async () => ({ isOk: () => true })),
  updateAcceptance: vi.fn(async () => undefined),
}))

vi.mock('@auxx/database', () => ({
  database: {},
  lazyDatabase: () => ({}),
  withAccountingCommitLock: vi.fn(async () => undefined),
  schema: new Proxy({} as Record<string, Record<string, string>>, {
    get: (target, table: string) => {
      target[table] ??= new Proxy({} as Record<string, string>, { get: (_t, col) => String(col) })
      return target[table]
    },
  }),
}))
vi.mock('../../../work-items/sweep', () => ({
  noWorkItem: () => undefined,
  runWorkItemSweep: async (
    _db: unknown,
    input: { handle: (id: string) => Promise<{ status: string }> }
  ) => {
    const { status } = await input.handle('acc_1')
    return { scanned: 1, failed: status === 'failed' ? 1 : 0 }
  },
}))
vi.mock('../../../work-items/write', () => ({
  upsertWorkItem: h.upsertWorkItem,
  deleteWorkItem: vi.fn(),
}))
vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingActive: async () => {
    if (h.throws) throw h.throws
    return true
  },
}))
vi.mock('../source-reads', () => ({
  readAcceptance: async () => ({ id: 'acc_1', state: 'blocked', observationId: 'obs_1' }),
  findSourceObjectByIdentity: vi.fn(),
  readSourceAccount: vi.fn(),
  readSourceObject: vi.fn(),
}))
vi.mock('../source-writes', () => ({
  updateAcceptance: h.updateAcceptance,
  refreshOrderCoverageCounts: vi.fn(),
}))

import { UnprocessableEntityError } from '../../../../errors'
import { sweepImportedCustomerMoney } from '../ingest'

const db = { transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}) } as never

beforeEach(() => {
  h.throws = null
  h.upsertWorkItem.mockClear()
})

describe('sweepImportedCustomerMoney on a throw', () => {
  it.each([
    ['an AuxxError', new UnprocessableEntityError('the receipt names no order'), 'REFUSED'],
    ['anything else', new Error('connection reset'), 'TRANSIENT_ERROR'],
  ])('parks %s as %s with its message', async (_label, error, reasonCode) => {
    h.throws = error

    expect(await sweepImportedCustomerMoney(db, 'org_1')).toEqual({ examined: 1, failed: 1 })
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      expect.objectContaining({
        sourceId: 'acc_1',
        stage: 'evidence',
        reasonCode,
        detail: { message: error.message },
      })
    )
    expect(h.updateAcceptance).toHaveBeenCalled()
  })
})
