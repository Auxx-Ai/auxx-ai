// packages/utils/src/__tests__/rounding.test.ts

import { describe, expect, it } from 'vitest'
import { ceilToMultiple } from '../rounding'

describe('ceilToMultiple', () => {
  it('rounds up to the next multiple', () => {
    expect(ceilToMultiple(52, 20)).toBe(60)
    expect(ceilToMultiple(60, 20)).toBe(60)
    expect(ceilToMultiple(1, 12)).toBe(12)
  })

  it('does not overshoot on float noise', () => {
    expect(ceilToMultiple(0.3, 0.1)).toBe(0.3)
    expect(ceilToMultiple(0.7, 0.1)).toBe(0.7)
  })

  it('returns q unchanged for a non-positive or non-finite multiple', () => {
    expect(ceilToMultiple(52, 0)).toBe(52)
    expect(ceilToMultiple(52, -5)).toBe(52)
    expect(ceilToMultiple(52, Number.NaN)).toBe(52)
    expect(ceilToMultiple(52, Number.POSITIVE_INFINITY)).toBe(52)
  })

  it('leaves zero at zero', () => {
    expect(ceilToMultiple(0, 20)).toBe(0)
  })
})
