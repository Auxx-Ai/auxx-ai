// apps/web/src/components/manufacturing/parts/part-form-sections.test.ts

import { describe, expect, it } from 'vitest'
import { displayedSellable, partFormSections } from './part-form-sections'

describe('partFormSections', () => {
  it('drops every stock-only section for a service', () => {
    expect(partFormSections('service')).toEqual({
      product: false,
      hsCode: false,
      supplier: false,
      openingStock: false,
    })
  })

  it('keeps them for stocked kinds and an unset kind', () => {
    for (const kind of ['component', 'subassembly', 'finished_good', '']) {
      expect(Object.values(partFormSections(kind)).every(Boolean)).toBe(true)
    }
  })
})

describe('displayedSellable', () => {
  it('shows the kind default until touched', () => {
    expect(displayedSellable('service', null)).toBe(true)
    expect(displayedSellable('finished_good', null)).toBe(true)
    expect(displayedSellable('component', null)).toBe(false)
    expect(displayedSellable('', null)).toBe(false)
  })

  it('shows the touched value over the default', () => {
    expect(displayedSellable('service', false)).toBe(false)
    expect(displayedSellable('component', true)).toBe(true)
  })
})
