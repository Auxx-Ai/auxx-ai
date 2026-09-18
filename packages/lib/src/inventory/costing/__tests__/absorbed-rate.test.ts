// packages/lib/src/inventory/costing/__tests__/absorbed-rate.test.ts

import { describe, expect, it } from 'vitest'
import { absorbedRate } from '../client'

describe('absorbedRate - a per-part override at RATE precision', () => {
  it('keeps a sub-cent labour or overhead rate rather than rounding it to a whole cent', () => {
    expect(absorbedRate(33.4254)).toBe(33.425)
  })

  it('stays NULL, never zero, when no rate is declared', () => {
    expect(absorbedRate(null)).toBeNull()
    expect(absorbedRate(undefined)).toBeNull()
    expect(absorbedRate(Number.NaN)).toBeNull()
  })

  it('a stored zero survives as zero, distinct from an absent rate', () => {
    expect(absorbedRate(0)).toBe(0)
  })
})
