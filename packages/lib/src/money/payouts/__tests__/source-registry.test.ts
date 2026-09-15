// packages/lib/src/money/payouts/__tests__/source-registry.test.ts
//
// The `PayoutSource` registry (brief 27 §4): an unknown id is a refusal that
// names the id, never a silent empty list; registering twice converges rather
// than throwing or accumulating.

import { afterEach, describe, expect, it } from 'vitest'
import { NotFoundError } from '../../../errors'
import type { PayoutSource } from '../source'
import {
  __resetPayoutSourcesForTests,
  getPayoutSource,
  listPayoutSourceIds,
  listPayoutSources,
  registerPayoutSource,
} from '../source-registry'

function source(id: PayoutSource['id'], marker = ''): PayoutSource & { marker: string } {
  return {
    id,
    kind: 'api',
    marker,
    listPayouts: async () => [],
  }
}

afterEach(() => {
  __resetPayoutSourcesForTests()
})

describe('getPayoutSource', () => {
  it('refuses an id nobody registered, naming it', () => {
    const result = getPayoutSource('shopify_payments')

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(NotFoundError)
    expect(error.message).toContain('shopify_payments')
  })

  it('answers a registered source by id', () => {
    const stripe = source('stripe')
    registerPayoutSource(stripe)

    expect(getPayoutSource('stripe')._unsafeUnwrap()).toBe(stripe)
  })
})

describe('registerPayoutSource', () => {
  it('is idempotent: the same id twice is one entry, and the latest wins', () => {
    const second = source('stripe', 'second')
    registerPayoutSource(source('stripe', 'first'))
    registerPayoutSource(second)

    expect(listPayoutSourceIds()).toEqual(['stripe'])
    expect(getPayoutSource('stripe')._unsafeUnwrap()).toBe(second)
  })

  it('lists sources in registration order', () => {
    registerPayoutSource(source('shopify_payments'))
    registerPayoutSource(source('stripe'))

    expect(listPayoutSourceIds()).toEqual(['shopify_payments', 'stripe'])
    expect(listPayoutSources().map((s) => s.id)).toEqual(['shopify_payments', 'stripe'])
  })
})
