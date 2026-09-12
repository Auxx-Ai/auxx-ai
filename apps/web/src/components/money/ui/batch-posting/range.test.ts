// apps/web/src/components/money/ui/batch-posting/range.test.ts
//
// plans/accounting/tasks/25-batch-posting-and-credit-memos.md §6.1 and
// acceptance item 6: the control is INCLUSIVE at both ends, the wire is
// half-open, and the conversion is the only place that knows.
//
// §6.1 is emphatic that the original "March 31 is missing" report was NOT a
// timezone bug - the range really is `from <= x < to` and the label said so.
// These tests pin the fix so the exclusive end can never leak back into the UI.

import { describe, expect, it } from 'vitest'
import {
  dayKeyOf,
  dayRangeToWire,
  lastMonthKey,
  monthRangeToWire,
  nextDayKey,
  nextMonthKey,
  startOfLastMonthDayKey,
} from './range'

describe('nextDayKey', () => {
  it('rolls a month boundary', () => {
    expect(nextDayKey('2026-03-31')).toBe('2026-04-01')
  })

  it('rolls a year boundary', () => {
    expect(nextDayKey('2026-12-31')).toBe('2027-01-01')
  })

  it('handles a leap day', () => {
    expect(nextDayKey('2028-02-28')).toBe('2028-02-29')
    expect(nextDayKey('2028-02-29')).toBe('2028-03-01')
    expect(nextDayKey('2026-02-28')).toBe('2026-03-01')
  })

  it('returns a malformed key untouched rather than inventing a date', () => {
    expect(nextDayKey('nonsense')).toBe('nonsense')
  })
})

describe('nextMonthKey', () => {
  it('rolls December into the next year', () => {
    expect(nextMonthKey('2026-12')).toBe('2027-01')
  })

  it('pads a single-digit month', () => {
    expect(nextMonthKey('2026-08')).toBe('2026-09')
  })

  it('returns a malformed key untouched', () => {
    expect(nextMonthKey('2026')).toBe('2026')
  })
})

// The acceptance test itself.
describe('monthRangeToWire, acceptance item 6', () => {
  it('a month picked as January yields a range that INCLUDES January 31', () => {
    const wire = monthRangeToWire('2026-01', '2026-01')

    expect(wire).toEqual({ from: '2026-01-01', to: '2026-02-01' })
    // Half-open: `from <= issuedAt < to`, so the 31st is in and the 1st is not.
    expect('2026-01-31' >= wire.from && '2026-01-31' < wire.to).toBe(true)
    expect('2026-02-01' < wire.to).toBe(false)
  })

  it('January through March includes March 31, the original report', () => {
    const wire = monthRangeToWire('2026-01', '2026-03')

    expect(wire).toEqual({ from: '2026-01-01', to: '2026-04-01' })
    expect('2026-03-31' < wire.to).toBe(true)
  })

  it('a December range rolls into the next year', () => {
    expect(monthRangeToWire('2026-11', '2026-12')).toEqual({
      from: '2026-11-01',
      to: '2027-01-01',
    })
  })

  it('two consecutive month runs tile without overlapping', () => {
    const jan = monthRangeToWire('2026-01', '2026-01')
    const feb = monthRangeToWire('2026-02', '2026-02')

    expect(jan.to).toBe(feb.from)
  })
})

describe('dayRangeToWire', () => {
  it('includes the end day the person picked', () => {
    const wire = dayRangeToWire('2026-03-01', '2026-03-31')

    expect(wire).toEqual({ from: '2026-03-01', to: '2026-04-01' })
    expect('2026-03-31' < wire.to).toBe(true)
  })

  it('a single day is a one-day window, not an empty one', () => {
    const wire = dayRangeToWire('2026-03-31', '2026-03-31')

    expect(wire).toEqual({ from: '2026-03-31', to: '2026-04-01' })
    expect(wire.from < wire.to).toBe(true)
  })

  it('two consecutive day runs tile without overlapping', () => {
    expect(dayRangeToWire('2026-03-01', '2026-03-01').to).toBe(
      dayRangeToWire('2026-03-02', '2026-03-02').from
    )
  })
})

describe('dayKeyOf', () => {
  // §6.1: local getFullYear/getMonth/getDate, the same rule `toCalendarDayIso`
  // uses. What somebody clicked on a calendar is the day they meant.
  it('reads the local calendar day, not the UTC instant', () => {
    expect(dayKeyOf(new Date(2026, 2, 31, 23, 30))).toBe('2026-03-31')
    expect(dayKeyOf(new Date(2026, 0, 1, 0, 15))).toBe('2026-01-01')
  })

  it('pads month and day', () => {
    expect(dayKeyOf(new Date(2026, 8, 5))).toBe('2026-09-05')
  })
})

describe('the default window a backlog run opens on', () => {
  it('startOfLastMonthDayKey rolls back across a year boundary', () => {
    expect(startOfLastMonthDayKey(new Date(2026, 0, 15))).toBe('2025-12-01')
  })

  it('lastMonthKey is that month', () => {
    expect(lastMonthKey(new Date(2026, 0, 15))).toBe('2025-12')
    expect(lastMonthKey(new Date(2026, 8, 11))).toBe('2026-08')
  })
})
