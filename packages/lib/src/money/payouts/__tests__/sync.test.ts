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
  paymentGateways: [] as unknown[],
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
vi.mock('../../../payment-gateways/reads', () => ({
  listPaymentGateways: async () => ({
    isErr: () => false,
    isOk: () => true,
    value: h.paymentGateways,
  }),
}))

import type { Database } from '@auxx/database'
import { type PaymentGatewayRow, toGatewayRoutes } from '../../../payment-gateways/client'
import { resolveFulfillmentDebit } from '../../../postings/build-fulfillment-batch-entry'
import { resolvePayoutBankAccount, resolvePayoutGateway, syncPayouts } from '../sync'

const ORG = 'org_1'
const db = {} as Database

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.getPaymentAccount.mockResolvedValue(null)
  h.paymentGateways = []
})

/** One `payment_gateway` row, as `listPaymentGateways` hands it over. */
function gateway(overrides: Partial<PaymentGatewayRow> = {}): PaymentGatewayRow {
  return {
    id: 'pg_stripe',
    recordId: 'payment_gateway:pg_stripe',
    name: 'Stripe',
    handles: ['stripe'],
    clearingGlAccountId: 'gl_clearing_stripe',
    feeGlAccountId: null,
    settlementSource: 'stripe',
    feeTreatment: 'netted',
    status: 'active',
    lastSettlementAt: null,
    lastFeeBookedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// brief 26 §3 and §13 decision 2: a payout credits a clearing account, never a
// role, and refuses rather than guessing when two records claim the Stripe rail.
// ─────────────────────────────────────────────────────────────────────────────

describe('resolvePayoutGateway', () => {
  it('blocks nothing and names no id for an org with zero payment_gateway records', async () => {
    // 🔑 §12 test 1 at the resolver. This is the branch every org that has never
    // opened the settings page takes, and it must leave the builder falling back
    // to the roles - bit for bit what it did before this brief.
    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toEqual({ blockedReason: null, feeTreatment: 'netted' })
    expect(result.clearingGlAccountId).toBeUndefined()
    expect(result.feeGlAccountId).toBeUndefined()
  })

  it('names no id when records exist but none settles through Stripe', async () => {
    h.paymentGateways = [gateway({ id: 'pg_affirm', settlementSource: 'manual' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toEqual({ blockedReason: null, feeTreatment: 'netted' })
  })

  it('resolves the clearing account of the single Stripe rail', async () => {
    h.paymentGateways = [
      gateway({ id: 'pg_affirm', settlementSource: 'manual', clearingGlAccountId: 'gl_affirm' }),
      gateway(),
    ]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toEqual({
      blockedReason: null,
      clearingGlAccountId: 'gl_clearing_stripe',
      feeTreatment: 'netted',
    })
  })

  it("carries the rail's own fee account and fee treatment when it has them", async () => {
    h.paymentGateways = [gateway({ feeGlAccountId: 'gl_stripe_fees', feeTreatment: 'billed' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toMatchObject({
      blockedReason: null,
      clearingGlAccountId: 'gl_clearing_stripe',
      feeGlAccountId: 'gl_stripe_fees',
      feeTreatment: 'billed',
    })
  })

  it('resolves a CLOSED Stripe rail rather than ignoring it', async () => {
    // A closed rail is still a record claiming the Stripe stream, and its last
    // settlements are exactly the ones still arriving. Skipping it would send
    // them to the role while its shipments went to its own account.
    h.paymentGateways = [gateway({ status: 'closed' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toMatchObject({ clearingGlAccountId: 'gl_clearing_stripe' })
  })

  it('REFUSES when two records settle through Stripe, naming both and the remedy', async () => {
    // 🛑 §13 decision 2. Never a silent fall back to the role: a wrong clearing
    // account is invisible and permanent, a blocked payout is visible and
    // fixable.
    h.paymentGateways = [
      gateway({ id: 'pg_one', name: 'Stripe US' }),
      gateway({ id: 'pg_two', name: 'Stripe EU', clearingGlAccountId: 'gl_other' }),
    ]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result.blockedReason).toContain('PAY-0001')
    expect(result.blockedReason).toContain('Stripe US')
    expect(result.blockedReason).toContain('Stripe EU')
    expect(result.blockedReason).toMatch(/Payment gateways/)
    expect(result.clearingGlAccountId).toBeUndefined()
  })

  it('falls back to the role rather than posting to a blank clearing account', async () => {
    h.paymentGateways = [gateway({ clearingGlAccountId: '' })]

    const result = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(result).toEqual({ blockedReason: null, feeTreatment: 'netted' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §12 test 2, closed through the real read model: the SAME `PaymentGatewayRow`
// feeds both sides. This is the brief in one assertion.
// ─────────────────────────────────────────────────────────────────────────────

describe('the debit and the credit meet', () => {
  it('routes a shipment and resolves a payout to one and the same glAccountId', async () => {
    // 🔑 One record, read once, driving both halves through the functions that
    // actually run in production: `toGatewayRoutes` -> `resolveFulfillmentDebit`
    // on the sale, `resolvePayoutGateway` on the settlement. Before brief 26
    // the payout side did not consult this record at all - it passed
    // `clearingRole: ACCOUNT_ROLES.CLEARING_CARD` and the two accounts drifted
    // apart in entries that both balanced.
    const rail = gateway({
      handles: ['authorize_net', 'authorize.net'],
      clearingGlAccountId: 'gl_authnet_clearing',
    })
    h.paymentGateways = [rail]

    const debit = resolveFulfillmentDebit({
      financialStatus: 'paid',
      gateways: ['Authorize_Net'],
      gatewayRoutes: toGatewayRoutes([rail]),
    })
    const credit = await resolvePayoutGateway(db, ORG, 'PAY-0001')

    expect(debit).toEqual({ kind: 'debit', glAccountId: 'gl_authnet_clearing' })
    expect(credit.clearingGlAccountId).toBe('gl_authnet_clearing')
  })
})
