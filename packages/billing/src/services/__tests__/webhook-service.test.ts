// packages/billing/src/services/__tests__/webhook-service.test.ts

import { stripeClient } from '@auxx/billing/services/stripe-client'
import type { Database } from '@auxx/database'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebhookHandlers } from '../../types/webhook'
import { WebhookService } from '../webhook-service'

// Mock all hook handlers
vi.mock('../../hooks', () => ({
  handleCheckoutSessionCompleted: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionUpdated: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionCreated: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionDeleted: vi.fn().mockResolvedValue(undefined),
  handleInvoicePaid: vi.fn().mockResolvedValue(undefined),
  handleInvoicePaymentFailed: vi.fn().mockResolvedValue(undefined),
}))

const constructEventAsyncMock = vi.fn()

const mockStripeApi = {
  webhooks: {
    constructEventAsync: constructEventAsyncMock,
  },
}

const db = {} as unknown as Database

function makeEvent(type: string): Stripe.Event {
  return { type, data: { object: {} } } as unknown as Stripe.Event
}

describe('WebhookService', () => {
  beforeEach(() => {
    vi.mocked(stripeClient.getClient).mockReturnValue(mockStripeApi as unknown as Stripe)
    constructEventAsyncMock.mockReset()
  })

  it('throws on invalid signature', async () => {
    constructEventAsyncMock.mockRejectedValueOnce(new Error('Invalid signature'))
    const service = new WebhookService(db, 'whsec_test')

    await expect(service.processWebhook('body', 'bad_sig')).rejects.toThrow(
      'Webhook Error: Invalid signature'
    )
  })

  it('routes checkout.session.completed to handler + custom handler', async () => {
    const event = makeEvent('checkout.session.completed')
    constructEventAsyncMock.mockResolvedValueOnce(event)
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const handlers: WebhookHandlers = { onCheckoutSessionCompleted: customHandler }
    const service = new WebhookService(db, 'whsec_test', handlers)

    const result = await service.processWebhook('body', 'sig')

    expect(result).toEqual({ success: true })
    const { handleCheckoutSessionCompleted } = await import('../../hooks')
    expect(handleCheckoutSessionCompleted).toHaveBeenCalledWith(db, event)
    expect(customHandler).toHaveBeenCalledWith(event)
  })

  it('routes customer.subscription.updated to handler + custom handler', async () => {
    const event = makeEvent('customer.subscription.updated')
    constructEventAsyncMock.mockResolvedValueOnce(event)
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const service = new WebhookService(db, 'whsec_test', { onSubscriptionUpdated: customHandler })

    await service.processWebhook('body', 'sig')

    const { handleSubscriptionUpdated } = await import('../../hooks')
    expect(handleSubscriptionUpdated).toHaveBeenCalledWith(db, event)
    expect(customHandler).toHaveBeenCalledWith(event)
  })

  it('routes customer.subscription.created to handler + custom handler', async () => {
    const event = makeEvent('customer.subscription.created')
    constructEventAsyncMock.mockResolvedValueOnce(event)
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const service = new WebhookService(db, 'whsec_test', { onSubscriptionCreated: customHandler })

    await service.processWebhook('body', 'sig')

    const { handleSubscriptionCreated } = await import('../../hooks')
    expect(handleSubscriptionCreated).toHaveBeenCalledWith(db, event)
    expect(customHandler).toHaveBeenCalledWith(event)
  })

  it('routes customer.subscription.deleted to handler + custom handler', async () => {
    const event = makeEvent('customer.subscription.deleted')
    constructEventAsyncMock.mockResolvedValueOnce(event)
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const service = new WebhookService(db, 'whsec_test', { onSubscriptionDeleted: customHandler })

    await service.processWebhook('body', 'sig')

    const { handleSubscriptionDeleted } = await import('../../hooks')
    expect(handleSubscriptionDeleted).toHaveBeenCalledWith(db, event)
    expect(customHandler).toHaveBeenCalledWith(event)
  })

  it('routes invoice.paid to handler + custom handler', async () => {
    const event = makeEvent('invoice.paid')
    constructEventAsyncMock.mockResolvedValueOnce(event)
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const service = new WebhookService(db, 'whsec_test', { onInvoicePaid: customHandler })

    await service.processWebhook('body', 'sig')

    const { handleInvoicePaid } = await import('../../hooks')
    expect(handleInvoicePaid).toHaveBeenCalledWith(db, event)
    expect(customHandler).toHaveBeenCalledWith(event)
  })

  it('routes invoice.payment_failed to handler + custom handler', async () => {
    const event = makeEvent('invoice.payment_failed')
    constructEventAsyncMock.mockResolvedValueOnce(event)
    const customHandler = vi.fn().mockResolvedValue(undefined)
    const service = new WebhookService(db, 'whsec_test', {
      onInvoicePaymentFailed: customHandler,
    })

    await service.processWebhook('body', 'sig')

    const { handleInvoicePaymentFailed } = await import('../../hooks')
    expect(handleInvoicePaymentFailed).toHaveBeenCalledWith(db, event)
    expect(customHandler).toHaveBeenCalledWith(event)
  })

  it('logs unhandled event types without throwing', async () => {
    const event = makeEvent('payment_intent.succeeded')
    constructEventAsyncMock.mockResolvedValueOnce(event)
    const service = new WebhookService(db, 'whsec_test')

    const result = await service.processWebhook('body', 'sig')
    expect(result).toEqual({ success: true })
  })

  it('returns { success: true } on successful processing', async () => {
    const event = makeEvent('customer.subscription.updated')
    constructEventAsyncMock.mockResolvedValueOnce(event)
    const service = new WebhookService(db, 'whsec_test')

    const result = await service.processWebhook('body', 'sig')
    expect(result).toEqual({ success: true })
  })
})
