// packages/lib/src/accounting/processors/__tests__/client.test.ts

import { describe, expect, it } from 'vitest'
import {
  FEED_APPS,
  feedAppForHandles,
  processorByHandle,
  processorByProviderKey,
  providerPayoutState,
} from '../client'

describe('feedAppForHandles', () => {
  it('reads all three Authorize.Net spellings as the authorize-net app', () => {
    for (const handle of ['authorize_net', 'authorize.net', 'authorizenet', ' Authorize.Net ']) {
      expect(feedAppForHandles([handle])).toBe('authorize-net')
    }
  })

  it('puts Shop Pay Installments on the Shopify app', () => {
    expect(feedAppForHandles(['shop_pay_installments'])).toBe('shopify')
  })

  it('answers null for an unknown handle, and for Stripe Connect', () => {
    expect(feedAppForHandles(['some_new_gateway'])).toBeNull()
    expect(feedAppForHandles(['stripe'])).toBeNull()
    expect(feedAppForHandles([])).toBeNull()
  })

  it('takes the first handle, in order, whose processor has an app', () => {
    expect(feedAppForHandles(['paypal', 'stripe', 'Affirm', 'shopify_payments'])).toBe('affirm')
  })
})

describe('lookups', () => {
  it('finds a processor by provider key and by any handle spelling', () => {
    expect(processorByProviderKey('authorize_net')?.railName).toBe('Authorize.Net')
    expect(processorByProviderKey('shopify')).toBeNull()
    expect(processorByHandle('SHOP_CASH')?.id).toBe('shopify_payments')
    expect(processorByHandle('paypal')).toBeNull()
  })

  it('collects the feed apps', () => {
    expect([...FEED_APPS].sort()).toEqual(['affirm', 'authorize-net', 'shopify'])
  })
})

describe('providerPayoutState', () => {
  it.each([
    ['shopify_payments', 'paid', 'paid'],
    ['shopify_payments', 'scheduled', 'in_transit'],
    ['shopify_payments', 'in_transit', 'in_transit'],
    ['shopify_payments', 'failed', 'negative'],
    ['shopify_payments', 'canceled', 'negative'],
    ['shopify_payments', 'something_new', 'in_transit'],
    ['affirm', 'paid', 'paid'],
    ['affirm', 'failed', 'negative'],
    ['affirm', 'rejected', 'negative'],
    ['affirm', 'some_future_removal', 'negative'],
    ['authorize_net', 'settledSuccessfully', 'paid'],
    ['authorize_net', 'pendingSettlement', 'in_transit'],
    ['authorize_net', 'settlementError', 'negative'],
    ['authorize_net', 'somethingElse', 'in_transit'],
    ['stripe', 'paid', 'paid'],
    ['paypal', 'paid', 'in_transit'],
  ] as const)('%s %s reads as %s', (providerKey, status, state) => {
    expect(providerPayoutState(providerKey, status)).toBe(state)
  })

  it('reads an empty status and an inherited key as in transit', () => {
    expect(providerPayoutState('affirm', null)).toBe('in_transit')
    expect(providerPayoutState('affirm', '')).toBe('in_transit')
    expect(providerPayoutState('shopify_payments', 'constructor')).toBe('in_transit')
  })
})
