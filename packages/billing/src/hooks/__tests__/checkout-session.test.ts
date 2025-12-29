// packages/billing/src/hooks/__tests__/checkout-session.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Database } from '@auxx/database'
import type Stripe from 'stripe'
import { handleCheckoutSessionCompleted } from '@auxx/billing/hooks/checkout-session'
import { handleSubscriptionCreated } from '@auxx/billing/hooks/subscription-updated'

const { retrieveMock, getClientMock } = vi.hoisted(() => {
  const retrieve = vi.fn()
  const api = {
    subscriptions: {
      retrieve,
    },
  }
  return {
    retrieveMock: retrieve,
    getClientMock: vi.fn(() => api),
  }
})

vi.mock('@auxx/billing/services/stripe-client', () => ({
  stripeClient: {
    getClient: getClientMock,
  },
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('Stripe subscription synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    retrieveMock.mockReset()
    getClientMock.mockReset()
  })

  it('persists stripeSubscriptionId during checkout completion even when plan lookup fails', async () => {
    const setMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    })
    const updateMock = vi.fn(() => ({ set: setMock }))

    const planFindFirstMock = vi.fn().mockResolvedValue(null)

    const db = {
      update: updateMock,
      query: {
        Plan: {
          findFirst: planFindFirstMock,
        },
      },
    } as unknown as Database

    const stripeSubscription = {
      id: 'sub_123',
      status: 'active',
      items: {
        data: [
          {
            price: { id: 'price_123', lookup_key: null },
            quantity: 2,
            current_period_start: 1_700_000_000,
            current_period_end: 1_700_086_400,
          },
        ],
      },
      metadata: {
        subscriptionId: 'local_sub_1',
        organizationId: 'org_1',
      },
      customer: 'cus_123',
      trial_start: 1_700_000_000,
      trial_end: 1_700_086_400,
      cancel_at_period_end: false,
    } as unknown as Stripe.Subscription

    retrieveMock.mockResolvedValueOnce(stripeSubscription)

    const event = {
      data: {
        object: {
          id: 'cs_test',
          mode: 'subscription',
          subscription: 'sub_123',
          client_reference_id: 'org_1',
          metadata: {
            subscriptionId: 'local_sub_1',
            organizationId: 'org_1',
          },
        },
      },
      type: 'checkout.session.completed',
    } as unknown as Stripe.Event

    await handleCheckoutSessionCompleted(db, event)

    expect(setMock).toHaveBeenCalledTimes(1)
    const updateArgs = setMock.mock.calls[0][0] as Record<string, unknown>
    expect(updateArgs.stripeSubscriptionId).toBe('sub_123')
    expect(updateArgs.stripeCustomerId).toBe('cus_123')
    expect(updateArgs.plan).toBeUndefined()
  })

  it('syncs subscription created events using organization fallback when metadata is incomplete', async () => {
    const localSubscription = {
      id: 'local_sub_org',
      status: 'incomplete',
    }

    const planFindFirstMock = vi.fn().mockResolvedValue(null)
    const planSubscriptionFindFirstMock = vi.fn().mockResolvedValue(null)
    const planSubscriptionFindManyMock = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([localSubscription])

    const setMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    })
    const updateMock = vi.fn(() => ({ set: setMock }))

    const db = {
      update: updateMock,
      query: {
        Plan: {
          findFirst: planFindFirstMock,
        },
        PlanSubscription: {
          findFirst: planSubscriptionFindFirstMock,
          findMany: planSubscriptionFindManyMock,
        },
      },
    } as unknown as Database

    const stripeSubscription = {
      id: 'sub_created',
      status: 'active',
      items: {
        data: [
          {
            price: { id: 'price_missing', lookup_key: null },
            quantity: 1,
            current_period_start: 1_700_000_000,
            current_period_end: 1_700_086_400,
          },
        ],
      },
      metadata: {
        organizationId: 'org_from_meta',
      },
      customer: 'cus_org',
      cancel_at_period_end: false,
    } as unknown as Stripe.Subscription

    const event = {
      data: {
        object: stripeSubscription,
      },
      type: 'customer.subscription.created',
    } as unknown as Stripe.Event

    await handleSubscriptionCreated(db, event)

    expect(planSubscriptionFindFirstMock).toHaveBeenCalledTimes(1)
    expect(planSubscriptionFindManyMock).toHaveBeenCalledTimes(2)
    expect(setMock).toHaveBeenCalledTimes(1)
    const updateArgs = setMock.mock.calls[0][0] as Record<string, unknown>
    expect(updateArgs.stripeSubscriptionId).toBe('sub_created')
    expect(updateArgs.stripeCustomerId).toBe('cus_org')
  })
})
