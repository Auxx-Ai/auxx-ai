// packages/lib/src/accounting/money/payouts/__tests__/repost-writes.test.ts
//
// T26 (`plans/accounting/payout-links.md` §13 Q6): an item matched after its
// payout posted backs the entry out through the ordinary reverse path, and a
// closed period refuses it in a sentence rather than throwing.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  reverseEntry: vi.fn(async (_db: unknown, _options: unknown) => ({
    status: 'posted' as string,
    error: undefined as string | undefined,
  })),
  resolvePeriodLock: vi.fn(async () => ({ closedThrough: null })),
  repostStoredPayout: vi.fn(),
  findPayoutByGatewayId: vi.fn(),
  upsertWorkItem: vi.fn(),
  gateways: [{ id: 'pg_shop' }] as unknown[],
}))

vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../../ledger/periods/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../sync', () => ({ repostStoredPayout: h.repostStoredPayout }))
vi.mock('../reads', () => ({ findPayoutByGatewayId: h.findPayoutByGatewayId }))
vi.mock('../../../work-items/write', () => ({ upsertWorkItem: h.upsertWorkItem }))
vi.mock('../../../rails/reads', () => ({
  listPaymentGateways: async () => ({ isErr: () => false, isOk: () => true, value: h.gateways }),
}))
vi.mock('../source-registry', () => ({
  getPayoutSource: (id: string) =>
    id === 'shopify_payments'
      ? { isErr: () => false, isOk: () => true, value: { id } }
      : { isErr: () => true, isOk: () => false, error: new Error('none') },
}))

import { ok } from 'neverthrow'
import type { RepostTarget } from '../repost-reads'
import { repostStoredPayouts, reverseStalePayoutPosting } from '../repost-writes'

const db = {} as Database

beforeEach(() => {
  vi.clearAllMocks()
  h.reverseEntry.mockResolvedValue({ status: 'posted', error: undefined })
})

describe('reverseStalePayoutPosting', () => {
  it('backs the entry out through the ordinary reverse path, under the period lock it read', async () => {
    const result = await reverseStalePayoutPosting(db, {
      organizationId: 'org_1',
      glPostingId: 'glp_1',
      transferId: 'mt_1',
      actorUserId: 'user_1',
    })

    expect(result).toEqual({ glPostingId: 'glp_1', reversed: true, refusal: null })
    expect(h.reverseEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        organizationId: 'org_1',
        glPostingId: 'glp_1',
        actorUserId: 'user_1',
        lock: { closedThrough: null },
        // The mark that lets this reversal, and no person's, be re-booked from stored data.
        links: [{ sourceKind: 'money_transfer', linkRole: 'parent', sourceId: 'mt_1' }],
      })
    )
  })

  it('refuses in a sentence, never a throw, when the period is closed', async () => {
    h.reverseEntry.mockResolvedValue({ status: 'period_closed', error: 'June is closed' })

    const result = await reverseStalePayoutPosting(db, {
      organizationId: 'org_1',
      glPostingId: 'glp_1',
      transferId: 'mt_1',
    })

    expect(result.reversed).toBe(false)
    expect(result.refusal).toContain('Re-open the period')
  })

  it('carries any other refusal through verbatim', async () => {
    h.reverseEntry.mockResolvedValue({ status: 'error', error: 'the chart moved' })

    const result = await reverseStalePayoutPosting(db, {
      organizationId: 'org_1',
      glPostingId: 'glp_1',
      transferId: 'mt_1',
    })

    expect(result.reversed).toBe(false)
    expect(result.refusal).toContain('the chart moved')
  })
})

describe('repostStoredPayouts', () => {
  const target: RepostTarget = {
    transferId: 'mt_1',
    payoutExternalId: 'po_7',
    providerKey: 'shopify_payments',
    paymentGatewayId: 'pg_shop',
  }

  it('re-posts through the rail the feed is linked to, with no provider handle', async () => {
    h.repostStoredPayout.mockResolvedValue(ok({ status: 'posted' }))

    const summary = await repostStoredPayouts(db, {
      organizationId: 'org_1',
      targets: [target],
      actorUserId: 'user_1',
    })

    expect(summary).toEqual({ postedTransferIds: ['mt_1'], refused: 0 })
    expect(h.repostStoredPayout).toHaveBeenCalledWith(db, {
      ctx: {
        organizationId: 'org_1',
        sourceId: 'shopify_payments',
        rail: { id: 'pg_shop' },
        handle: null,
      },
      providerPayoutId: 'po_7',
      actorUserId: 'user_1',
    })
  })

  it('counts a refusal and reports nothing posted', async () => {
    h.repostStoredPayout.mockResolvedValue(ok({ status: 'refused', reason: 'closed' }))

    const summary = await repostStoredPayouts(db, { organizationId: 'org_1', targets: [target] })

    expect(summary).toEqual({ postedTransferIds: [], refused: 1 })
  })

  it('parks GATEWAY_UNMAPPED on a paid payout whose feed no longer reaches a live rail', async () => {
    h.findPayoutByGatewayId.mockResolvedValue({ payoutId: 'inst_7', status: 'paid' })

    const summary = await repostStoredPayouts(db, {
      organizationId: 'org_1',
      targets: [{ ...target, paymentGatewayId: 'pg_archived' }],
    })

    expect(summary.refused).toBe(1)
    expect(h.repostStoredPayout).not.toHaveBeenCalled()
    expect(h.upsertWorkItem).toHaveBeenCalledWith(db, 'org_1', {
      sourceKind: 'payout',
      sourceId: 'inst_7',
      stage: 'post',
      reasonCode: 'GATEWAY_UNMAPPED',
    })
  })
})
