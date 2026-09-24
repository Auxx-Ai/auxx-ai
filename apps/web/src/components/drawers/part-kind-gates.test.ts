// apps/web/src/components/drawers/part-kind-gates.test.ts

import { describe, expect, it } from 'vitest'
import { isHiddenForPartKind, isServiceKind } from './part-kind-gates'

describe('isServiceKind', () => {
  it('reads a plain or array-wrapped service', () => {
    expect(isServiceKind('service')).toBe(true)
    expect(isServiceKind(['service'])).toBe(true)
  })

  it('treats every stocked kind and an unset kind as not a service', () => {
    for (const kind of ['component', 'subassembly', 'finished_good', null, undefined, []]) {
      expect(isServiceKind(kind)).toBe(false)
    }
  })
})

describe('isHiddenForPartKind', () => {
  it('hides the stock surfaces for a service', () => {
    for (const id of ['inventory', 'costing', 'subparts', 'vendors']) {
      expect(isHiddenForPartKind(id, 'service')).toBe(true)
    }
  })

  it('keeps pricing, family and base tabs for a service', () => {
    for (const id of ['pricing', 'family', 'timeline', 'tasks', 'overview']) {
      expect(isHiddenForPartKind(id, 'service')).toBe(false)
    }
  })

  it('hides nothing for a stocked or unloaded kind', () => {
    expect(isHiddenForPartKind('inventory', 'finished_good')).toBe(false)
    expect(isHiddenForPartKind('subparts', undefined)).toBe(false)
  })
})
