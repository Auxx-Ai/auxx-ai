// packages/lib/src/dashboards/date-bucket-labels.test.ts

import { describe, expect, it } from 'vitest'
import { formatBucketLabel, resolveDefaultDateLabelFormat } from './date-bucket-labels'

describe('formatBucketLabel — default (undefined format) reproduces server labels', () => {
  it('matches the historical output per granularity', () => {
    expect(formatBucketLabel('2026-07-01', 'month')).toBe('2026-07')
    expect(formatBucketLabel('2026-06-29', 'week')).toBe('W27 2026')
    expect(formatBucketLabel('2026-07-01', 'quarter')).toBe('Q3 2026')
    expect(formatBucketLabel('2026-01-01', 'year')).toBe('2026')
    expect(formatBucketLabel('2026-07-04', 'day')).toBe('Jul 4, 2026')
    expect(formatBucketLabel('1', 'dayOfWeek')).toBe('Mon')
    expect(formatBucketLabel('7', 'monthOfYear')).toBe('Jul')
  })
})

describe('formatBucketLabel — explicit styles', () => {
  it('month: short / long / iso', () => {
    expect(formatBucketLabel('2026-07-01', 'month', 'short')).toBe('Jul 2026')
    expect(formatBucketLabel('2026-07-01', 'month', 'long')).toBe('July 2026')
    expect(formatBucketLabel('2026-07-01', 'month', 'iso')).toBe('2026-07')
  })

  it('day: short / long / iso', () => {
    expect(formatBucketLabel('2026-07-04', 'day', 'short')).toBe('Jul 4')
    expect(formatBucketLabel('2026-07-04', 'day', 'long')).toBe('July 4, 2026')
    expect(formatBucketLabel('2026-07-04', 'day', 'iso')).toBe('2026-07-04')
  })

  it('week: iso pads the week number; long spells it out', () => {
    expect(formatBucketLabel('2026-06-29', 'week', 'iso')).toBe('2026-W27')
    expect(formatBucketLabel('2026-06-29', 'week', 'long')).toBe('Week 27, 2026')
    expect(formatBucketLabel('2026-06-29', 'week', 'short')).toBe('W27 2026')
  })

  it('quarter: iso vs default', () => {
    expect(formatBucketLabel('2026-07-01', 'quarter', 'iso')).toBe('2026-Q3')
    expect(formatBucketLabel('2026-07-01', 'quarter', 'long')).toBe('Q3 2026')
  })

  it('cyclic granularities: long spells out the name', () => {
    expect(formatBucketLabel('1', 'dayOfWeek', 'long')).toBe('Monday')
    expect(formatBucketLabel('7', 'dayOfWeek', 'long')).toBe('Sunday')
    expect(formatBucketLabel('7', 'monthOfYear', 'long')).toBe('July')
    expect(formatBucketLabel('3', 'monthOfYear', 'short')).toBe('Mar')
  })

  it('year ignores style (always yyyy)', () => {
    expect(formatBucketLabel('2026-01-01', 'year', 'long')).toBe('2026')
    expect(formatBucketLabel('2026-01-01', 'year', 'iso')).toBe('2026')
  })

  it('malformed calendar key falls back to the raw key', () => {
    expect(formatBucketLabel('not-a-date', 'month', 'long')).toBe('not-a-date')
  })
})

describe('resolveDefaultDateLabelFormat', () => {
  it("drops the year ('short') when all day buckets share one calendar year", () => {
    expect(resolveDefaultDateLabelFormat(['2026-07-10', '2026-07-11', '2026-12-31'], 'day')).toBe(
      'short'
    )
  })

  it('keeps the default across a year boundary', () => {
    expect(resolveDefaultDateLabelFormat(['2025-12-31', '2026-01-01'], 'day')).toBeUndefined()
  })

  it('ignores null (empty-bucket) keys', () => {
    expect(resolveDefaultDateLabelFormat([null, '2026-07-10'], 'day')).toBe('short')
  })

  it('bails on malformed keys, all-null keys, and non-day granularities', () => {
    expect(resolveDefaultDateLabelFormat(['2026-07-10', 'oops'], 'day')).toBeUndefined()
    expect(resolveDefaultDateLabelFormat([null], 'day')).toBeUndefined()
    expect(resolveDefaultDateLabelFormat([], 'day')).toBeUndefined()
    expect(resolveDefaultDateLabelFormat(['2026-07-01'], 'month')).toBeUndefined()
    expect(resolveDefaultDateLabelFormat(['2026-06-29'], 'week')).toBeUndefined()
  })
})
