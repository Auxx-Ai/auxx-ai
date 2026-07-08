// apps/web/src/components/dashboard/lib/format-value.test.ts

import { describe, expect, it } from 'vitest'
import { computeTrendDelta, formatMetricValue, formatTrendPercent } from './format-value'

describe('formatMetricValue', () => {
  it('renders count ops as grouped integers', () => {
    expect(formatMetricValue(1234, 'count')).toBe('1,234')
    expect(formatMetricValue(42, 'countUnique')).toBe('42')
  })

  it('appends % for percent ops without multiplying', () => {
    expect(formatMetricValue(42.5, 'percentNotEmpty')).toBe('42.5%')
  })

  it('formats a CURRENCY metric from cents via field options', () => {
    expect(
      formatMetricValue(123456, 'sum', { fieldType: 'CURRENCY', options: { currencyCode: 'USD' } })
    ).toBe('$1,234.56')
  })

  it('formats a NUMBER metric honoring the field decimals', () => {
    expect(
      formatMetricValue(1234.5, 'sum', { fieldType: 'NUMBER', options: { decimals: 1 } })
    ).toBe('1,234.5')
  })

  it('falls back to a plain grouped number without field metadata', () => {
    expect(formatMetricValue(1234.5, 'sum')).toBe('1,234.5')
  })

  it('renders a dash for non-finite values', () => {
    expect(formatMetricValue(Number.NaN, 'sum')).toBe('—')
  })
})

describe('computeTrendDelta', () => {
  it('returns null when there is no previous value', () => {
    expect(computeTrendDelta(10, undefined)).toBeNull()
  })

  it('computes an upward delta', () => {
    expect(computeTrendDelta(120, 100)).toEqual({ change: 20, percent: 20, direction: 'up' })
  })

  it('computes a downward delta against the previous magnitude', () => {
    expect(computeTrendDelta(80, 100)).toEqual({ change: -20, percent: -20, direction: 'down' })
  })

  it('flags an undefined ratio (null percent) when the previous value is 0', () => {
    expect(computeTrendDelta(5, 0)).toEqual({ change: 5, percent: null, direction: 'up' })
  })

  it('reports a flat direction on no change', () => {
    expect(computeTrendDelta(50, 50)).toEqual({ change: 0, percent: 0, direction: 'flat' })
  })
})

describe('formatTrendPercent', () => {
  it('shows a signed percent', () => {
    expect(formatTrendPercent(12.3)).toBe('+12.3%')
    expect(formatTrendPercent(-4)).toBe('-4%')
  })

  it('renders a dash for a null (undefined) ratio', () => {
    expect(formatTrendPercent(null)).toBe('—')
  })
})
