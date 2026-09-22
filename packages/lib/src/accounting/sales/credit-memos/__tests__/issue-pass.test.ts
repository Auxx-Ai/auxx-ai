// packages/lib/src/accounting/sales/credit-memos/__tests__/issue-pass.test.ts
//
// 88 D3: the pass issues ready channel memos as the system user and records
// why the rest are waiting.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  candidates: [] as string[],
  windows: [] as Array<Record<string, unknown>>,
  issue: vi.fn(),
  marks: [] as Array<{ id: string; reason: string | null }>,
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
  markCreditMemoIssueBlock: async (
    _db: unknown,
    _org: string,
    id: string,
    reason: string | null
  ) => {
    h.marks.push({ id, reason })
  },
}))
vi.mock('../writes', () => ({ issueCreditMemo: h.issue }))
vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ get: async () => 'user_system' }),
}))
vi.mock('../../../../settings/read', () => ({
  readOrganizationSettings: async () => ({ 'accounting.cutoffPeriod': '2026-01' }),
}))
vi.mock('../../../money/blocked-movements', () => ({ POSTING_RETRY_INTERVAL_MS: 60 * 60 * 1000 }))
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
  it('issues each candidate as the system user and clears its marker', async () => {
    h.candidates = ['cm_1', 'cm_2']
    h.issue.mockResolvedValue({ status: 'settled' })
    const counts = await sweepChannelCreditMemos(db, { organizationId: 'org_1' })
    expect(h.issue.mock.calls.map((call) => call[1])).toEqual([
      { organizationId: 'org_1', userId: 'user_system', creditMemoInstanceId: 'cm_1' },
      { organizationId: 'org_1', userId: 'user_system', creditMemoInstanceId: 'cm_2' },
    ])
    expect(h.marks).toEqual([
      { id: 'cm_1', reason: null },
      { id: 'cm_2', reason: null },
    ])
    expect(counts).toEqual({ scanned: 2, issued: 2, blocked: 0 })
  })

  it('marks a refused memo with the issuer words and keeps going', async () => {
    h.candidates = ['cm_wait', 'cm_ok']
    h.issue
      .mockRejectedValueOnce(
        new ConflictError('This credit memo waits on its order: receipt mt_1 has no posting')
      )
      .mockResolvedValueOnce({ status: 'issued' })
    const counts = await sweepChannelCreditMemos(db, { organizationId: 'org_1' })
    expect(h.marks[0]).toEqual({
      id: 'cm_wait',
      reason: 'This credit memo waits on its order: receipt mt_1 has no posting',
    })
    expect(counts).toEqual({ scanned: 2, issued: 1, blocked: 1 })
  })

  it('cuts on the cutoff and backs off refused memos, except when scoped to one order', async () => {
    await sweepChannelCreditMemos(db, { organizationId: 'org_1' })
    expect(h.windows[0]).toMatchObject({ cutoffPeriod: '2026-01' })
    expect((h.windows[0]!.retryBefore as Date).getTime()).toBeLessThan(Date.now() - 59 * 60 * 1000)

    await sweepChannelCreditMemos(db, { organizationId: 'org_1', orderInstanceId: 'ord_1' })
    expect(h.windows[1]).toMatchObject({ orderInstanceId: 'ord_1' })
    expect((h.windows[1]!.retryBefore as Date).getTime()).toBeGreaterThan(Date.now() - 1000)
  })

  it('rethrows anything that is not a refusal', async () => {
    h.candidates = ['cm_1']
    h.issue.mockRejectedValueOnce(new Error('connection reset'))
    await expect(sweepChannelCreditMemos(db, { organizationId: 'org_1' })).rejects.toThrow(
      'connection reset'
    )
  })
})
