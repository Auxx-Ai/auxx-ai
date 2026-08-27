// packages/lib/src/postings/__tests__/periods.test.ts

import { describe, expect, it } from 'vitest'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import {
  assertPeriodOpen,
  compareMonths,
  isPeriodLocked,
  parsePeriodKey,
  periodKeyForDate,
  periodMonth,
} from '../periods'

describe('periodKeyForDate', () => {
  it('derives a day key in UTC by default', () => {
    expect(periodKeyForDate(new Date('2026-08-18T13:45:00Z'))).toBe('2026-08-18')
  })

  it('derives a month key', () => {
    expect(periodKeyForDate(new Date('2026-08-18T13:45:00Z'), 'month')).toBe('2026-08')
  })

  it('zero-pads single-digit months and days', () => {
    expect(periodKeyForDate(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05')
    expect(periodKeyForDate(new Date('2026-01-05T00:00:00Z'), 'month')).toBe('2026-01')
  })

  it('respects the book timezone at a month boundary', () => {
    // 2026-02-01T02:00Z is still 2026-01-31 in New York. Deriving in UTC would
    // post a January receipt into February - invisible until a close, and
    // uncorrectable once January is locked.
    const instant = new Date('2026-02-01T02:00:00Z')
    expect(periodKeyForDate(instant, 'day', 'UTC')).toBe('2026-02-01')
    expect(periodKeyForDate(instant, 'day', 'America/New_York')).toBe('2026-01-31')
    expect(periodKeyForDate(instant, 'month', 'America/New_York')).toBe('2026-01')
  })

  it('respects a timezone ahead of UTC', () => {
    const instant = new Date('2026-01-31T22:00:00Z')
    expect(periodKeyForDate(instant, 'day', 'Asia/Tokyo')).toBe('2026-02-01')
    expect(periodKeyForDate(instant, 'month', 'Asia/Tokyo')).toBe('2026-02')
  })

  it('is DST-correct rather than offset arithmetic', () => {
    // 2026-03-08 is the US spring-forward date; 06:30Z is 01:30 EST, still the 8th.
    expect(periodKeyForDate(new Date('2026-03-08T06:30:00Z'), 'day', 'America/New_York')).toBe(
      '2026-03-08'
    )
  })

  it('rejects an invalid date', () => {
    expect(() => periodKeyForDate(new Date('nonsense'))).toThrow(BadRequestError)
  })
})

describe('parsePeriodKey', () => {
  it('parses a day key', () => {
    expect(parsePeriodKey('2026-08-18')).toEqual({
      granularity: 'day',
      year: 2026,
      month: 8,
      day: 18,
    })
  })

  it('parses a month key', () => {
    expect(parsePeriodKey('2026-08')).toEqual({ granularity: 'month', year: 2026, month: 8 })
  })

  it('accepts a leap day', () => {
    expect(parsePeriodKey('2028-02-29').day).toBe(29)
  })

  it('rejects a non-leap February 29', () => {
    expect(() => parsePeriodKey('2026-02-29')).toThrow(/not a real date/)
  })

  it('rejects an overflowing day', () => {
    expect(() => parsePeriodKey('2026-04-31')).toThrow(/not a real date/)
    expect(() => parsePeriodKey('2026-08-32')).toThrow(BadRequestError)
  })

  it('rejects a month outside 1-12', () => {
    expect(() => parsePeriodKey('2026-13')).toThrow(/month 13 is not 1-12/)
    expect(() => parsePeriodKey('2026-00')).toThrow(/is not 1-12/)
  })

  it('rejects an unpadded key', () => {
    expect(() => parsePeriodKey('2026-8')).toThrow(BadRequestError)
    expect(() => parsePeriodKey('2026-8-18')).toThrow(BadRequestError)
  })

  it('rejects junk and empty input', () => {
    expect(() => parsePeriodKey('')).toThrow(BadRequestError)
    expect(() => parsePeriodKey('august')).toThrow(BadRequestError)
    expect(() => parsePeriodKey('2026-08-18T00:00:00Z')).toThrow(BadRequestError)
  })
})

describe('periodMonth', () => {
  it('reduces a day key to its month', () => {
    expect(periodMonth('2026-08-18')).toBe('2026-08')
  })

  it('leaves a month key alone', () => {
    expect(periodMonth('2026-08')).toBe('2026-08')
  })

  it('keeps the padding that makes lexical ordering calendar ordering', () => {
    expect(periodMonth('2026-01-05')).toBe('2026-01')
  })
})

describe('compareMonths', () => {
  it('orders months lexically, which is calendar order for YYYY-MM', () => {
    expect(compareMonths('2026-01', '2026-02')).toBeLessThan(0)
    expect(compareMonths('2026-12', '2027-01')).toBeLessThan(0)
    expect(compareMonths('2026-09', '2026-10')).toBeLessThan(0)
    expect(compareMonths('2026-08', '2026-08')).toBe(0)
    expect(compareMonths('2027-01', '2026-12')).toBeGreaterThan(0)
  })
})

describe('isPeriodLocked', () => {
  it('is open when nothing is closed yet', () => {
    expect(isPeriodLocked('2026-08-18', { lockedThroughMonth: null })).toBe(false)
  })

  it('locks a month at or before the close', () => {
    const lock = { lockedThroughMonth: '2026-07' }
    expect(isPeriodLocked('2026-06-30', lock)).toBe(true)
    expect(isPeriodLocked('2026-07', lock)).toBe(true)
    expect(isPeriodLocked('2026-07-31', lock)).toBe(true)
  })

  it('leaves every later month open', () => {
    const lock = { lockedThroughMonth: '2026-07' }
    expect(isPeriodLocked('2026-08-01', lock)).toBe(false)
    expect(isPeriodLocked('2026-08', lock)).toBe(false)
    expect(isPeriodLocked('2027-01-01', lock)).toBe(false)
  })

  it('compares by month, so the last day of a closed month is locked and the first day of the next is not', () => {
    expect(isPeriodLocked('2026-12-31', { lockedThroughMonth: '2026-12' })).toBe(true)
    expect(isPeriodLocked('2027-01-01', { lockedThroughMonth: '2026-12' })).toBe(false)
  })

  it('rejects a malformed period key rather than treating it as open', () => {
    expect(() => isPeriodLocked('2026-8-1', { lockedThroughMonth: '2026-07' })).toThrow(
      BadRequestError
    )
  })
})

describe('assertPeriodOpen', () => {
  it('passes for an open period', () => {
    expect(() => assertPeriodOpen('2026-08-18', { lockedThroughMonth: '2026-07' })).not.toThrow()
  })

  it('throws UnprocessableEntityError for a closed period', () => {
    expect(() => assertPeriodOpen('2026-07-15', { lockedThroughMonth: '2026-07' })).toThrow(
      UnprocessableEntityError
    )
  })

  it('names both the period and the close in the message', () => {
    expect(() => assertPeriodOpen('2026-06-15', { lockedThroughMonth: '2026-07' })).toThrow(
      /2026-06 is closed through 2026-07/
    )
  })

  it('maps to HTTP 422', () => {
    try {
      assertPeriodOpen('2026-06-15', { lockedThroughMonth: '2026-07' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as UnprocessableEntityError).statusCode).toBe(422)
    }
  })
})
