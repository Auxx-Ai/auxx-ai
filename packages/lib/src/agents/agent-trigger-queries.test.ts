// packages/lib/src/agents/agent-trigger-queries.test.ts

import { describe, expect, it } from 'vitest'
import { matchesFilter } from './agent-trigger-queries'

describe('matchesFilter', () => {
  it('matches when the filter is empty or absent', () => {
    expect(matchesFilter(undefined, { topic: 'orders/create' })).toBe(true)
    expect(matchesFilter({}, { topic: 'orders/create' })).toBe(true)
  })

  it('exact-matches a scalar value', () => {
    expect(matchesFilter({ topic: 'orders/create' }, { topic: 'orders/create' })).toBe(true)
    expect(matchesFilter({ topic: 'orders/create' }, { topic: 'orders/paid' })).toBe(false)
  })

  it('matches membership with an { in: [...] } operator', () => {
    const filter = { topic: { in: ['orders/create', 'orders/paid'] } }
    expect(matchesFilter(filter, { topic: 'orders/paid' })).toBe(true)
    expect(matchesFilter(filter, { topic: 'products/update' })).toBe(false)
  })

  it('requires every key to match', () => {
    const filter = { topic: { in: ['orders/create'] }, source: 'webhook' }
    expect(matchesFilter(filter, { topic: 'orders/create', source: 'webhook' })).toBe(true)
    expect(matchesFilter(filter, { topic: 'orders/create', source: 'poll' })).toBe(false)
  })

  it('returns false when the payload is missing', () => {
    expect(matchesFilter({ topic: 'orders/create' }, null)).toBe(false)
  })
})
