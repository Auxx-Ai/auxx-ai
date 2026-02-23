// packages/billing/src/hooks/__tests__/invoice-paid.test.ts

import type { Database } from '@auxx/database'
import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { handleInvoicePaid } from '../invoice-paid'

vi.mock('@auxx/database', () => ({
  schema: {
    Invoice: { id: 'id' },
  },
  eq: vi.fn(),
}))

function makeInvoice(overrides: Record<string, any> = {}): Stripe.Invoice {
  return {
    id: 'inv_stripe_1',
    number: 'INV-001',
    amount_paid: 2999,
    currency: 'usd',
    created: 1_700_000_000,
    due_date: 1_700_086_400,
    billing_reason: 'subscription_cycle',
    invoice_pdf: 'https://stripe.com/pdf/inv_1',
    lines: {
      data: [{ subscription: 'sub_stripe_1' }],
    },
    ...overrides,
  } as unknown as Stripe.Invoice
}

function createMockDb(
  opts: { localSub?: Record<string, any> | null; existingInvoice?: Record<string, any> | null } = {}
) {
  const setMock = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })
  const updateMock = vi.fn(() => ({ set: setMock }))
  const valuesMock = vi.fn().mockResolvedValue(undefined)
  const insertMock = vi.fn(() => ({ values: valuesMock }))

  return {
    db: {
      query: {
        PlanSubscription: {
          findFirst: vi.fn().mockResolvedValue(opts.localSub ?? null),
        },
        Invoice: {
          findFirst: vi.fn().mockResolvedValue(opts.existingInvoice ?? null),
        },
      },
      update: updateMock,
      insert: insertMock,
    } as unknown as Database,
    setMock,
    updateMock,
    valuesMock,
    insertMock,
  }
}

describe('handleInvoicePaid', () => {
  it('returns early when invoice has no subscription', async () => {
    const { db, setMock, insertMock } = createMockDb()
    const invoice = makeInvoice({ lines: { data: [{ subscription: null }] } })

    const event = {
      type: 'invoice.paid',
      data: { object: invoice },
    } as unknown as Stripe.Event

    await handleInvoicePaid(db, event)

    expect(setMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns early when local subscription not found', async () => {
    const { db, setMock, insertMock } = createMockDb({ localSub: null })

    const event = {
      type: 'invoice.paid',
      data: { object: makeInvoice() },
    } as unknown as Stripe.Event

    await handleInvoicePaid(db, event)

    expect(setMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('updates existing invoice to PAID status', async () => {
    const { db, setMock } = createMockDb({
      localSub: { id: 'local_sub', organizationId: 'org_1' },
      existingInvoice: { id: 'inv_local_1', stripeInvoiceId: 'inv_stripe_1' },
    })

    const event = {
      type: 'invoice.paid',
      data: { object: makeInvoice() },
    } as unknown as Stripe.Event

    await handleInvoicePaid(db, event)

    expect(setMock).toHaveBeenCalledTimes(1)
    const payload = setMock.mock.calls[0][0]
    expect(payload.status).toBe('PAID')
    expect(payload.amount).toBe(2999)
    expect(payload.paidDate).toBeInstanceOf(Date)
    expect(payload.pdfUrl).toBe('https://stripe.com/pdf/inv_1')
  })

  it('creates new invoice with PAID status when no existing record', async () => {
    const { db, valuesMock } = createMockDb({
      localSub: { id: 'local_sub', organizationId: 'org_1' },
      existingInvoice: null,
    })

    const event = {
      type: 'invoice.paid',
      data: { object: makeInvoice() },
    } as unknown as Stripe.Event

    await handleInvoicePaid(db, event)

    expect(valuesMock).toHaveBeenCalledTimes(1)
    const record = valuesMock.mock.calls[0][0]
    expect(record.status).toBe('PAID')
    expect(record.organizationId).toBe('org_1')
    expect(record.subscriptionId).toBe('local_sub')
    expect(record.stripeInvoiceId).toBe('inv_stripe_1')
    expect(record.invoiceNumber).toBe('INV-001')
    expect(record.amount).toBe(2999)
    expect(record.currency).toBe('USD')
    expect(record.billingReason).toBe('subscription_cycle')
    expect(record.pdfUrl).toBe('https://stripe.com/pdf/inv_1')
    expect(record.paidDate).toBeInstanceOf(Date)
    expect(record.invoiceDate).toBeInstanceOf(Date)
    expect(record.dueDate).toBeInstanceOf(Date)
  })
})
