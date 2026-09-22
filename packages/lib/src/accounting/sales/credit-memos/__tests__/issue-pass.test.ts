// packages/lib/src/accounting/sales/credit-memos/__tests__/issue-pass.test.ts
//
// 88 D3: the pass issues draft channel memos as the system user, parks the rest as
// `issue` work items (91 §4.6), and links the refunds that arrived first (91 §4.4).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  memos: [] as Array<{ id: string; issuedAt: string }>,
  parked: new Set<string>(),
  parkedReads: 0,
  filters: [] as unknown[],
  issue: vi.fn(),
  linked: [] as string[],
  marks: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../../../resources/system-records', () => ({
  systemFields: async () => ({
    fields: { credit_memo_status: {}, credit_memo_source: {}, credit_memo_order: {} },
  }),
  findSystemRecordIdsByValue: async (
    _db: unknown,
    _org: string,
    _ctx: unknown,
    filters: unknown
  ) => {
    h.filters.push(filters)
    return new Map([['draft', h.memos.map((memo) => memo.id)]])
  },
  readSystemRecords: async () =>
    h.memos.map((memo) => ({ id: memo.id, date: () => `${memo.issuedAt}T12:00:00.000Z` })),
}))
vi.mock('../../../work-items/reads', () => ({
  listParkedSourceIds: async () => {
    h.parkedReads++
    return { isOk: () => true, value: h.parked }
  },
}))
vi.mock('../../../money/customer-money/ingest', () => ({
  linkImportedRefundsToMemo: async (_db: unknown, _org: string, id: string) => {
    h.linked.push(id)
    return 0
  },
}))
vi.mock('../../../work-items/write', () => ({
  upsertWorkItem: async (_db: unknown, _org: string, input: Record<string, unknown>) =>
    h.marks.push({ park: input }),
  deleteWorkItem: async (_db: unknown, _org: string, key: Record<string, unknown>) =>
    h.marks.push({ clear: key }),
}))
vi.mock('../writes', () => ({ issueCreditMemo: h.issue }))
vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ get: async () => 'user_system' }),
}))
vi.mock('../../../../settings/read', () => ({
  readOrganizationSettings: async () => ({ 'accounting.cutoffPeriod': '2026-01' }),
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import type { Database } from '@auxx/database'
import { ConflictError } from '../../../../errors'
import { sweepChannelCreditMemos } from '../issue-pass'

const db = {} as Database

const memo = (id: string, issuedAt = '2026-02-01') => ({ id, issuedAt })

beforeEach(() => {
  vi.clearAllMocks()
  h.memos = []
  h.parked = new Set()
  h.parkedReads = 0
  h.filters = []
  h.linked = []
  h.marks = []
})

describe('sweepChannelCreditMemos', () => {
  it('issues each candidate as the system user and deletes its work item', async () => {
    h.memos = [memo('cm_1'), memo('cm_2', '2026-02-02')]
    h.issue.mockResolvedValue({ status: 'settled' })
    const counts = await sweepChannelCreditMemos(db, { organizationId: 'org_1' })
    expect(h.issue.mock.calls.map((call) => call[1])).toEqual([
      { organizationId: 'org_1', userId: 'user_system', creditMemoInstanceId: 'cm_1' },
      { organizationId: 'org_1', userId: 'user_system', creditMemoInstanceId: 'cm_2' },
    ])
    expect(h.marks).toEqual([
      { clear: { sourceKind: 'credit_memo', sourceId: 'cm_1', stage: 'issue' } },
      { clear: { sourceKind: 'credit_memo', sourceId: 'cm_2', stage: 'issue' } },
    ])
    expect(counts).toEqual({ scanned: 2, issued: 2, blocked: 0 })
    expect(h.linked).toEqual(['cm_1', 'cm_2'])
  })

  it('parks a refused memo and keeps going', async () => {
    h.memos = [memo('cm_wait'), memo('cm_ok', '2026-02-02')]
    h.issue
      .mockRejectedValueOnce(new ConflictError('August is closed'))
      .mockResolvedValueOnce({ status: 'issued' })
    const counts = await sweepChannelCreditMemos(db, { organizationId: 'org_1' })
    expect(h.marks[0]).toEqual({
      park: {
        sourceKind: 'credit_memo',
        sourceId: 'cm_wait',
        stage: 'issue',
        reasonCode: 'REFUSED',
        detail: { message: 'August is closed' },
      },
    })
    expect(counts).toEqual({ scanned: 2, issued: 1, blocked: 1 })
    // A refused memo still links the refunds that name it.
    expect(h.linked).toEqual(['cm_wait', 'cm_ok'])
  })

  it('cuts on the cutoff and skips parked memos, except when scoped to one order', async () => {
    h.memos = [memo('cm_old', '2026-01-31'), memo('cm_parked'), memo('cm_new', '2026-02-02')]
    h.parked = new Set(['cm_parked'])
    h.issue.mockResolvedValue({ status: 'issued' })
    await sweepChannelCreditMemos(db, { organizationId: 'org_1' })
    expect(h.issue.mock.calls.map((call) => call[1].creditMemoInstanceId)).toEqual(['cm_new'])

    h.issue.mockClear()
    h.parkedReads = 0
    await sweepChannelCreditMemos(db, { organizationId: 'org_1', orderInstanceId: 'ord_1' })
    expect(h.parkedReads).toBe(0)
    expect(h.issue.mock.calls.map((call) => call[1].creditMemoInstanceId)).toEqual([
      'cm_parked',
      'cm_new',
    ])
    expect(h.filters[1]).toContainEqual({ attribute: 'credit_memo_order', related: ['ord_1'] })
  })

  it('rethrows anything that is not a refusal', async () => {
    h.memos = [memo('cm_1')]
    h.issue.mockRejectedValueOnce(new Error('connection reset'))
    await expect(sweepChannelCreditMemos(db, { organizationId: 'org_1' })).rejects.toThrow(
      'connection reset'
    )
  })
})
