// apps/web/src/components/money/ui/line-builder/line-values.test.ts
//
// `diffLineValues` is the one line-values function with no schema in its
// signature — it compares two snapshots and is identical for every document.
// The schema-dependent halves (`linePatchToFieldValues`,
// `lineValuesFromSystemValues`) are covered per document type in
// `line-schemas.test.ts`, where the absent-attribute cases actually live.

import { describe, expect, it } from 'vitest'
import { DEFAULT_LINE_VALUES, diffLineValues } from './line-values'

describe('diffLineValues', () => {
  it('returns only changed snapshot values', () => {
    const after = { ...DEFAULT_LINE_VALUES, qty: 3, unit: null, optional: true }
    expect(diffLineValues(DEFAULT_LINE_VALUES, after)).toEqual({
      qty: 3,
      unit: null,
      optional: true,
    })
  })

  it('is empty for an unchanged snapshot', () => {
    expect(diffLineValues(DEFAULT_LINE_VALUES, { ...DEFAULT_LINE_VALUES })).toEqual({})
  })
})
