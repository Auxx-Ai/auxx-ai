// packages/lib/src/accounting/money/checkout/__tests__/webhook.test.ts
//
// The webhook's two obligations: one confirmed payment becomes one receipt applied to the
// invoice and posted, and the SECOND event Stripe sends for that same payment records nothing
// further. The second one is the reason the retry key is the payment intent rather than the
// event id — `checkout.session.completed` and `payment_intent.succeeded` arrive with two
// different event ids for one charge.

import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  commands: new Map<string, Record<string, string>>(),
  runs: [] as Array<{ commandKey: string; kind: string }>,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  postedReceipts: [] as string[],
  postedDeposits: [] as string[],
  syncs: [] as string[],
  rail: { paymentGatewayId: 'gw-stripe', clearingGlAccountId: 'gl-1200' } as {
    paymentGatewayId: string
    clearingGlAccountId: string
  } | null,
}))

vi.mock('../../../ledger/setup/book-time-zone', () => ({
  readBookTimeZoneOrUtc: async () => 'UTC',
  todayInBookTimeZone: async () => new Date().toISOString().slice(0, 10),
}))
vi.mock('@auxx/database', () => ({
  database: {},
  schema: { MoneyTransaction: 'MoneyTransaction', MoneyApplication: 'MoneyApplication' },
}))

vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ get: async () => 'user-system' }),
}))

vi.mock('../../commands/run-money-command', () => ({
  runMoneyCommand: async (
    _db: unknown,
    input: { commandKey: string; kind: string },
    execute: (tx: unknown, commandId: string) => Promise<Record<string, string>>
  ) => {
    h.runs.push({ commandKey: input.commandKey, kind: input.kind })
    const previous = h.commands.get(input.commandKey)
    if (previous) return previous
    const tx = {
      insert: (table: string) => ({
        values: (values: Record<string, unknown>) => {
          h.inserts.push({ table, values })
          return {
            returning: async () => [{ id: `${table}-1` }],
            then: (resolve: (v: unknown) => unknown) => resolve(undefined),
          }
        },
      }),
    }
    const result = await execute(tx, 'cmd-1')
    h.commands.set(input.commandKey, result)
    return result
  },
}))

vi.mock('../../invoice-payments/receipt-accounting', () => ({
  acceptInvoiceReceiptAccounting: async (_db: unknown, input: { moneyTransactionId: string }) => {
    h.postedReceipts.push(input.moneyTransactionId)
    return { status: 'posted', glPostingId: 'gl-1' }
  },
}))

vi.mock('../deposit-accounting', () => ({
  acceptQuoteDepositAccounting: async (_db: unknown, input: { moneyTransactionId: string }) => {
    h.postedDeposits.push(input.moneyTransactionId)
    return { status: 'posted', glPostingId: 'gl-2' }
  },
}))

vi.mock('../../invoice-payments/payment-state', () => ({
  syncInvoicePaymentState: async (input: { invoiceInstanceId: string }) => {
    h.syncs.push(input.invoiceInstanceId)
  },
}))

vi.mock('../reads', () => {
  return {
    INVOICE_CHECKOUT_COMMAND_KIND: 'stripe_invoice_checkout',
    QUOTE_DEPOSIT_COMMAND_KIND: 'stripe_quote_deposit',
    resolveStripeRail: async () => h.rail,
    readInvoiceCheckoutTarget: async () => ({
      number: 'INV-1',
      status: 'sent',
      balanceMinor: 5000,
      contactInstanceId: 'contact-1',
    }),
    readQuoteCheckoutTarget: async () => ({
      number: 'Q-1',
      status: 'approved',
      totalMinor: 20000,
      contactInstanceId: 'contact-1',
      workOrderInstanceId: null,
    }),
  }
})

const { applyStripeCheckoutEvent } = await import('../webhook')

function sessionEvent(metadata: Record<string, string>): Stripe.Event {
  return {
    id: 'evt_session',
    created: 1_700_000_000,
    type: 'checkout.session.completed',
    data: {
      object: {
        payment_status: 'paid',
        payment_intent: 'pi_1',
        amount_total: 5000,
        currency: 'usd',
        metadata,
      },
    },
  } as unknown as Stripe.Event
}

function intentEvent(metadata: Record<string, string>): Stripe.Event {
  return {
    id: 'evt_intent',
    created: 1_700_000_050,
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_1', amount_received: 5000, currency: 'usd', metadata } },
  } as unknown as Stripe.Event
}

beforeEach(() => {
  h.commands.clear()
  h.runs.length = 0
  h.inserts.length = 0
  h.postedReceipts.length = 0
  h.postedDeposits.length = 0
  h.syncs.length = 0
  h.rail = { paymentGatewayId: 'gw-stripe', clearingGlAccountId: 'gl-1200' }
})

