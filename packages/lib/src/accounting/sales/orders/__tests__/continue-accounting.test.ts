// packages/lib/src/accounting/sales/orders/__tests__/continue-accounting.test.ts
//
// 88 D10: an approval offers the order's next events to their posters in the
// order the timeline wants them, and a draft with no parent order is a no-op.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fulfillments: [] as Array<Record<string, unknown>>,
  applications: [] as Array<{ moneyTransactionId: string }>,
  refunds: [] as Array<{ refundTransactionId: string }>,
  posted: new Set<string>(),
  parentRows: [] as Array<{ sourceId: string }>,
  postFulfillment: vi.fn(
    async (_db: unknown, _input: { organizationId: string; fulfillmentId: string }) =>
      ({ status: 'drafted', glPostingId: 'glp' }) as {
        status: 'accepted' | 'drafted' | 'blocked' | 'skipped'
        glPostingId?: string
        reason?: string
      }
  ),
  postMovement: vi.fn(
    async (_db: unknown, _input: { organizationId: string; moneyTransactionId: string }) =>
      ({ status: 'drafted', glPostingId: 'glp' }) as {
        status: 'accepted' | 'drafted' | 'blocked' | 'skipped'
        glPostingId?: string
        reason?: string
      }
  ),
  memoPass: vi.fn(async () => ({ scanned: 0, issued: 0, blocked: 0 })),
}))

vi.mock('../../credit-memos/issue-pass', () => ({
  sweepChannelCreditMemos: h.memoPass,
}))

vi.mock('../../fulfillments/reads', () => ({
  readFulfillmentsForOrder: async () => h.fulfillments,
}))
vi.mock('../../fulfillments/client', () => ({
  isLiveFulfillment: (row: { status: string }) => row.status !== 'cancelled',
}))
vi.mock('../../fulfillments/accounting', () => ({
  postFulfillmentAccounting: h.postFulfillment,
}))
vi.mock('../../../money/blocked-movements', () => ({
  postBlockedMovement: h.postMovement,
}))
vi.mock('../../../money/reads', () => ({
  listOrderApplications: async () => h.applications,
  listRefundSettlements: async () => h.refunds,
}))
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLiveSubjectPostings: async (
    _db: unknown,
    _org: string,
    options: { sourceIds: readonly string[] }
  ) => new Map(options.sourceIds.filter((id) => h.posted.has(id)).map((id) => [id, {}])),
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import type { Database } from '@auxx/database'
import { continueAccountingAfterDraft, continueOrderAccounting } from '../continue-accounting'

const ORG = 'org_1'

function db(): Database {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'where']) chain[method] = () => chain
  chain.limit = async () => h.parentRows
  return { select: () => chain } as unknown as Database
}

function shipment(id: string, shippedAt: string, extra: Record<string, unknown> = {}) {
  return { id, shippedAt, sequence: 1, status: 'success', glPosting: null, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fulfillments = []
  h.applications = []
  h.refunds = []
  h.posted = new Set()
  h.parentRows = []
})

describe('continueOrderAccounting', () => {
  it('offers unposted live shipments oldest first, then receipts and their refunds', async () => {
    h.fulfillments = [
      shipment('ful_late', '2026-09-05T00:00:00.000Z'),
      shipment('ful_posted', '2026-09-01T00:00:00.000Z', { glPosting: 'glp_x' }),
      shipment('ful_cancelled', '2026-09-02T00:00:00.000Z', { status: 'cancelled' }),
      shipment('ful_early', '2026-09-03T00:00:00.000Z'),
    ]
    h.applications = [{ moneyTransactionId: 'mt_1' }, { moneyTransactionId: 'mt_1' }]
    h.refunds = [{ refundTransactionId: 'mt_refund' }]
    h.posted = new Set(['mt_1'])

    const result = await continueOrderAccounting(db(), {
      organizationId: ORG,
      orderId: 'ord_1',
      actorUserId: 'user_1',
    })

    expect(h.postFulfillment.mock.calls.map((call) => call[1].fulfillmentId)).toEqual([
      'ful_early',
      'ful_late',
    ])
    expect(h.postMovement.mock.calls.map((call) => call[1].moneyTransactionId)).toEqual([
      'mt_refund',
    ])
    expect(h.postMovement.mock.calls[0]![1]).toMatchObject({ actorUserId: 'user_1' })
    expect(h.memoPass).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, orderInstanceId: 'ord_1' })
    )
    expect(result).toEqual({
      shipments: { accepted: 0, drafted: 2, blocked: 0, skipped: 0 },
      movements: { accepted: 0, drafted: 1, blocked: 0, skipped: 0 },
      memos: { scanned: 0, issued: 0, blocked: 0 },
    })
  })

  it('offers the refunds again once a memo issued - the refund waits on the memo', async () => {
    h.applications = [{ moneyTransactionId: 'mt_1' }]
    h.refunds = [{ refundTransactionId: 'mt_refund' }]
    h.posted = new Set(['mt_1'])
    h.postMovement
      .mockResolvedValueOnce({ status: 'blocked', reason: 'Refund requires a posted credit memo' })
      .mockResolvedValueOnce({ status: 'accepted', glPostingId: 'glp_r' })
    h.memoPass.mockResolvedValueOnce({ scanned: 1, issued: 1, blocked: 0 })

    const result = await continueOrderAccounting(db(), { organizationId: ORG, orderId: 'ord_1' })

    expect(h.postMovement.mock.calls.map((call) => call[1].moneyTransactionId)).toEqual([
      'mt_refund',
      'mt_refund',
    ])
    expect(result.movements).toEqual({ accepted: 1, drafted: 0, blocked: 1, skipped: 0 })
  })

  it('counts a movement its poster cannot place as blocked and keeps going', async () => {
    h.applications = [{ moneyTransactionId: 'mt_1' }, { moneyTransactionId: 'mt_2' }]
    h.postMovement
      .mockRejectedValueOnce(new Error('names no document'))
      .mockResolvedValueOnce({ status: 'accepted', glPostingId: 'glp' })
    const result = await continueOrderAccounting(db(), { organizationId: ORG, orderId: 'ord_1' })
    expect(result.movements).toEqual({ accepted: 1, drafted: 0, blocked: 1, skipped: 0 })
  })
})

describe('continueAccountingAfterDraft', () => {
  it('is a no-op for a draft that parents no order', async () => {
    const result = await continueAccountingAfterDraft(db(), {
      organizationId: ORG,
      glPostingId: 'glp_journal',
    })
    expect(result).toBeNull()
    expect(h.postFulfillment).not.toHaveBeenCalled()
  })

  it('continues the order the draft parents', async () => {
    h.parentRows = [{ sourceId: 'ord_9' }]
    h.fulfillments = [shipment('ful_1', '2026-09-03T00:00:00.000Z')]
    const result = await continueAccountingAfterDraft(db(), {
      organizationId: ORG,
      glPostingId: 'glp_receipt',
    })
    expect(result?.shipments.drafted).toBe(1)
    expect(h.postFulfillment.mock.calls[0]![1]).toMatchObject({ fulfillmentId: 'ful_1' })
  })

  it('never throws - a failed continuation is the sweep to retry', async () => {
    h.parentRows = [{ sourceId: 'ord_9' }]
    h.postFulfillment.mockRejectedValueOnce(new Error('boom'))
    h.fulfillments = [shipment('ful_1', '2026-09-03T00:00:00.000Z')]
    await expect(
      continueAccountingAfterDraft(db(), { organizationId: ORG, glPostingId: 'glp' })
    ).resolves.toBeNull()
  })
})
