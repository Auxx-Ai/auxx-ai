// packages/billing/src/services/__tests__/billing-portal-service.test.ts

import { stripeClient } from '@auxx/billing/services/stripe-client'
import type { Database } from '@auxx/database'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingError, ErrorCode } from '../../utils/error-codes'
import { BillingPortalService } from '../billing-portal-service'

const mockStripeApi = {
  billingPortal: {
    sessions: {
      create: vi.fn(),
    },
  },
}

function createMockDb(subscription?: { stripeCustomerId: string | null }) {
  return {
    query: {
      PlanSubscription: {
        findFirst: vi.fn().mockResolvedValue(subscription ?? null),
      },
    },
  } as unknown as Database
}

describe('BillingPortalService', () => {
  beforeEach(() => {
    vi.mocked(stripeClient.getClient).mockReturnValue(mockStripeApi as unknown as Stripe)
    mockStripeApi.billingPortal.sessions.create.mockReset()
  })

  it('throws BillingError(NO_CUSTOMER_FOUND) when no active subscription with stripeCustomerId', async () => {
    const db = createMockDb(null)
    const service = new BillingPortalService(db, 'https://app.example.com')

    await expect(
      service.createSession({ organizationId: 'org_1', returnUrl: '/settings' })
    ).rejects.toThrow(BillingError)

    try {
      await service.createSession({ organizationId: 'org_1', returnUrl: '/settings' })
    } catch (err) {
      expect((err as BillingError).code).toBe(ErrorCode.NO_CUSTOMER_FOUND)
    }
  })

  it('throws when subscription exists but has no stripeCustomerId', async () => {
    const db = createMockDb({ stripeCustomerId: null })
    const service = new BillingPortalService(db, 'https://app.example.com')

    await expect(
      service.createSession({ organizationId: 'org_1', returnUrl: '/settings' })
    ).rejects.toThrow(BillingError)
  })

  it('creates Stripe billing portal session with correct customer and return URL', async () => {
    const db = createMockDb({ stripeCustomerId: 'cus_123' })
    mockStripeApi.billingPortal.sessions.create.mockResolvedValueOnce({
      url: 'https://billing.stripe.com/session/xyz',
    })
    const service = new BillingPortalService(db, 'https://app.example.com')

    const result = await service.createSession({
      organizationId: 'org_1',
      returnUrl: '/settings/billing',
    })

    expect(result).toEqual({
      url: 'https://billing.stripe.com/session/xyz',
      redirect: true,
    })
    expect(mockStripeApi.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'https://app.example.com/settings/billing',
      locale: undefined,
    })
  })

  it('passes locale to Stripe billing portal session', async () => {
    const db = createMockDb({ stripeCustomerId: 'cus_123' })
    mockStripeApi.billingPortal.sessions.create.mockResolvedValueOnce({
      url: 'https://billing.stripe.com/session/abc',
    })
    const service = new BillingPortalService(db, 'https://app.example.com')

    await service.createSession({
      organizationId: 'org_1',
      returnUrl: '/settings',
      locale: 'de',
    })

    expect(mockStripeApi.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'de' })
    )
  })
})
