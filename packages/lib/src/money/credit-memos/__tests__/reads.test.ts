// packages/lib/src/money/credit-memos/__tests__/reads.test.ts
//
// `orderHadFulfillmentBefore`: brief 55's re-base onto the `fulfillment`
// records. This is the read that decides whether a channel credit memo
// reverses revenue at all (55 §6, "why this function matters") - and
// `writes.test.ts` only ever mocks it away, so it needs its own coverage
// rather than relying on that suite to notice a regression here.

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fulfillments: [] as unknown[],
}))

// The single-order door this function is: one call, no field context of its
// own to fake (`money/fulfillments/reads.ts` owns that).
vi.mock('../../fulfillments/reads', () => ({
  readFulfillmentsForOrder: async () => h.fulfillments,
}))

import type { Database } from '@auxx/database'
import { orderHadFulfillmentBefore } from '../reads'

function fulfillment(shippedAt: string, status = 'success'): unknown {
  return { shippedAt, status }
}

const DB = {} as Database

describe('orderHadFulfillmentBefore', () => {
  it('is true when a live fulfillment shipped before the date', async () => {
    h.fulfillments = [fulfillment('2026-01-02')]
    expect(await orderHadFulfillmentBefore(DB, 'org_1', 'ord_1', '2026-01-14')).toBe(true)
  })

  it('is true when a live fulfillment shipped ON the date', async () => {
    h.fulfillments = [fulfillment('2026-01-14')]
    expect(await orderHadFulfillmentBefore(DB, 'org_1', 'ord_1', '2026-01-14')).toBe(true)
  })

  it('is false when every fulfillment shipped after the date', async () => {
    h.fulfillments = [fulfillment('2026-01-20')]
    expect(await orderHadFulfillmentBefore(DB, 'org_1', 'ord_1', '2026-01-14')).toBe(false)
  })

  it('is false with no fulfillments at all', async () => {
    h.fulfillments = []
    expect(await orderHadFulfillmentBefore(DB, 'org_1', 'ord_1', '2026-01-14')).toBe(false)
  })

  // 🛑 The decision this function has to make that the JSON log never had to:
  // a CANCELLED fulfillment is a real record now, not an absence. A cancelled
  // dispatch never shipped, so it must not count as evidence revenue was ever
  // recognised - exactly what the old connector enforced by never writing a
  // cancelled entry into the log in the first place.
  it('ignores a CANCELLED fulfillment even when it is the only one', async () => {
    h.fulfillments = [fulfillment('2026-01-02', 'cancelled')]
    expect(await orderHadFulfillmentBefore(DB, 'org_1', 'ord_1', '2026-01-14')).toBe(false)
  })

  it('counts a live fulfillment even when an earlier one on the order was cancelled', async () => {
    h.fulfillments = [fulfillment('2026-01-02', 'cancelled'), fulfillment('2026-01-10')]
    expect(await orderHadFulfillmentBefore(DB, 'org_1', 'ord_1', '2026-01-14')).toBe(true)
  })
})
