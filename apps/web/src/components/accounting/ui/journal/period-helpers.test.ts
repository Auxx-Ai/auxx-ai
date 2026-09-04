// apps/web/src/components/accounting/ui/journal/period-helpers.test.ts

import type { ClosePeriod } from '@auxx/lib/postings/client'
import { describe, expect, it } from 'vitest'
import {
  firstDayOfPeriod,
  lastDayOfPeriod,
  nextOpenPeriodAfter,
  periodKeyForEntryDate,
  today,
} from './period-helpers'

function period(overrides: Partial<ClosePeriod>): ClosePeriod {
  return {
    periodKey: '2026-08',
    state: 'open',
    glPostingId: null,
    docNumber: null,
    totalMinor: null,
    postedAt: null,
    revision: 0,
    ...overrides,
  }
}

describe('firstDayOfPeriod', () => {
  it('returns the first calendar day of the month', () => {
    expect(firstDayOfPeriod('2026-08')).toBe('2026-08-01')
    expect(firstDayOfPeriod('2026-01')).toBe('2026-01-01')
  })

  it('passes through a key that is not a month', () => {
    expect(firstDayOfPeriod('not-a-key')).toBe('not-a-key')
  })
})

describe('lastDayOfPeriod', () => {
  it('returns the last calendar day of a 31-day month', () => {
    expect(lastDayOfPeriod('2026-08')).toBe('2026-08-31')
  })

  it('returns the last calendar day of a 30-day month', () => {
    expect(lastDayOfPeriod('2026-04')).toBe('2026-04-30')
  })

  it('handles February in a leap year', () => {
    expect(lastDayOfPeriod('2028-02')).toBe('2028-02-29')
  })

  it('handles February in a non-leap year', () => {
    expect(lastDayOfPeriod('2026-02')).toBe('2026-02-28')
  })

  it('passes through a key that is not a month', () => {
    expect(lastDayOfPeriod('not-a-key')).toBe('not-a-key')
  })
})

describe('nextOpenPeriodAfter', () => {
  const periods: ClosePeriod[] = [
    period({ periodKey: '2026-06', state: 'posted' }),
    period({ periodKey: '2026-07', state: 'locked' }),
    period({ periodKey: '2026-08', state: 'open' }),
    period({ periodKey: '2026-09', state: 'open' }),
  ]

  it('finds the first open period after the given one', () => {
    expect(nextOpenPeriodAfter(periods, '2026-07')?.periodKey).toBe('2026-08')
  })

  it('skips a posted period that is not open', () => {
    expect(nextOpenPeriodAfter(periods, '2026-06')?.periodKey).toBe('2026-08')
  })

  it('falls back to the first open period anywhere when the given key is the newest', () => {
    expect(nextOpenPeriodAfter(periods, '2026-09')?.periodKey).toBe('2026-08')
  })

  it('falls back to the first open period when the given key is not in the list', () => {
    expect(nextOpenPeriodAfter(periods, '2099-01')?.periodKey).toBe('2026-08')
  })

  it('returns null when nothing is open', () => {
    const allClosed = periods.map((p) => ({ ...p, state: 'locked' as const }))
    expect(nextOpenPeriodAfter(allClosed, '2026-06')).toBeNull()
  })
})

describe('today', () => {
  it('returns a YYYY-MM-DD string matching the wall clock in the given zone', () => {
    const value = today('UTC')
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const expected = new Date().toISOString().slice(0, 10)
    expect(value).toBe(expected)
  })

  it('is a valid, non-empty date the router accepts (never the empty string)', () => {
    expect(today('America/Los_Angeles')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('periodKeyForEntryDate', () => {
  it('takes the month straight off the calendar day', () => {
    expect(periodKeyForEntryDate('2026-09-01')).toBe('2026-09')
    expect(periodKeyForEntryDate('2026-12-31')).toBe('2026-12')
    expect(periodKeyForEntryDate('2027-01-01')).toBe('2027-01')
  })

  it('does not shift the month for a viewer or book zone west of UTC', () => {
    // The regression: routing the day through `periodKeyForDate(new
    // Date(day + 'T00:00:00.000Z'), 'month', zone)` formatted it as the
    // previous evening in every zone behind UTC, so the first of the month
    // read as the month before - while the server locks on the raw string.
    const original = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      expect(periodKeyForEntryDate('2026-09-01')).toBe('2026-09')
    } finally {
      process.env.TZ = original
    }
  })

  it('returns null for anything that is not a calendar day', () => {
    expect(periodKeyForEntryDate('')).toBeNull()
    expect(periodKeyForEntryDate('2026-09')).toBeNull()
    expect(periodKeyForEntryDate('not-a-date')).toBeNull()
  })
})
