// packages/billing/src/services/__tests__/webhook-service.test.ts

import type { Database } from '@auxx/database'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebhookHandlers } from '../../types/webhook'
import { WebhookService } from '../webhook-service'

// Mock all hook handlers — each returns { organizationId } to match real signatures
vi.mock('../../hooks', () => ({
  handleCheckoutSessionCompleted: vi.fn().mockResolvedValue({ organizationId: 'org_123' }),
  handleSubscriptionUpdated: vi.fn().mockResolvedValue({ organizationId: 'org_123' }),
  handleSubscriptionCreated: vi.fn().mockResolvedValue({ organizationId: 'org_123' }),
  handleSubscriptionDeleted: vi.fn().mockResolvedValue({ organizationId: 'org_123' }),
  handleInvoicePaid: vi.fn().mockResolvedValue({ organizationId: 'org_123' }),
  handleInvoicePaymentFailed: vi.fn().mockResolvedValue({ organizationId: 'org_123' }),
}))

const db = {} as unknown as Database

function makeEvent(type: string): Stripe.Event {
  return { type, data: { object: {} } } as unknown as Stripe.Event
}

// Signature verification now lives at the route edge (verifyStripeSignature); this
// service only dispatches PRE-VERIFIED events.
describe('WebhookService.processVerifiedEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes checkout.session.completed to handler + custom handler', async () => {
    const event = makeEvent('checkout.session.completed')
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const handlers: WebhookHandlers = { onCheckoutSessionCompleted: customHandler }
    const service = new WebhookService(db, handlers)

    const result = await service.processVerifiedEvent(event)

    expect(result).toEqual({ success: true })
    const { handleCheckoutSessionCompleted } = await import('../../hooks')
    expect(handleCheckoutSessionCompleted).toHaveBeenCalledWith(db, event)
    expect(customHandler).toHaveBeenCalledWith(event, { organizationId: 'org_123' })
  })

  it('routes customer.subscription.updated to handler + custom handler', async () => {
    const event = makeEvent('customer.subscription.updated')
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const service = new WebhookService(db, { onSubscriptionUpdated: customHandler })

    await service.processVerifiedEvent(event)

    const { handleSubscriptionUpdated } = await import('../../hooks')
    expect(handleSubscriptionUpdated).toHaveBeenCalledWith(db, event, undefined)
    expect(customHandler).toHaveBeenCalledWith(event, { organizationId: 'org_123' })
  })

  it('routes customer.subscription.created to handler + custom handler', async () => {
    const event = makeEvent('customer.subscription.created')
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const service = new WebhookService(db, { onSubscriptionCreated: customHandler })

    await service.processVerifiedEvent(event)

    const { handleSubscriptionCreated } = await import('../../hooks')
    expect(handleSubscriptionCreated).toHaveBeenCalledWith(db, event, undefined)
    expect(customHandler).toHaveBeenCalledWith(event, { organizationId: 'org_123' })
  })

  it('routes customer.subscription.deleted to handler + custom handler', async () => {
    const event = makeEvent('customer.subscription.deleted')
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const service = new WebhookService(db, { onSubscriptionDeleted: customHandler })

    await service.processVerifiedEvent(event)

    const { handleSubscriptionDeleted } = await import('../../hooks')
    expect(handleSubscriptionDeleted).toHaveBeenCalledWith(db, event)
    expect(customHandler).toHaveBeenCalledWith(event, { organizationId: 'org_123' })
  })

  it('routes invoice.paid to handler + custom handler', async () => {
    const event = makeEvent('invoice.paid')
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const service = new WebhookService(db, { onInvoicePaid: customHandler })

    await service.processVerifiedEvent(event)

    const { handleInvoicePaid } = await import('../../hooks')
    expect(handleInvoicePaid).toHaveBeenCalledWith(db, event)
    expect(customHandler).toHaveBeenCalledWith(event, { organizationId: 'org_123' })
  })

  it('routes invoice.payment_failed to handler + custom handler', async () => {
    const event = makeEvent('invoice.payment_failed')
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const service = new WebhookService(db, { onInvoicePaymentFailed: customHandler })

    await service.processVerifiedEvent(event)

    const { handleInvoicePaymentFailed } = await import('../../hooks')
    expect(handleInvoicePaymentFailed).toHaveBeenCalledWith(db, event)
    expect(customHandler).toHaveBeenCalledWith(event, { organizationId: 'org_123' })
  })

  it('logs unhandled event types without throwing', async () => {
    const event = makeEvent('payment_intent.succeeded')
    const service = new WebhookService(db)

    const result = await service.processVerifiedEvent(event)
    expect(result).toEqual({ success: true })
  })

  it('returns { success: true } on successful processing', async () => {
    const event = makeEvent('customer.subscription.updated')
    const service = new WebhookService(db)

    const result = await service.processVerifiedEvent(event)
    expect(result).toEqual({ success: true })
  })
})
