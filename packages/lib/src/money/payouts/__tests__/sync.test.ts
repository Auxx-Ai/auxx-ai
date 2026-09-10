// packages/lib/src/money/payouts/__tests__/sync.test.ts
//
// plans/accounting/tasks/17-accounting-is-opt-in.md section 3. `syncPayouts`
// runs nightly for every org with a live Stripe connection (`payoutSyncJob` ->
// `sweepPayouts`), so the gate sits here, once per org, before the Stripe
// account lookup - not only inside `postPayoutEntry`, which this test does not
// even need to mock to prove the point: the run never gets that far.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(async () => true),
  requirePayoutFieldContext: vi.fn(async () => ({}) as never),
  getPaymentAccount: vi.fn(async () => null as { stripeAccountId: string } | null),
  findBankAccountByStripeExternalAccountId: vi.fn(
    async () => null as { bankAccountId: string; glAccountId: string | null } | null
  ),
}))

vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../reads', () => ({
  requirePayoutFieldContext: h.requirePayoutFieldContext,
  findPayoutByGatewayId: vi.fn(),
  findBankAccountByStripeExternalAccountId: h.findBankAccountByStripeExternalAccountId,
}))
vi.mock('../../payments/account-state', () => ({
  getPaymentAccount: h.getPaymentAccount,
}))

import type { Database } from '@auxx/database'
import { resolvePayoutBankAccount, syncPayouts } from '../sync'

const ORG = 'org_1'
const db = {} as Database

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.getPaymentAccount.mockResolvedValue(null)
})

describe('accounting not enabled', () => {
  it('never looks up the payout field context or the Stripe account, and returns an empty result', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)

    const result = await syncPayouts(db, { organizationId: ORG })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      seen: 0,
      created: 0,
      posted: 0,
      alreadyPosted: 0,
      refused: [],
    })
    expect(h.requirePayoutFieldContext).not.toHaveBeenCalled()
    expect(h.getPaymentAccount).not.toHaveBeenCalled()
  })
})

describe('accounting enabled', () => {
  it('proceeds past the gate to the ordinary no-connected-Stripe-account case', async () => {
    const result = await syncPayouts(db, { organizationId: ORG })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      seen: 0,
      created: 0,
      posted: 0,
      alreadyPosted: 0,
      refused: [],
    })
    expect(h.requirePayoutFieldContext).toHaveBeenCalledTimes(1)
    expect(h.getPaymentAccount).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// brief 13 §2.3: a payout debits a bank account, resolved through a CONFIRMED
// Stripe identity, never a role and never `last4`.
// ─────────────────────────────────────────────────────────────────────────────

describe('resolvePayoutBankAccount', () => {
  it('blocks with no build when Stripe reported no destination at all', async () => {
    const result = await resolvePayoutBankAccount(db, ORG, null, 'PAY-0001')

    expect(result.blockedReason).toMatch(/no destination reported by Stripe/)
    expect(result.glAccountId).toBeUndefined()
    expect(h.findBankAccountByStripeExternalAccountId).not.toHaveBeenCalled()
  })

  it('blocks, naming the payout and the destination, when no bank account carries that identity', async () => {
    h.findBankAccountByStripeExternalAccountId.mockResolvedValue(null)

    const result = await resolvePayoutBankAccount(db, ORG, 'ba_unknown', 'PAY-0001')

    expect(result.blockedReason).toContain('PAY-0001')
    expect(result.blockedReason).toContain('ba_unknown')
    expect(result.blockedReason).toMatch(/not confirmed on any bank account/)
  })

  it('blocks when the matched bank account has no chart mapping', async () => {
    h.findBankAccountByStripeExternalAccountId.mockResolvedValue({
      bankAccountId: 'ba_row_1',
      glAccountId: null,
    })

    const result = await resolvePayoutBankAccount(db, ORG, 'ba_confirmed', 'PAY-0001')

    expect(result.blockedReason).toBeTruthy()
  })

  it('resolves the gl_account id of a confirmed bank account, and blocks nothing', async () => {
    h.findBankAccountByStripeExternalAccountId.mockResolvedValue({
      bankAccountId: 'ba_row_1',
      glAccountId: 'gl_1000',
    })

    const result = await resolvePayoutBankAccount(db, ORG, 'ba_confirmed', 'PAY-0001')

    expect(result).toEqual({ blockedReason: null, glAccountId: 'gl_1000' })
  })
})
