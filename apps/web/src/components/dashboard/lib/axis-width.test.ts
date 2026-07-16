// apps/web/src/components/dashboard/lib/axis-width.test.ts

import { describe, expect, it } from 'vitest'
import { ceilToSignificant, numericTickLabels } from './axis-width'

describe('ceilToSignificant', () => {
  it('rounds up to the requested significant digits', () => {
    expect(ceilToSignificant(11800, 2)).toBe(12000)
    expect(ceilToSignificant(11800, 1)).toBe(20000)
    expect(ceilToSignificant(987, 2)).toBe(990)
    expect(ceilToSignificant(2_300_000, 1)).toBe(3_000_000)
  })

  it('preserves sign and handles zero / non-finite', () => {
    expect(ceilToSignificant(-11800, 2)).toBe(-12000)
    expect(ceilToSignificant(0, 2)).toBe(0)
    expect(ceilToSignificant(Number.NaN, 2)).toBe(0)
  })
})

describe('numericTickLabels', () => {
  const fmt = (n: number) => `$${n}`

  it('bounds the widest tick: 0, extremes, and their nice ceilings', () => {
    expect(new Set(numericTickLabels(0, 11800, fmt))).toEqual(
      new Set(['$0', '$11800', '$12000', '$20000'])
    )
  })

  it('covers negative extents too', () => {
    expect(numericTickLabels(-950, 100, fmt)).toEqual(
      expect.arrayContaining(['$0', '$-950', '$-1000', '$100'])
    )
  })

  it('collapses to just 0 for an empty extent', () => {
    expect(numericTickLabels(0, 0, fmt)).toEqual(['$0'])
  })
})
