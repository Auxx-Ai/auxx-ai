// packages/billing/src/hooks/__tests__/invoice-payment-failed.test.ts

import type { Database } from '@auxx/database'
import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { handleInvoicePaymentFailed } from '../invoice-payment-failed'

vi.mock('@auxx/database', () => ({
  schema: {
    Invoice: { id: 'id' },
  },
  eq: vi.fn(),
}))

function makeInvoice(overrides: Record<string, any> = {}): Stripe.Invoice {
  return {
    id: 'inv_stripe_fail',
    number: 'INV-FAIL-001',
    amount_due: 4999,
    currency: 'usd',
    created: 1_700_000_000,
    due_date: 1_700_086_400,
    billing_reason: 'subscription_cycle',
    invoice_pdf: 'https://stripe.com/pdf/inv_fail',
    attempt_count: 3,
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

describe('handleInvoicePaymentFailed', () => {
  it('returns early when invoice has no subscription', async () => {
    const { db, setMock, insertMock } = createMockDb()
    const invoice = makeInvoice({ lines: { data: [{ subscription: null }] } })

    const event = {
      type: 'invoice.payment_failed',
      data: { object: invoice },
    } as unknown as Stripe.Event

    await handleInvoicePaymentFailed(db, event)

    expect(setMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns early when local subscription not found', async () => {
    const { db, setMock, insertMock } = createMockDb({ localSub: null })

    const event = {
      type: 'invoice.payment_failed',
      data: { object: makeInvoice() },
    } as unknown as Stripe.Event

    await handleInvoicePaymentFailed(db, event)

    expect(setMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('updates existing invoice to PENDING status', async () => {
    const { db, setMock } = createMockDb({
      localSub: { id: 'local_sub', organizationId: 'org_1' },
      existingInvoice: { id: 'inv_local_1', stripeInvoiceId: 'inv_stripe_fail' },
    })

    const event = {
      type: 'invoice.payment_failed',
      data: { object: makeInvoice() },
    } as unknown as Stripe.Event

    await handleInvoicePaymentFailed(db, event)

    expect(setMock).toHaveBeenCalledTimes(1)
    const payload = setMock.mock.calls[0][0]
    expect(payload.status).toBe('PENDING')
    expect(payload.updatedAt).toBeInstanceOf(Date)
  })

  it('creates new invoice with PENDING status', async () => {
    const { db, valuesMock } = createMockDb({
      localSub: { id: 'local_sub', organizationId: 'org_1' },
      existingInvoice: null,
    })

    const event = {
      type: 'invoice.payment_failed',
      data: { object: makeInvoice() },
    } as unknown as Stripe.Event

    await handleInvoicePaymentFailed(db, event)

    expect(valuesMock).toHaveBeenCalledTimes(1)
    const record = valuesMock.mock.calls[0][0]
    expect(record.status).toBe('PENDING')
    expect(record.organizationId).toBe('org_1')
    expect(record.subscriptionId).toBe('local_sub')
    expect(record.stripeInvoiceId).toBe('inv_stripe_fail')
    expect(record.amount).toBe(4999)
    expect(record.currency).toBe('USD')
  })
})
