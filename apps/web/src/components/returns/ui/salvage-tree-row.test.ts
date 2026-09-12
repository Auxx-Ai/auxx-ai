// apps/web/src/components/returns/ui/salvage-tree-row.test.ts

import { describe, expect, it } from 'vitest'
import { toSalvageStatus } from './salvage-tree-row'

describe('toSalvageStatus', () => {
  it('unwraps the array a single select emits', () => {
    // `SelectFieldInput` hands the picker's `string[]` through unchanged, so a
    // parser that compares the array to an option value matches nothing and
    // the selector silently writes nothing.
    expect(toSalvageStatus(['good'])).toBe('good')
    expect(toSalvageStatus(['scrap'])).toBe('scrap')
  })

  it('accepts a bare value too', () => {
    expect(toSalvageStatus('damaged')).toBe('damaged')
  })

  it('refuses anything that is not a status', () => {
    expect(toSalvageStatus([])).toBeNull()
    expect(toSalvageStatus('bogus')).toBeNull()
    expect(toSalvageStatus(['bogus'])).toBeNull()
    expect(toSalvageStatus(undefined)).toBeNull()
  })
})
