// packages/lib/src/money/payments/__tests__/post-transaction.test.ts
//
// plans/accounting/tasks/17-accounting-is-opt-in.md section 3: the
// accounting-off case is checked before the org-settings read that exists only
// to resolve the payment route for the builder.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(async () => true),
  getOrgCache: vi.fn(async () => ({})),
  resolvePaymentRoute: vi.fn(() => 'cash'),
  buildPaymentEntry: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postEntry: vi.fn(),
}))

vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ get: h.getOrgCache }),
}))
vi.mock('../../../postings/build-payment-entry', () => ({
  PAYMENT_SOURCE_TYPE: 'payment_transaction',
  paymentPeriodKey: (id: string) => `PMT-${id}`,
  buildPaymentEntry: h.buildPaymentEntry,
}))
vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: h.resolvePeriodLock,
}))
vi.mock('../../../postings/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntry: h.postEntry,
}))
vi.mock('../../../postings/read-posting', () => ({
  readPostingLineSourceIds: vi.fn(),
}))
vi.mock('../../bank-deposits/client', () => ({
  resolvePaymentRoute: h.resolvePaymentRoute,
}))

import type { Database, PaymentTransactionEntity } from '@auxx/database'
import { postPaymentTransaction } from '../post-transaction'

const ORG = 'org_1'
const db = {} as Database

function transaction(overrides: Partial<PaymentTransactionEntity> = {}): PaymentTransactionEntity {
  return {
    id: 'txn_1',
    kind: 'charge',
    status: 'succeeded',
    amount: 5_000,
    method: 'card',
    currency: 'USD',
    reference: null,
    metadata: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  } as PaymentTransactionEntity
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.getOrgCache.mockResolvedValue({})
  h.resolvePaymentRoute.mockReturnValue('cash')
  h.buildPaymentEntry.mockReturnValue({
    entry: { postingType: 'payment', periodKey: 'PMT-txn_1', txnDate: '2026-09-01', lines: [] },
  })
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gl_1', docNumber: 'AUXX-PMT-1' })
})

describe('accounting not enabled', () => {
  beforeEach(() => {
    h.isAccountingEnabled.mockResolvedValue(false)
  })

  it('returns not_enabled without reading settings, building, locking, or posting', async () => {
    const result = await postPaymentTransaction(db, {
      organizationId: ORG,
      transaction: transaction(),
      allocatedMinor: 5_000,
    })

    expect(result).toEqual({ status: 'not_enabled' })
    expect(h.getOrgCache).not.toHaveBeenCalled()
    expect(h.buildPaymentEntry).not.toHaveBeenCalled()
    expect(h.resolvePeriodLock).not.toHaveBeenCalled()
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('still refuses a non-postable status first, before the gate matters', async () => {
    const result = await postPaymentTransaction(db, {
      organizationId: ORG,
      transaction: transaction({ status: 'pending' }),
      allocatedMinor: 5_000,
    })

    expect(result.status).toBe('nothing_to_close')
  })
})

describe('accounting enabled', () => {
  it('resolves the route, builds, locks, and posts', async () => {
    const result = await postPaymentTransaction(db, {
      organizationId: ORG,
      transaction: transaction(),
      allocatedMinor: 5_000,
    })

    expect(h.buildPaymentEntry).toHaveBeenCalledTimes(1)
    expect(h.postEntry).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('posted')
  })
})
