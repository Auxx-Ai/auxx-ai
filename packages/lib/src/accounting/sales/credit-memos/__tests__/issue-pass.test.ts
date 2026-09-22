// packages/lib/src/accounting/sales/credit-memos/__tests__/issue-pass.test.ts
//
// 88 D3: the pass issues ready channel memos as the system user and parks the
// rest as `issue` work items (91 §4.6).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  candidates: [] as string[],
  windows: [] as Array<Record<string, unknown>>,
  issue: vi.fn(),
  marks: [] as Array<Record<string, unknown>>,
}))

vi.mock('../readiness', () => ({
  listChannelMemoIssueCandidates: async (
    _db: unknown,
    _org: string,
    _limit: number,
    window: Record<string, unknown>
  ) => {
    h.windows.push(window)
    return h.candidates
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

beforeEach(() => {
  vi.clearAllMocks()
  h.candidates = []
  h.windows = []
  h.marks = []
})

describe('sweepChannelCreditMemos', () => {
  it('issues each candidate as the system user and deletes its work item', async () => {
    h.candidates = ['cm_1', 'cm_2']
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
  })

  it('parks a refused memo and keeps going', async () => {
    h.candidates = ['cm_wait', 'cm_ok']
    h.issue
      .mockRejectedValueOnce(
        new ConflictError('This credit memo waits on its order: receipt mt_1 has no posting')
      )
      .mockResolvedValueOnce({ status: 'issued' })
    const counts = await sweepChannelCreditMemos(db, { organizationId: 'org_1' })
    expect(h.marks[0]).toEqual({
      park: {
        sourceKind: 'credit_memo',
        sourceId: 'cm_wait',
        stage: 'issue',
        reasonCode: 'REFUSED',
        detail: { message: 'This credit memo waits on its order: receipt mt_1 has no posting' },
      },
    })
    expect(counts).toEqual({ scanned: 2, issued: 1, blocked: 1 })
  })

  it('cuts on the cutoff and skips parked memos, except when scoped to one order', async () => {
    await sweepChannelCreditMemos(db, { organizationId: 'org_1' })
    expect(h.windows[0]).toMatchObject({ cutoffPeriod: '2026-01', includeParked: false })

    await sweepChannelCreditMemos(db, { organizationId: 'org_1', orderInstanceId: 'ord_1' })
    expect(h.windows[1]).toMatchObject({ orderInstanceId: 'ord_1', includeParked: true })
  })

  it('rethrows anything that is not a refusal', async () => {
    h.candidates = ['cm_1']
    h.issue.mockRejectedValueOnce(new Error('connection reset'))
    await expect(sweepChannelCreditMemos(db, { organizationId: 'org_1' })).rejects.toThrow(
      'connection reset'
    )
  })
})
