// packages/lib/src/money/fulfillments/__tests__/client.test.ts

import { describe, expect, it } from 'vitest'
import { defaultFulfillmentName, isLiveFulfillment } from '../client'

describe('defaultFulfillmentName', () => {
  it('keys the name on the order number and the sequence', () => {
    expect(defaultFulfillmentName('ORD-0012', 1)).toBe('ORD-0012-F1')
    expect(defaultFulfillmentName('ORD-0012', 2)).toBe('ORD-0012-F2')
  })

  it('never returns empty when the order has no number yet', () => {
    // A display field is not optional (registry field's own docblock) - a
    // native order without a number still needs a nameable fulfillment.
    expect(defaultFulfillmentName(null, 3)).toBe('Shipment 3')
  })
})

describe('isLiveFulfillment', () => {
  it('is true for everything but cancelled', () => {
    expect(isLiveFulfillment({ status: 'pending' })).toBe(true)
    expect(isLiveFulfillment({ status: 'open' })).toBe(true)
    expect(isLiveFulfillment({ status: 'success' })).toBe(true)
    expect(isLiveFulfillment({ status: 'error' })).toBe(true)
    expect(isLiveFulfillment({ status: 'failure' })).toBe(true)
  })

  it('is false for cancelled', () => {
    expect(isLiveFulfillment({ status: 'cancelled' })).toBe(false)
  })
})
