// packages/lib/src/money/checkout/__tests__/writes.test.ts
//
// Opening a session is the one place a customer-facing amount is decided, so what is pinned
// here is what gets charged and what gets refused — not Stripe's wire shape.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  create: vi.fn(),
  account: {
    stripeAccountId: 'acct_1',
    chargesEnabled: true,
    disconnectedAt: null,
    credentialId: 'cred-1',
    applicationFeePercent: null,
  } as Record<string, unknown> | null,
  invoice: {
    number: 'INV-7',
    status: 'sent',
    balanceMinor: 10_000,
    contactInstanceId: 'contact-1',
  },
  quote: {
    number: 'Q-3',
    status: 'approved',
    totalMinor: 40_000,
    contactInstanceId: 'contact-1',
    workOrderInstanceId: 'wo-1',
  },
  deposits: { heldMinor: 0, appliedMinor: 0 },
  settings: {
    'organization.currency': 'USD',
    'documents.invoice.allowPartialPayments': true,
    'documents.invoice.partialPaymentMinPercent': 10,
  } as Record<string, unknown>,
  stamped: [] as Array<{ fieldId: string; value: unknown }>,
}))

vi.mock('@auxx/database', () => ({ database: {}, schema: {} }))
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    get: async () => 'user-system',
    from: () => ({ bySystemAttributes: async () => ({}) }),
  }),
}))
vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    async setValuesForEntity(input: { values: Array<{ fieldId: string; value: unknown }> }) {
      h.stamped.push(...input.values)
    }
  },
}))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings[key],
}))
vi.mock('../../payouts/stripe-account', () => ({ getPaymentAccount: async () => h.account }))
vi.mock('../../payouts/stripe-connect-client', () => ({
  getStripeConnectClient: () => ({ checkout: { sessions: { create: h.create } } }),
}))
vi.mock('../../payouts/application-fee', () => ({ resolveApplicationFee: () => 0 }))
vi.mock('../../public-token', () => ({
  buildPayUrl: (token: string) => `https://auxx.test/pay/${token}`,
  ensureInvoicePublicToken: async () => 'tok-inv',
}))
vi.mock('../../quote-public-token', () => ({
  buildQuoteViewUrl: (token: string) => `https://auxx.test/quote/${token}`,
  ensureQuotePublicToken: async () => 'tok-quote',
}))
vi.mock('../../quote-deposit', () => ({
  resolveQuoteDeposit: async () => ({ depositType: 'percent', depositAmount: 10_000 }),
}))
vi.mock('../reads', () => ({
  readInvoiceCheckoutTarget: async () => h.invoice,
  readQuoteCheckoutTarget: async () => h.quote,
  sumQuoteDeposits: async () => h.deposits,
}))

const { BadRequestError } = await import('../../../errors')
const { createInvoiceCheckoutSession, createQuoteDepositCheckoutSession } = await import(
  '../writes'
)

beforeEach(() => {
  h.create.mockReset()
  h.create.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })
  h.stamped.length = 0
  h.invoice = { number: 'INV-7', status: 'sent', balanceMinor: 10_000, contactInstanceId: 'c-1' }
  h.deposits = { heldMinor: 0, appliedMinor: 0 }
  h.account = {
    stripeAccountId: 'acct_1',
    chargesEnabled: true,
    disconnectedAt: null,
    credentialId: 'cred-1',
    applicationFeePercent: null,
  }
})

describe('an invoice checkout', () => {
  it('charges the whole balance and carries the metadata the webhook resolves on', async () => {
    const result = await createInvoiceCheckoutSession({
      organizationId: 'org-1',
      invoiceInstanceId: 'inv-1',
    })

    expect(result.checkoutUrl).toBe('https://checkout.stripe.test/cs_1')
    const [params, options] = h.create.mock.calls[0]!
    expect(params.line_items[0].price_data.unit_amount).toBe(10_000)
    expect(params.metadata).toMatchObject({ organizationId: 'org-1', invoiceInstanceId: 'inv-1' })
    // Both, because `payment_intent.succeeded` can land before the session event.
    expect(params.payment_intent_data.metadata).toMatchObject({ invoiceInstanceId: 'inv-1' })
    expect(options.stripeAccount).toBe('acct_1')
  })

  it('charges a validated partial amount when one is asked for', async () => {
    await createInvoiceCheckoutSession({
      organizationId: 'org-1',
      invoiceInstanceId: 'inv-1',
      amountMinor: 2_500,
    })
    expect(h.create.mock.calls[0]![0].line_items[0].price_data.unit_amount).toBe(2_500)
  })

  it('refuses a partial amount under the org minimum', async () => {
    await expect(
      createInvoiceCheckoutSession({
        organizationId: 'org-1',
        invoiceInstanceId: 'inv-1',
        amountMinor: 100,
      })
    ).rejects.toThrow(BadRequestError)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses an invoice that is not collectable', async () => {
    h.invoice = { ...h.invoice, status: 'draft' }
    await expect(
      createInvoiceCheckoutSession({ organizationId: 'org-1', invoiceInstanceId: 'inv-1' })
    ).rejects.toThrow(BadRequestError)
  })

  it('refuses when no Stripe account is connected', async () => {
    h.account = null
    await expect(
      createInvoiceCheckoutSession({ organizationId: 'org-1', invoiceInstanceId: 'inv-1' })
    ).rejects.toThrow(BadRequestError)
  })
})

describe('a quote deposit checkout', () => {
  it('charges the configured deposit', async () => {
    await createQuoteDepositCheckoutSession({
      organizationId: 'org-1',
      quoteInstanceId: 'quote-1',
    })
    const [params] = h.create.mock.calls[0]!
    expect(params.line_items[0].price_data.unit_amount).toBe(10_000)
    expect(params.metadata).toMatchObject({
      quoteInstanceId: 'quote-1',
      workOrderInstanceId: 'wo-1',
    })
  })

  // A quote has no self-correcting balance, so this check is the only thing between a
  // customer and paying one deposit twice.
  it('refuses once the deposit has already been collected', async () => {
    h.deposits = { heldMinor: 10_000, appliedMinor: 0 }
    await expect(
      createQuoteDepositCheckoutSession({ organizationId: 'org-1', quoteInstanceId: 'quote-1' })
    ).rejects.toThrow(BadRequestError)
    expect(h.create).not.toHaveBeenCalled()
  })
})
