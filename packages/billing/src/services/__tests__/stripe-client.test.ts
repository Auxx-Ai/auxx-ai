// packages/billing/src/services/__tests__/stripe-client.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

// We need to test the actual StripeClientService class, so we unmock the module
// and instead mock the Stripe constructor
vi.mock('stripe', () => {
  const MockStripe = vi.fn(() => ({
    prices: {
      list: vi.fn(),
    },
  }))
  return { default: MockStripe }
})

// Unmock stripe-client so we test the real implementation
vi.mock('@auxx/billing/services/stripe-client', async (importOriginal) => {
  return await importOriginal()
})

describe('StripeClientService', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('getClient() throws when not initialized', async () => {
    // Re-import to get a fresh singleton
    const { stripeClient } = await import('../stripe-client')
    expect(() => stripeClient.getClient()).toThrow('Stripe client not initialized')
  })

  it('initialize() creates client and returns it', async () => {
    const { stripeClient } = await import('../stripe-client')
    const client = stripeClient.initialize('sk_test_123')
    expect(client).toBeDefined()
    expect(client.prices).toBeDefined()
  })

  it('initialize() is idempotent — calling twice returns same client', async () => {
    const { stripeClient } = await import('../stripe-client')
    const first = stripeClient.initialize('sk_test_123')
    const second = stripeClient.initialize('sk_test_different')
    expect(first).toBe(second)
  })

  it('resolvePriceId() calls Stripe prices.list with correct params', async () => {
    const { stripeClient } = await import('../stripe-client')
    const client = stripeClient.initialize('sk_test_123')
    const listMock = client.prices.list as ReturnType<typeof vi.fn>
    listMock.mockResolvedValueOnce({ data: [{ id: 'price_resolved' }] })

    const result = await stripeClient.resolvePriceId('pro_monthly')

    expect(listMock).toHaveBeenCalledWith({
      lookup_keys: ['pro_monthly'],
      active: true,
      limit: 1,
    })
    expect(result).toBe('price_resolved')
  })

  it('resolvePriceId() returns undefined when no price found', async () => {
    const { stripeClient } = await import('../stripe-client')
    const client = stripeClient.initialize('sk_test_123')
    const listMock = client.prices.list as ReturnType<typeof vi.fn>
    listMock.mockResolvedValueOnce({ data: [] })

    const result = await stripeClient.resolvePriceId('nonexistent_key')
    expect(result).toBeUndefined()
  })
})
