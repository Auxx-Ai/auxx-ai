// packages/lib/src/accounting/money/vendor-payments/__tests__/payment-accounting.test.ts
//
// `Dr accounts_payable (counterparty: the vendor) / Cr <the cash endpoint>` —
// the invoice receipt's entry with both sides flipped.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(),
  findLiveSubjectPosting: vi.fn(),
  resolvePeriodLock: vi.fn(),
  readAutoPostMode: vi.fn(),
  postEntry: vi.fn(),
  resolveRoles: vi.fn(),
  resolveBankAccountGlAccountInTx: vi.fn(),
  settings: {} as Record<string, unknown>,
  money: null as unknown,
  applications: [] as unknown[],
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../ledger/setup/setup-readiness', () => ({ FINALIZED_SETUP_STATE: 'finalized' }))
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLiveSubjectPosting: h.findLiveSubjectPosting,
}))
vi.mock('../../../ledger/periods/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../../../ledger/post/auto-post', () => ({ readAutoPostMode: h.readAutoPostMode }))
vi.mock('../../../ledger/post/post-entry', () => ({ postEntry: h.postEntry }))
vi.mock('../../../ledger/roles/resolve-roles', () => ({ resolveRoles: h.resolveRoles }))
vi.mock('../../../ledger/chart/resolve-cash-account', () => ({
  resolveBankAccountGlAccountInTx: h.resolveBankAccountGlAccountInTx,
}))
vi.mock('../../../../settings/read', () => ({
  readOrganizationSettings: async (_org: string, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, h.settings[key] ?? null])),
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import type { Database } from '@auxx/database'
import { acceptVendorPaymentAccounting } from '../payment-accounting'

const ORG = 'org_1'
const MOVEMENT = 'mt_vp'
const BILL = 'vb_1'
const VENDOR = 'co_1'

function db(): Database {
  const tx = {
    query: {
      MoneyTransaction: { findFirst: async () => h.money },
      MoneyApplication: { findMany: async () => h.applications },
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }
  return {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async <T>(fn: (t: unknown) => Promise<T>) => fn(tx),
  } as unknown as Database
}

const post = () =>
  acceptVendorPaymentAccounting(db(), { organizationId: ORG, moneyTransactionId: MOVEMENT })

function lines() {
  return h.postEntry.mock.calls[0]![1].entry.lines as Array<Record<string, unknown>>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.findLiveSubjectPosting.mockResolvedValue(ok(null))
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.readAutoPostMode.mockResolvedValue('post')
  h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gl_1' })
  h.resolveRoles.mockResolvedValue(
    ok(new Map([['undeposited_funds', { glAccountId: 'gl_undep' }]]))
  )
  h.resolveBankAccountGlAccountInTx.mockResolvedValue('gl_bank')
  h.settings = {
    'accounting.setupState': 'finalized',
    'accounting.bookTimeZone': 'America/Los_Angeles',
    'accounting.cutoffPeriod': null,
  }
  h.applications = [
    { id: 'ma_1', operation: 'apply', vendorBillInstanceId: BILL, amountMinor: 45_000n },
  ]
  h.money = {
    id: MOVEMENT,
    organizationId: ORG,
    purpose: 'vendor_payment',
    amountMinor: 45_000n,
    currency: 'USD',
    currencyExponent: 2,
    datePrecision: 'date',
    occurredOn: '2026-09-15',
    occurredAt: null,
    partyInstanceId: VENDOR,
    cashAccountInstanceId: 'ba_1',
    paymentGatewayId: null,
    method: 'bank',
  }
})

describe('acceptVendorPaymentAccounting', () => {
  it('debits A/P against the vendor and credits the bank account it left', async () => {
    await expect(post()).resolves.toEqual({ status: 'accepted', glPostingId: 'gl_1' })
    expect(lines()).toEqual([
      expect.objectContaining({
        accountRole: 'accounts_payable',
        direction: 'debit',
        amount: 45_000,
        counterpartyType: 'vendor',
        counterpartyId: VENDOR,
      }),
      expect.objectContaining({
        glAccountId: 'gl_bank',
        direction: 'credit',
        amount: 45_000,
      }),
    ])
    const options = h.postEntry.mock.calls[0]![1]
    expect(options.entry.postingType).toBe('payment')
    expect(options.railId).toBeNull()
    expect(options.sources).toEqual([
      { sourceKind: 'money_transaction', sourceId: MOVEMENT, linkRole: 'subject' },
      { sourceKind: 'vendor_bill', sourceId: BILL, linkRole: 'parent' },
      { sourceKind: 'company', sourceId: VENDOR, linkRole: 'counterparty' },
    ])
  })

  it("credits a rail's clearing account and scopes the posting to it", async () => {
    ;(h.money as { cashAccountInstanceId: string | null }).cashAccountInstanceId = null
    ;(h.money as { paymentGatewayId: string | null }).paymentGatewayId = 'pg_1'
    h.resolveRoles.mockResolvedValue(ok(new Map([['clearing', { glAccountId: 'gl_clearing' }]])))
    await post()
    expect(lines()[1]).toMatchObject({ glAccountId: 'gl_clearing', direction: 'credit' })
    expect(h.postEntry.mock.calls[0]![1].scope).toEqual({ rail: 'pg_1' })
  })

  it('credits undeposited funds when the payment names neither', async () => {
    ;(h.money as { cashAccountInstanceId: string | null }).cashAccountInstanceId = null
    await post()
    expect(lines()[1]).toMatchObject({ glAccountId: 'gl_undep', direction: 'credit' })
  })

  it('blocks an incomplete application set rather than throwing', async () => {
    h.applications = [
      { id: 'ma_1', operation: 'apply', vendorBillInstanceId: BILL, amountMinor: 1_000n },
    ]
    const result = await post()
    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toMatch(/complete applications/)
  })

  it('answers accepted when the movement already holds a live posting', async () => {
    h.findLiveSubjectPosting.mockResolvedValue(ok({ id: 'gl_old', txnDate: '2026-09-01' }))
    await expect(post()).resolves.toEqual({ status: 'accepted', glPostingId: 'gl_old' })
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})
