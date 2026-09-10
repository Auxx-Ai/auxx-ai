// packages/lib/src/money/payments/__tests__/post-transaction.test.ts
//
// plans/accounting/tasks/17-accounting-is-opt-in.md section 3: the
// accounting-off case is checked before the org-settings read that exists only
// to resolve the payment route for the builder.
//
// plans/accounting/tasks/13-cash-accounts-and-the-qbo-seam.md §2.4: the `cash`
// route names a bank account, never a role, so it is resolved and refused
// BEFORE the build - `resolveCashBankAccountGlAccountId` is exercised here
// directly against a stub `Database`, never mocked away, because it is the one
// piece of new logic this file exists to pin.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(async () => true),
  getOrgCache: vi.fn(async () => ({})),
  getCachedEntityDefId: vi.fn(async () => null as string | null),
  bySystemAttributes: vi.fn(
    async () => ({ bank_account_gl_account: null }) as Record<string, unknown>
  ),
  resolvePaymentRoute: vi.fn(() => 'undeposited_funds'),
  buildPaymentEntry: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postEntry: vi.fn(),
}))

vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    get: h.getOrgCache,
    from: () => ({ bySystemAttributes: h.bySystemAttributes }),
  }),
  getCachedEntityDefId: h.getCachedEntityDefId,
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

/**
 * A `Database` answering the two selects `resolveCashBankAccountGlAccountId`
 * issues - the `bank_account` instance (by id, org and def) and its
 * `bank_account_gl_account` field value. `.where()` is unevaluated, the same
 * posture `143`/`144`'s migration stubs take: the caller already scoped the
 * seed to the query under test.
 */
function makeDb(opts: {
  instance?: { id: string; archivedAt: Date | null } | null
  fieldValue?: { valueText: string | null } | null
}): Database {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            if (table === schema.EntityInstance) {
              return Promise.resolve(opts.instance ? [opts.instance] : [])
            }
            if (table === schema.FieldValue) {
              return Promise.resolve(opts.fieldValue ? [opts.fieldValue] : [])
            }
            return Promise.resolve([])
          },
        }),
      }),
    }),
  } as unknown as Database
}

const NO_DB = {} as Database

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.getOrgCache.mockResolvedValue({})
  h.getCachedEntityDefId.mockResolvedValue(null)
  h.bySystemAttributes.mockResolvedValue({ bank_account_gl_account: null })
  h.resolvePaymentRoute.mockReturnValue('undeposited_funds')
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
    const result = await postPaymentTransaction(NO_DB, {
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
    const result = await postPaymentTransaction(NO_DB, {
      organizationId: ORG,
      transaction: transaction({ status: 'pending' }),
      allocatedMinor: 5_000,
    })

    expect(result.status).toBe('nothing_to_close')
  })
})

describe('accounting enabled, a role-based route', () => {
  it('resolves the route, builds with no bank account, locks, and posts', async () => {
    const result = await postPaymentTransaction(NO_DB, {
      organizationId: ORG,
      transaction: transaction(),
      allocatedMinor: 5_000,
    })

    expect(h.buildPaymentEntry).toHaveBeenCalledTimes(1)
    expect(h.buildPaymentEntry).toHaveBeenCalledWith(
      expect.objectContaining({ bankAccountGlAccountId: null })
    )
    expect(h.postEntry).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('posted')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The `cash` route names a bank account, never a role (brief 13 §2.4)
// ─────────────────────────────────────────────────────────────────────────────

describe('accounting enabled, the cash route', () => {
  beforeEach(() => {
    h.resolvePaymentRoute.mockReturnValue('cash')
  })

  it('refuses with account_unmapped when no bank account is configured, and never builds', async () => {
    h.getOrgCache.mockResolvedValue({})

    const result = await postPaymentTransaction(NO_DB, {
      organizationId: ORG,
      transaction: transaction(),
      allocatedMinor: 5_000,
    })

    expect(result).toMatchObject({ status: 'account_unmapped', failureClass: 'configuration' })
    expect(result.error).toMatch(/no bank account is configured/)
    expect(h.buildPaymentEntry).not.toHaveBeenCalled()
    expect(h.postEntry).not.toHaveBeenCalled()
    // The short-circuit is before any cache or db read for the bank account.
    expect(h.getCachedEntityDefId).not.toHaveBeenCalled()
  })

  it('refuses with account_unmapped when the configured bank account has no gl_account mapping', async () => {
    h.getOrgCache.mockResolvedValue({ 'accounting.cashBankAccountId': 'ba_1' })
    h.getCachedEntityDefId.mockResolvedValue('def_bank_account')
    h.bySystemAttributes.mockResolvedValue({ bank_account_gl_account: { id: 'fld_gl' } })

    const db = makeDb({ instance: { id: 'ba_1', archivedAt: null }, fieldValue: null })
    const result = await postPaymentTransaction(db, {
      organizationId: ORG,
      transaction: transaction(),
      allocatedMinor: 5_000,
    })

    expect(result).toMatchObject({ status: 'account_unmapped', failureClass: 'configuration' })
    expect(result.error).toMatch(/is not mapped to a chart account/)
    expect(h.buildPaymentEntry).not.toHaveBeenCalled()
  })

  it('refuses with account_unmapped when the configured bank account is archived', async () => {
    h.getOrgCache.mockResolvedValue({ 'accounting.cashBankAccountId': 'ba_1' })
    h.getCachedEntityDefId.mockResolvedValue('def_bank_account')
    h.bySystemAttributes.mockResolvedValue({ bank_account_gl_account: { id: 'fld_gl' } })

    const db = makeDb({
      instance: { id: 'ba_1', archivedAt: new Date('2026-01-01') },
      fieldValue: { valueText: 'gl_1000' },
    })
    const result = await postPaymentTransaction(db, {
      organizationId: ORG,
      transaction: transaction(),
      allocatedMinor: 5_000,
    })

    expect(result.status).toBe('account_unmapped')
    expect(h.buildPaymentEntry).not.toHaveBeenCalled()
  })

  it('resolves the mapped bank account and builds with its gl_account id', async () => {
    h.getOrgCache.mockResolvedValue({ 'accounting.cashBankAccountId': 'ba_1' })
    h.getCachedEntityDefId.mockResolvedValue('def_bank_account')
    h.bySystemAttributes.mockResolvedValue({ bank_account_gl_account: { id: 'fld_gl' } })

    const db = makeDb({
      instance: { id: 'ba_1', archivedAt: null },
      fieldValue: { valueText: 'gl_1000' },
    })
    const result = await postPaymentTransaction(db, {
      organizationId: ORG,
      transaction: transaction(),
      allocatedMinor: 5_000,
    })

    expect(h.buildPaymentEntry).toHaveBeenCalledWith(
      expect.objectContaining({ bankAccountGlAccountId: 'gl_1000' })
    )
    expect(h.postEntry).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('posted')
  })
})
