// packages/billing/src/services/__tests__/customer-service.test.ts

import { stripeClient } from '@auxx/billing/services/stripe-client'
import type { Database } from '@auxx/database'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerService } from '../customer-service'

vi.mock('@auxx/database', () => ({
  schema: {
    PlanSubscription: {
      organizationId: 'organizationId',
      stripeCustomerId: 'stripeCustomerId',
    },
  },
}))

const mockStripeApi = {
  customers: {
    list: vi.fn(),
    create: vi.fn(),
  },
}

function createMockDb(subscription?: { stripeCustomerId: string | null }) {
  const selectMock = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(subscription ? [subscription] : []),
      }),
    }),
  }
  return {
    select: vi.fn().mockReturnValue(selectMock),
  } as unknown as Database
}

describe('CustomerService', () => {
  beforeEach(() => {
    vi.mocked(stripeClient.getClient).mockReturnValue(mockStripeApi as unknown as Stripe)
    mockStripeApi.customers.list.mockReset()
    mockStripeApi.customers.create.mockReset()
  })

  it('returns existing customer ID from local DB when subscription has stripeCustomerId', async () => {
    const db = createMockDb({ stripeCustomerId: 'cus_existing' })
    const service = new CustomerService(db)

    const result = await service.getOrCreateCustomer({
      organizationId: 'org_1',
      email: 'test@example.com',
    })

    expect(result).toBe('cus_existing')
    expect(mockStripeApi.customers.list).not.toHaveBeenCalled()
    expect(mockStripeApi.customers.create).not.toHaveBeenCalled()
  })

  it('finds existing Stripe customer by email when no local record', async () => {
    const db = createMockDb()
    mockStripeApi.customers.list.mockResolvedValueOnce({
      data: [{ id: 'cus_from_stripe' }],
    })
    const service = new CustomerService(db)

    const result = await service.getOrCreateCustomer({
      organizationId: 'org_1',
      email: 'test@example.com',
    })

    expect(result).toBe('cus_from_stripe')
    expect(mockStripeApi.customers.list).toHaveBeenCalledWith({
      email: 'test@example.com',
      limit: 1,
    })
    expect(mockStripeApi.customers.create).not.toHaveBeenCalled()
  })

  it('creates new Stripe customer when no existing customer found', async () => {
    const db = createMockDb()
    mockStripeApi.customers.list.mockResolvedValueOnce({ data: [] })
    mockStripeApi.customers.create.mockResolvedValueOnce({ id: 'cus_new' })
    const service = new CustomerService(db)

    const result = await service.getOrCreateCustomer({
      organizationId: 'org_1',
      email: 'new@example.com',
      name: 'Test Org',
    })

    expect(result).toBe('cus_new')
    expect(mockStripeApi.customers.create).toHaveBeenCalledWith({
      email: 'new@example.com',
      name: 'Test Org',
      metadata: {
        organizationId: 'org_1',
      },
    })
  })

  it('passes metadata correctly to Stripe on customer creation', async () => {
    const db = createMockDb()
    mockStripeApi.customers.list.mockResolvedValueOnce({ data: [] })
    mockStripeApi.customers.create.mockResolvedValueOnce({ id: 'cus_meta' })
    const service = new CustomerService(db)

    await service.getOrCreateCustomer({
      organizationId: 'org_1',
      email: 'test@example.com',
      metadata: { source: 'checkout', plan: 'pro' },
    })

    expect(mockStripeApi.customers.create).toHaveBeenCalledWith({
      email: 'test@example.com',
      name: undefined,
      metadata: {
        organizationId: 'org_1',
        source: 'checkout',
        plan: 'pro',
      },
    })
  })
})
