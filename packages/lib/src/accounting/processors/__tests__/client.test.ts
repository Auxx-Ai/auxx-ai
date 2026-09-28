// packages/lib/src/accounting/processors/__tests__/client.test.ts

import { describe, expect, it } from 'vitest'
import { FEED_APPS, feedAppForHandles, processorByHandle, processorByProviderKey } from '../client'

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
