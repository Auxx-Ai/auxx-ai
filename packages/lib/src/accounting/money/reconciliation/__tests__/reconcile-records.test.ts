// packages/lib/src/accounting/money/reconciliation/__tests__/reconcile-records.test.ts
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ orders: vi.fn(), payouts: vi.fn() }))
vi.mock('../../../../cache', () => ({
  getCachedResources: async () => [
    { id: 'order-def', entityType: 'order' },
    { id: 'line-def', entityType: 'line_item' },
    { id: 'payout-def', entityType: 'payout' },
  ],
}))
vi.mock('../../customer-money/record-evidence', () => ({ reconcileOrderPaymentEvidence: h.orders }))
vi.mock('../../payouts/reconcile-records', () => ({ reconcileFinancialRecords: h.payouts }))

import { reconcileFinancialRecords } from '../reconcile-records'

describe('shared financial reconciliation owner resolution', () => {
  beforeEach(() => {
    h.orders.mockReset().mockResolvedValue({ examined: 0 })
    h.payouts.mockReset().mockResolvedValue(0)
  })

  it('resolves 1,000 lines to 100 orders in one query and one domain batch', async () => {
    const where = vi
      .fn()
      .mockResolvedValue(Array.from({ length: 1000 }, (_, i) => ({ id: `order-${i % 100}` })))
    const db = { select: vi.fn(() => ({ from: () => ({ innerJoin: () => ({ where }) }) })) }
    const recordIds = Array.from({ length: 1000 }, (_, i) => toRecordId('line-def', `line-${i}`))
    await reconcileFinancialRecords(db as never, {
      organizationId: 'org',
      recordIds: [...recordIds, ...recordIds, toRecordId('order-def', 'order-0')],
      cause: 'bulk-complete',
    })
    expect(db.select).toHaveBeenCalledOnce()
    expect(h.orders).toHaveBeenCalledOnce()
    expect(h.orders.mock.calls[0]![1].orderInstanceIds).toHaveLength(100)
    expect(h.payouts).not.toHaveBeenCalled()
  })

  it('retains the old order when a line moves to another order', async () => {
    const db = {
      select: () => ({
        from: () => ({ innerJoin: () => ({ where: async () => [{ id: 'new-order' }] }) }),
      }),
    }
    await reconcileFinancialRecords(db as never, {
      organizationId: 'org',
      recordIds: [toRecordId('line-def', 'moved-line')],
      previousOrderIds: ['old-order'],
      cause: 'record-change',
    })
    expect(h.orders.mock.calls[0]![1].orderInstanceIds.sort()).toEqual(['new-order', 'old-order'])
  })
})
