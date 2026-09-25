// packages/utils/src/__tests__/stats.test.ts

import { describe, expect, it } from 'vitest'
import { coefficientOfVariation, mean, median, percentile, stddev } from '../stats'

describe('stats', () => {
  it('returns null for an empty list', () => {
    expect(mean([])).toBeNull()
    expect(median([])).toBeNull()
    expect(percentile([], 90)).toBeNull()
    expect(stddev([])).toBeNull()
    expect(coefficientOfVariation([])).toBeNull()
  })

  it('computes the mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
  })

  it('takes the median of odd and even lists regardless of order', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it('interpolates percentiles linearly and clamps p', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(values, 0)).toBe(1)
    expect(percentile(values, 100)).toBe(10)
    expect(percentile(values, 90)).toBeCloseTo(9.1)
    expect(percentile(values, 150)).toBe(10)
    expect(percentile([7], 90)).toBe(7)
  })

  it('uses the population standard deviation', () => {
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2)
    expect(stddev([3, 3, 3])).toBe(0)
  })

  it('computes the coefficient of variation, null at a zero mean', () => {
    expect(coefficientOfVariation([2, 4, 4, 4, 5, 5, 7, 9])).toBe(0.4)
    expect(coefficientOfVariation([0, 0])).toBeNull()
  })
})
