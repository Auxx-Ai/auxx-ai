// apps/web/src/components/dashboard/lib/format-value.test.ts

import { describe, expect, it } from 'vitest'
import {
  computeTrendDelta,
  formatMetricValue,
  formatMetricValueCompact,
  formatTrendPercent,
} from './format-value'

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

  it('honors a valueFormat override on a count op (compact / decimals)', () => {
    // Plain count is a grouped integer; an override routes it through NUMBER.
    expect(formatMetricValue(1234, 'count')).toBe('1,234')
    expect(formatMetricValue(1234, 'count', { options: { displayAs: 'compact' } })).toBe('1.2K')
    expect(formatMetricValue(1234, 'count', { options: { decimals: 1 } })).toBe('1,234.0')
  })

  it('applies a merged override over a field type (fewer decimals)', () => {
    // `useMetricFieldMeta` merges the override onto field options; here the
    // merged result asks for 0 decimals on a NUMBER metric.
    expect(
      formatMetricValue(1234.56, 'sum', { fieldType: 'NUMBER', options: { decimals: 0 } })
    ).toBe('1,235')
  })
})

describe('formatMetricValueCompact', () => {
  it('compacts count ops', () => {
    expect(formatMetricValueCompact(1234, 'count')).toBe('1.2K')
    expect(formatMetricValueCompact(42, 'countUnique')).toBe('42')
  })

  it('compacts a CURRENCY metric from cents, dropping decimals', () => {
    const meta = { fieldType: 'CURRENCY', options: { currencyCode: 'USD' } } as const
    expect(formatMetricValueCompact(1_200_000, 'sum', meta)).toBe('$12K')
    expect(formatMetricValueCompact(36000, 'sum', meta)).toBe('$360')
    // Contrast: the full formatter keeps grouping + cents.
    expect(formatMetricValue(1_200_000, 'sum', meta)).toBe('$12,000.00')
  })

  it('compacts a NUMBER metric, keeping prefix/suffix', () => {
    expect(formatMetricValueCompact(2_300_000, 'sum', { fieldType: 'NUMBER' })).toBe('2.3M')
    expect(
      formatMetricValueCompact(2_300_000, 'sum', {
        fieldType: 'NUMBER',
        options: { suffix: ' kg' },
      })
    ).toBe('2.3M kg')
  })

  it('delegates already-short display styles to the full formatter', () => {
    expect(formatMetricValueCompact(42.5, 'percentNotEmpty')).toBe('42.5%')
    expect(
      formatMetricValueCompact(45, 'avg', {
        fieldType: 'NUMBER',
        options: { displayAs: 'percentage', decimals: 0 },
      })
    ).toBe('45%')
  })

  it('falls back to a compact plain number without field metadata', () => {
    expect(formatMetricValueCompact(1234.5, 'sum')).toBe('1.2K')
  })

  it('renders a dash for non-finite values', () => {
    expect(formatMetricValueCompact(Number.NaN, 'sum')).toBe('—')
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
