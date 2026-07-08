// packages/lib/src/resources/aggregate/date-buckets.test.ts

import { describe, expect, it } from 'vitest'
import {
  bucketRange,
  enumerateBuckets,
  formatBucketLabel,
  isCyclicGranularity,
} from './date-buckets'

const NY = 'America/New_York'

describe('bucketRange', () => {
  it('covers a plain UTC day', () => {
    const range = bucketRange('2026-07-01', 'day', 'UTC')
    expect(range?.from.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(range?.to.toISOString()).toBe('2026-07-02T00:00:00.000Z')
  })

  it('handles the DST spring-forward day (23 local hours) in New York', () => {
    // 2026-03-08 is the US spring-forward date: EST (UTC-5) → EDT (UTC-4).
    const range = bucketRange('2026-03-08', 'day', NY)
    expect(range?.from.toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(range?.to.toISOString()).toBe('2026-03-09T04:00:00.000Z')
  })

  it('covers a month in a non-UTC timezone', () => {
    const range = bucketRange('2026-07-01', 'month', NY)
    expect(range?.from.toISOString()).toBe('2026-07-01T04:00:00.000Z')
    expect(range?.to.toISOString()).toBe('2026-08-01T04:00:00.000Z')
  })

  it('returns undefined for cyclic granularities and malformed keys', () => {
    expect(bucketRange('3', 'dayOfWeek', 'UTC')).toBeUndefined()
    expect(bucketRange('7', 'monthOfYear', 'UTC')).toBeUndefined()
    expect(bucketRange('not-a-date', 'day', 'UTC')).toBeUndefined()
  })
})

describe('enumerateBuckets', () => {
  it('enumerates days across a DST boundary without skipping or doubling', () => {
    // [Mar 7 local midnight NY, Mar 10 local midnight NY)
    const from = new Date('2026-03-07T05:00:00.000Z')
    const to = new Date('2026-03-10T04:00:00.000Z')
    expect(enumerateBuckets(from, to, 'day', NY)).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ])
  })

  it('enumerates months', () => {
    const from = new Date('2026-01-15T00:00:00.000Z')
    const to = new Date('2026-04-01T00:00:00.000Z')
    expect(enumerateBuckets(from, to, 'month', 'UTC')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])
  })

  it('enumerates ISO weeks starting Monday', () => {
    // Wed Jul 1 2026 → truncates to Mon Jun 29
    const from = new Date('2026-07-01T00:00:00.000Z')
    const to = new Date('2026-07-14T00:00:00.000Z')
    expect(enumerateBuckets(from, to, 'week', 'UTC')).toEqual([
      '2026-06-29',
      '2026-07-06',
      '2026-07-13',
    ])
  })

  it('always yields the full cyclic key space', () => {
    const anyDate = new Date('2026-07-01T00:00:00.000Z')
    expect(enumerateBuckets(anyDate, anyDate, 'dayOfWeek', 'UTC')).toHaveLength(7)
    expect(enumerateBuckets(anyDate, anyDate, 'monthOfYear', 'UTC')).toHaveLength(12)
  })
})

describe('formatBucketLabel', () => {
  it('formats calendar buckets', () => {
    expect(formatBucketLabel('2026-07-01', 'month')).toBe('2026-07')
    expect(formatBucketLabel('2026-06-29', 'week')).toBe('W27 2026')
    expect(formatBucketLabel('2026-07-01', 'quarter')).toBe('Q3 2026')
    expect(formatBucketLabel('2026-01-01', 'year')).toBe('2026')
    expect(formatBucketLabel('2026-07-04', 'day')).toBe('Jul 4, 2026')
  })

  it('formats cyclic buckets', () => {
    expect(formatBucketLabel('1', 'dayOfWeek')).toBe('Mon')
    expect(formatBucketLabel('7', 'dayOfWeek')).toBe('Sun')
    expect(formatBucketLabel('7', 'monthOfYear')).toBe('Jul')
  })
})

describe('isCyclicGranularity', () => {
  it('flags only dayOfWeek and monthOfYear', () => {
    expect(isCyclicGranularity('dayOfWeek')).toBe(true)
    expect(isCyclicGranularity('monthOfYear')).toBe(true)
    expect(isCyclicGranularity('day')).toBe(false)
    expect(isCyclicGranularity('month')).toBe(false)
  })
})
