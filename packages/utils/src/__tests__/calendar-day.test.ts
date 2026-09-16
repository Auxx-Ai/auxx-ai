// packages/utils/src/__tests__/calendar-day.test.ts

import { describe, expect, it } from 'vitest'
import {
  addDaysToDayKey,
  addMonthsToDayKey,
  dayKeyInZone,
  dayKeyOfLocalDate,
  daysBetween,
  endOfMonthDay,
  localDateOfDayKey,
  monthKeyOfDay,
  monthsBetween,
  previousDayKey,
  shiftMonthKey,
  startOfDayInstant,
  startOfMonthDay,
  startOfMonthInstant,
  todayInZone,
} from '../calendar-day'

describe('calendar arithmetic', () => {
  it('reads a day key as its month', () => {
    expect(monthKeyOfDay('2026-08-31')).toBe('2026-08')
    expect(startOfMonthDay('2026-08-17')).toBe('2026-08-01')
  })

  it('ends a month on its real last day', () => {
    expect(endOfMonthDay('2026-02')).toBe('2026-02-28')
    expect(endOfMonthDay('2024-02')).toBe('2024-02-29')
    expect(endOfMonthDay('2026-09-16')).toBe('2026-09-30')
  })

  it('shifts month keys across a year boundary in both directions', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12')
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01')
    expect(shiftMonthKey('2026-03', -12)).toBe('2025-03')
  })

  it('counts whole months between two keys', () => {
    expect(monthsBetween('2026-01', '2026-03')).toBe(2)
    expect(monthsBetween('2026-01-01', '2026-03-31')).toBe(2)
    expect(monthsBetween('2026-01', '2025-12')).toBe(-1)
  })

  // 🛑 The reason this module exists: Date.UTC(2026, 1, 31) rolls to March 3.
  it('clamps a month shift to the target month rather than rolling over', () => {
    expect(addMonthsToDayKey('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonthsToDayKey('2024-03-31', -1)).toBe('2024-02-29')
    expect(addMonthsToDayKey('2026-05-31', -1)).toBe('2026-04-30')
    expect(addMonthsToDayKey('2026-01-31', -1)).toBe('2025-12-31')
  })

  it('keeps the day of the month when the target month is long enough', () => {
    expect(addMonthsToDayKey('2026-09-16', -1)).toBe('2026-08-16')
    expect(addMonthsToDayKey('2026-09-16', -12)).toBe('2025-09-16')
    expect(addMonthsToDayKey('2024-02-29', -12)).toBe('2023-02-28')
  })

  it('passes a day that is not on the calendar through unchanged', () => {
    expect(addMonthsToDayKey('2026-02-29', -1)).toBe('2026-02-29')
    expect(addDaysToDayKey('not-a-day', 1)).toBe('not-a-day')
    expect(daysBetween('2026-02-29', '2026-03-01')).toBeNull()
  })

  it('steps days across month and year boundaries', () => {
    expect(addDaysToDayKey('2026-08-31', 1)).toBe('2026-09-01')
    expect(previousDayKey('2026-01-01')).toBe('2025-12-31')
    expect(previousDayKey('2024-03-01')).toBe('2024-02-29')
    expect(daysBetween('2026-09-01', '2026-09-16')).toBe(15)
  })
})

describe('instant <-> calendar day', () => {
  // The one-line error periods.ts warns about: 7pm Jan 31 in New York is
  // already Feb 1 in UTC, and posting it to February cannot be undone once
  // the period locks.
  it('places an instant on the day the BOOK zone says, not UTC', () => {
    const lateJanuary = new Date('2026-02-01T00:30:00.000Z')
    expect(dayKeyInZone(lateJanuary, 'UTC')).toBe('2026-02-01')
    expect(dayKeyInZone(lateJanuary, 'America/New_York')).toBe('2026-01-31')
  })

  it('opens a day at the zone’s own midnight', () => {
    expect(startOfDayInstant('2026-09-16', 'UTC').toISOString()).toBe('2026-09-16T00:00:00.000Z')
    expect(startOfDayInstant('2026-09-16', 'America/New_York').toISOString()).toBe(
      '2026-09-16T04:00:00.000Z'
    )
  })

  // Hand-rolled offset arithmetic gets this wrong twice a year.
  it('crosses a DST boundary without slipping an hour into the wrong day', () => {
    // US DST began 2026-03-08. March opens at -05:00, April at -04:00.
    expect(startOfMonthInstant('2026-03', 'America/New_York').toISOString()).toBe(
      '2026-03-01T05:00:00.000Z'
    )
    expect(startOfMonthInstant('2026-04', 'America/New_York').toISOString()).toBe(
      '2026-04-01T04:00:00.000Z'
    )
  })

  it('reads today in the zone it is given', () => {
    const justAfterUtcMidnight = new Date('2026-09-16T00:10:00.000Z')
    expect(todayInZone('UTC', justAfterUtcMidnight)).toBe('2026-09-16')
    expect(todayInZone('America/Los_Angeles', justAfterUtcMidnight)).toBe('2026-09-15')
  })
})

describe('calendar widgets', () => {
  it('round-trips a picked day through a local Date without slipping', () => {
    expect(dayKeyOfLocalDate(localDateOfDayKey('2026-09-16'))).toBe('2026-09-16')
    expect(dayKeyOfLocalDate(localDateOfDayKey('2026-01-01'))).toBe('2026-01-01')
    expect(dayKeyOfLocalDate(localDateOfDayKey('2026-12-31'))).toBe('2026-12-31')
  })
})