const invoiceMetadata = { organizationId: 'org-1', invoiceInstanceId: 'inv-1' }

describe('an invoice paid online', () => {
  it('records one receipt, applies it, reprojects the invoice and posts it', async () => {
    await applyStripeCheckoutEvent(sessionEvent(invoiceMetadata))

    const money = h.inserts.find((row) => row.table === 'MoneyTransaction')!
    expect(money.values).toMatchObject({
      purpose: 'customer_receipt',
      amountMinor: 5000n,
      method: 'card',
      reference: 'pi_1',
      partyInstanceId: 'contact-1',
      // The rail rides on the movement itself; the poster no longer takes one.
      paymentGatewayId: 'gw-stripe',
    })
    expect(h.inserts.find((row) => row.table === 'MoneyApplication')!.values).toMatchObject({
      invoiceInstanceId: 'inv-1',
      operation: 'apply',
      amountMinor: 5000n,
    })
    expect(h.syncs).toEqual(['inv-1'])
    expect(h.postedReceipts).toEqual(['MoneyTransaction-1'])
  })

  it('keys the command on the payment intent, not the event', async () => {
    await applyStripeCheckoutEvent(sessionEvent(invoiceMetadata))
    expect(h.runs[0]!.commandKey).toBe('stripe-checkout:pi_1')
  })
})

describe('idempotency', () => {
  it('writes nothing more for the second event Stripe sends about one payment', async () => {
    await applyStripeCheckoutEvent(sessionEvent(invoiceMetadata))
    const afterFirst = h.inserts.length
    await applyStripeCheckoutEvent(intentEvent(invoiceMetadata))

    expect(h.runs.map((run) => run.commandKey)).toEqual([
      'stripe-checkout:pi_1',
      'stripe-checkout:pi_1',
    ])
    expect(h.inserts).toHaveLength(afterFirst)
    expect(h.syncs).toEqual(['inv-1'])
  })

  it('is a no-op on a plain redelivery of the same event', async () => {
    await applyStripeCheckoutEvent(sessionEvent(invoiceMetadata))
    const afterFirst = h.inserts.length
    await applyStripeCheckoutEvent(sessionEvent(invoiceMetadata))
    expect(h.inserts).toHaveLength(afterFirst)
  })
})

describe('a quote deposit paid online', () => {
  const quoteMetadata = { organizationId: 'org-1', quoteInstanceId: 'quote-1' }

  it('holds the receipt against the quote instead of applying it', async () => {
    await applyStripeCheckoutEvent(sessionEvent(quoteMetadata))

    expect(h.inserts.filter((row) => row.table === 'MoneyApplication')).toHaveLength(0)
    expect(h.runs[0]!.kind).toBe('stripe_quote_deposit')
    expect(h.postedDeposits).toEqual(['MoneyTransaction-1'])
    expect(h.syncs).toEqual([])
  })

  // MIGRATION follow-up 7: the quote link is a column on the row itself, not a
  // fact stamped onto the command's actorSnapshot.
  it('stamps the quote directly on the MoneyTransaction row', async () => {
    await applyStripeCheckoutEvent(sessionEvent(quoteMetadata))

    const money = h.inserts.find((row) => row.table === 'MoneyTransaction')!
    expect(money.values).toMatchObject({ quoteInstanceId: 'quote-1' })
    expect(money.values).toMatchObject({ workOrderInstanceId: null })
  })

  it('carries the work order too, when the quote already converted', async () => {
    await applyStripeCheckoutEvent(sessionEvent({ ...quoteMetadata, workOrderInstanceId: 'wo-1' }))

    const money = h.inserts.find((row) => row.table === 'MoneyTransaction')!
    expect(money.values).toMatchObject({ quoteInstanceId: 'quote-1', workOrderInstanceId: 'wo-1' })
  })
})

describe('what is ignored', () => {
  it('skips an unpaid session', async () => {
    const event = sessionEvent(invoiceMetadata)
    ;(event.data.object as { payment_status: string }).payment_status = 'unpaid'
    await applyStripeCheckoutEvent(event)
    expect(h.runs).toHaveLength(0)
  })

  it('skips an event carrying no auxx metadata', async () => {
    await applyStripeCheckoutEvent(sessionEvent({}))
    expect(h.runs).toHaveLength(0)
  })

  it('skips an event type it does not handle', async () => {
    await applyStripeCheckoutEvent({
      id: 'evt_x',
      created: 1,
      type: 'charge.refunded',
      data: { object: {} },
    } as unknown as Stripe.Event)
    expect(h.runs).toHaveLength(0)
  })
})
