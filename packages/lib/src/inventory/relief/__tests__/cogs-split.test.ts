// packages/lib/src/inventory/relief/__tests__/cogs-split.test.ts

import { describe, expect, it } from 'vitest'
import type { PartStandardCost } from '../../costing/types'
import { splitReliefCost } from '../cogs-split'

function standard(overrides: Partial<PartStandardCost>): PartStandardCost {
  return {
    partId: 'part_1',
    standardMaterialCost: 0,
    standardLaborCost: null,
    standardOverheadCost: null,
    standardCost: 0,
    effectiveAt: null,
    ...overrides,
  }
}

describe('splitReliefCost', () => {
  it('splits labour and overhead off, material is the remainder', () => {
    const split = splitReliefCost(
      standard({
        standardMaterialCost: 1_500,
        standardLaborCost: 300,
        standardOverheadCost: 200,
        standardCost: 2_000,
      }),
      4_000,
      2
    )
    expect(split).toEqual({ materialMinor: 3_000, laborMinor: 600, overheadMinor: 400 })
  })

  it('splits a $0 standard into three zeros, not NaN (103 §5a)', () => {
    const split = splitReliefCost(standard({ standardLaborCost: 0, standardOverheadCost: 0 }), 0, 3)
    expect(split).toEqual({ materialMinor: 0, laborMinor: 0, overheadMinor: 0 })
  })

  it('splits a $0 standard un-relief (negative units) into zeros too', () => {
    const split = splitReliefCost(standard({}), 0, -2)
    expect(Object.values(split).every((value) => value === 0)).toBe(true)
  })
})
