// packages/ui/src/components/calendar/utils.test.ts

import { describe, expect, it } from 'vitest'
import {
  getMonthWeeks,
  isDayDisabled,
  isInRange,
  isRangeEnd,
  isRangeStart,
  toDayKey,
} from './utils'

describe('getMonthWeeks', () => {
  it('covers a 5-week month (July 2026) with weekStartsOn=0 (Sunday)', () => {
    // July 2026: Jul 1 is a Wednesday, Jul 31 is a Friday.
    const weeks = getMonthWeeks(new Date(2026, 6, 15), 0)
    expect(weeks).toHaveLength(5)
    expect(weeks[0]?.[0]).toEqual(new Date(2026, 5, 28)) // leading Sunday from June
    expect(weeks.at(-1)?.[6]).toEqual(new Date(2026, 7, 1)) // trailing Saturday into August
    for (const week of weeks) expect(week).toHaveLength(7)
  })

  it('covers a 6-week month (August 2026) with weekStartsOn=0 (Sunday)', () => {
    // August 2026: Aug 1 is a Saturday, Aug 31 is a Monday — spans 6 grid rows.
    const weeks = getMonthWeeks(new Date(2026, 7, 15), 0)
    expect(weeks).toHaveLength(6)
    expect(weeks[0]?.[0]).toEqual(new Date(2026, 6, 26))
    expect(weeks.at(-1)?.[6]).toEqual(new Date(2026, 8, 5))
  })

  it('covers a 4-week month (February 2026, non-leap) with weekStartsOn=0 (Sunday)', () => {
    // Feb 2026: Feb 1 is a Sunday, Feb 28 is a Saturday — with Sunday start this is
    // exactly 4 full weeks, no overflow into Jan/Mar.
    const weeks = getMonthWeeks(new Date(2026, 1, 10), 0)
    expect(weeks).toHaveLength(4)
    expect(weeks[0]?.[0]).toEqual(new Date(2026, 1, 1))
    expect(weeks.at(-1)?.[6]).toEqual(new Date(2026, 1, 28))
  })

  it('shifts the leading/trailing days when weekStartsOn changes', () => {
    const sundayStart = getMonthWeeks(new Date(2026, 6, 15), 0)
    const mondayStart = getMonthWeeks(new Date(2026, 6, 15), 1)
    // July 1 2026 is a Wednesday: Sunday-start week begins Jun 28, Monday-start begins Jun 29.
    expect(sundayStart[0]?.[0]).toEqual(new Date(2026, 5, 28))
    expect(mondayStart[0]?.[0]).toEqual(new Date(2026, 5, 29))
  })

  it('every row is exactly 7 consecutive days', () => {
    const weeks = getMonthWeeks(new Date(2026, 7, 15), 0)
    for (const week of weeks) {
      for (let i = 1; i < week.length; i++) {
        const prev = week[i - 1] as Date
        const day = week[i] as Date
        expect(day.getTime() - prev.getTime()).toBe(24 * 60 * 60 * 1000)
      }
    }
  })
})

describe('toDayKey', () => {
  it('formats as yyyy-MM-dd', () => {
    expect(toDayKey(new Date(2026, 6, 4))).toBe('2026-07-04')
    expect(toDayKey(new Date(2026, 0, 1))).toBe('2026-01-01')
  })
})

describe('isInRange / isRangeStart / isRangeEnd', () => {
  const from = new Date(2026, 6, 10)
  const to = new Date(2026, 6, 15)

  it('isInRange is false when `to` is unset', () => {
    expect(isInRange(new Date(2026, 6, 10), { from })).toBe(false)
    expect(isInRange(new Date(2026, 6, 12), { from })).toBe(false)
  })

  it('isInRange is inclusive of both endpoints', () => {
    expect(isInRange(from, { from, to })).toBe(true)
    expect(isInRange(to, { from, to })).toBe(true)
    expect(isInRange(new Date(2026, 6, 12), { from, to })).toBe(true)
  })

  it('isInRange is false outside the range', () => {
    expect(isInRange(new Date(2026, 6, 9), { from, to })).toBe(false)
    expect(isInRange(new Date(2026, 6, 16), { from, to })).toBe(false)
  })

  it('isInRange ignores time-of-day (day granularity)', () => {
    const fromWithTime = new Date(2026, 6, 10, 23, 59)
    const toWithTime = new Date(2026, 6, 15, 0, 1)
    expect(isInRange(new Date(2026, 6, 10, 0, 0), { from: fromWithTime, to: toWithTime })).toBe(
      true
    )
  })

  it('isRangeStart matches `from` regardless of `to`', () => {
    expect(isRangeStart(from, { from })).toBe(true)
    expect(isRangeStart(from, { from, to })).toBe(true)
    expect(isRangeStart(to, { from, to })).toBe(false)
  })

  it('isRangeEnd is false while `to` is unset, true when it matches', () => {
    expect(isRangeEnd(from, { from })).toBe(false)
    expect(isRangeEnd(to, { from, to })).toBe(true)
    expect(isRangeEnd(from, { from, to })).toBe(false)
  })

  it('a single-day range (from === to) is both start and end', () => {
    const range = { from, to: from }
    expect(isRangeStart(from, range)).toBe(true)
    expect(isRangeEnd(from, range)).toBe(true)
  })
})

describe('isDayDisabled', () => {
  const date = new Date(2026, 6, 15)

  it('is false with no constraints', () => {
    expect(isDayDisabled(date, {})).toBe(false)
  })

  it('honors a custom predicate', () => {
    expect(isDayDisabled(date, { disabled: (d) => d.getDay() === 3 })).toBe(true) // Wed
    expect(isDayDisabled(new Date(2026, 6, 16), { disabled: (d) => d.getDay() === 3 })).toBe(false)
  })

  it('disables days before minDate (day granularity, inclusive of minDate itself)', () => {
    const minDate = new Date(2026, 6, 15)
    expect(isDayDisabled(new Date(2026, 6, 14), { minDate })).toBe(true)
    expect(isDayDisabled(new Date(2026, 6, 15), { minDate })).toBe(false)
    expect(
      isDayDisabled(new Date(2026, 6, 15, 0, 0, 0), { minDate: new Date(2026, 6, 15, 12) })
    ).toBe(false)
  })

  it('disables days after maxDate (day granularity, inclusive of maxDate itself)', () => {
    const maxDate = new Date(2026, 6, 15)
    expect(isDayDisabled(new Date(2026, 6, 16), { maxDate })).toBe(true)
    expect(isDayDisabled(new Date(2026, 6, 15), { maxDate })).toBe(false)
    expect(
      isDayDisabled(new Date(2026, 6, 15, 23, 59), { maxDate: new Date(2026, 6, 15, 0, 0) })
    ).toBe(false)
  })

  it('combines predicate and min/max — any true wins', () => {
    expect(isDayDisabled(date, { disabled: () => false, minDate: new Date(2026, 6, 20) })).toBe(
      true
    )
  })
})
