// apps/web/src/components/data-connectors/lib/describe-steering.test.ts

import { describe, expect, it } from 'vitest'
import { describeSteering } from './describe-steering'

describe('describeSteering', () => {
  it('renders filter + paths + debounce (the full Shopify shape)', () => {
    expect(
      describeSteering({
        filter: { topic: 'inventory_levels/update' },
        paths: ['resourceId'],
        debounceMs: 10_000,
      })
    ).toBe('topic = inventory_levels/update · re-fetches by resourceId · 10s debounce')
  })

  it('renders "all deliveries" when there is no filter', () => {
    expect(describeSteering({ paths: ['id'], debounceMs: 500 })).toBe(
      'all deliveries · re-fetches by id · 500ms debounce'
    )
  })

  it('surfaces empty paths as a full sync per delivery (the dangerous shape)', () => {
    expect(describeSteering({ filter: { topic: 'orders/create' }, paths: [] })).toBe(
      'topic = orders/create · full sync per delivery'
    )
  })

  it('omits the debounce segment when unset or zero', () => {
    expect(describeSteering({ filter: { topic: 'a', kind: 'b' }, paths: ['x', 'y'] })).toBe(
      'topic = a, kind = b · re-fetches by x, y'
    )
    expect(describeSteering({ paths: ['x'], debounceMs: 0 })).toBe(
      'all deliveries · re-fetches by x'
    )
  })
})
