// packages/lib/src/data-migrations/migrations/__tests__/190-parts-and-services.test.ts

import { describe, expect, it } from 'vitest'
import { partLabelPatch, withServiceOption } from '../190-parts-and-services'

describe('migration 190 — part kind `service`', () => {
  const stored = [
    { value: 'component', label: 'Component', color: 'gray' },
    { value: 'finished_good', label: 'Finished Good', color: 'green' },
  ]

  it('appends the service option, keeping every stored option as it was', () => {
    expect(withServiceOption(stored)).toEqual([
      ...stored,
      { value: 'service', label: 'Service', color: 'purple' },
    ])
  })

  it('is a no-op once the option is there', () => {
    expect(withServiceOption([...stored, { value: 'service', label: 'Svc' }])).toBeNull()
  })
})

describe('migration 190 — the part def labels', () => {
  it('relabels the seeded defaults', () => {
    expect(partLabelPatch({ singular: 'Part', plural: 'Parts' })).toEqual({
      singular: 'Item',
      plural: 'Parts & Services',
    })
  })

  it('is a no-op once relabelled, and keeps a label an org chose itself', () => {
    expect(partLabelPatch({ singular: 'Item', plural: 'Parts & Services' })).toBeNull()
    expect(partLabelPatch({ singular: 'SKU', plural: 'Parts' })).toEqual({
      plural: 'Parts & Services',
    })
  })
})
