// packages/lib/src/recurrence/expand.test.ts
//
// Coverage per plans/dispatch/06-recurring-engine.md §5.1: weekly multi-weekday, biweekly
// anchor alignment, monthly day-31 clamping, nth/-1 weekday, until inclusive edge, count
// consumption via `countConsumed`, DST spring/fall wall-clock stability, daily with interval.
// Non-DST cases use `timezone: 'UTC'` so expected UTC instants equal the local wall clock
// directly; the DST cases use `America/New_York` around the real 2026 transition dates.

import { toZonedTime } from 'date-fns-tz'
import { describe, expect, it } from 'vitest'
import { expandOccurrences } from './expand'
import type { RecurrencePattern } from './types'

const STARTS_AT_9AM = 9 * 60

function dateKeys(occurrences: { occurrenceDate: string }[]): string[] {
  return occurrences.map((o) => o.occurrenceDate)
}

describe('expandOccurrences — weekly', () => {
  it('returns every occurrence of each selected weekday', () => {
    const pattern: RecurrencePattern = { frequency: 'weekly', interval: 1, weekdays: [2, 4] }
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-06', // Tuesday
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-01-21T23:59:59Z'),
      startMinute: STARTS_AT_9AM,
    })

    expect(dateKeys(result)).toEqual([
      '2026-01-06',
      '2026-01-08',
      '2026-01-13',
      '2026-01-15',
      '2026-01-20',
    ])
    for (const occurrence of result) {
      expect(occurrence.start.toISOString().slice(11, 16)).toBe('09:00')
    }
  })

  it('excludes weekdays before the anchor within its own week', () => {
    // Anchor is a Thursday; a Tuesday in the same week must NOT appear before it.
    const pattern: RecurrencePattern = { frequency: 'weekly', interval: 1, weekdays: [2, 4] }
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-08', // Thursday
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-01-10T23:59:59Z'),
      startMinute: STARTS_AT_9AM,
    })

    expect(dateKeys(result)).toEqual(['2026-01-08'])
  })
})

describe('expandOccurrences — biweekly anchor alignment', () => {
  it('counts interval weeks from the week containing the anchor', () => {
    const pattern: RecurrencePattern = { frequency: 'weekly', interval: 2, weekdays: [2] }
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-06', // Tuesday, week 0
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-02-28T23:59:59Z'),
      startMinute: STARTS_AT_9AM,
    })

    // Every OTHER Tuesday starting at the anchor — 01-13, 01-27, 02-10, 02-24 must be skipped.
    expect(dateKeys(result)).toEqual(['2026-01-06', '2026-01-20', '2026-02-03', '2026-02-17'])
  })
})

describe('expandOccurrences — monthly day clamping', () => {
  it('clamps monthDay 31 to the last day of short months', () => {
    const pattern: RecurrencePattern = { frequency: 'monthly', interval: 1, monthDay: 31 }
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-31',
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-04-30T23:59:59Z'),
      startMinute: STARTS_AT_9AM,
    })

    // 2026 is not a leap year — Feb clamps to 28.
    expect(dateKeys(result)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })
})

describe('expandOccurrences — monthly nth weekday', () => {
  it('resolves the nth weekday of each aligned month', () => {
    const pattern: RecurrencePattern = {
      frequency: 'monthly',
      interval: 1,
      nthWeekday: { nth: 2, weekday: 2 }, // 2nd Tuesday
    }
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-01',
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-03-31T23:59:59Z'),
      startMinute: STARTS_AT_9AM,
    })

    expect(dateKeys(result)).toEqual(['2026-01-13', '2026-02-10', '2026-03-10'])
  })

  it('resolves nth: -1 to the LAST weekday of the month', () => {
    const pattern: RecurrencePattern = {
      frequency: 'monthly',
      interval: 1,
      nthWeekday: { nth: -1, weekday: 5 }, // last Friday
    }
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-01',
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-03-31T23:59:59Z'),
      startMinute: STARTS_AT_9AM,
    })

    expect(dateKeys(result)).toEqual(['2026-01-30', '2026-02-27', '2026-03-27'])
  })
})

describe('expandOccurrences — until (inclusive)', () => {
  it('includes the occurrence ON the until date and excludes anything after', () => {
    const pattern: RecurrencePattern = { frequency: 'daily', interval: 1, until: '2026-01-10' }
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-01',
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-01-15T23:59:59Z'),
      startMinute: STARTS_AT_9AM,
    })

    expect(dateKeys(result)).toHaveLength(10)
    expect(dateKeys(result).at(-1)).toBe('2026-01-10')
  })
})

describe('expandOccurrences — count consumption', () => {
  const pattern: RecurrencePattern = { frequency: 'daily', interval: 1, count: 5 }

  it('emits the first N occurrences from the anchor when nothing is consumed yet', () => {
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-01',
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-01-10T23:59:59Z'),
      startMinute: STARTS_AT_9AM,
    })

    expect(dateKeys(result)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
    ])
  })

  it('stops after count - countConsumed more, using countConsumed as authoritative', () => {
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-01',
      timezone: 'UTC',
      from: new Date('2026-01-04T00:00:00Z'),
      to: new Date('2026-01-10T23:59:59Z'),
      startMinute: STARTS_AT_9AM,
      countConsumed: 3, // Jan 1-3 already materialized
    })

    expect(dateKeys(result)).toEqual(['2026-01-04', '2026-01-05'])
  })

  it('returns nothing once the count is fully consumed', () => {
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-01',
      timezone: 'UTC',
      from: new Date('2026-01-06T00:00:00Z'),
      to: new Date('2026-01-20T23:59:59Z'),
      startMinute: STARTS_AT_9AM,
      countConsumed: 5,
    })

    expect(result).toEqual([])
  })
})

describe('expandOccurrences — daily with interval', () => {
  it('fires every N days from the anchor', () => {
    const pattern: RecurrencePattern = { frequency: 'daily', interval: 3 }
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-01',
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-01-15T23:59:59Z'),
      startMinute: STARTS_AT_9AM,
    })

    expect(dateKeys(result)).toEqual([
      '2026-01-01',
      '2026-01-04',
      '2026-01-07',
      '2026-01-10',
      '2026-01-13',
    ])
  })
})

describe('expandOccurrences — DST wall-clock stability (America/New_York)', () => {
  it('keeps a 9:00 AM local rule at 9:00 AM local across the spring-forward transition', () => {
    // 2026 spring-forward: clocks jump 2:00 AM -> 3:00 AM on Sunday 2026-03-08 (EST -> EDT).
    const pattern: RecurrencePattern = { frequency: 'daily', interval: 1 }
    const result = expandOccurrences(pattern, {
      anchor: '2026-03-05',
      timezone: 'America/New_York',
      from: new Date('2026-03-04T00:00:00Z'),
      to: new Date('2026-03-11T00:00:00Z'),
      startMinute: STARTS_AT_9AM,
    })

    expect(dateKeys(result)).toEqual([
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ])
    for (const occurrence of result) {
      const local = toZonedTime(occurrence.start, 'America/New_York')
      expect([local.getHours(), local.getMinutes()]).toEqual([9, 0])
    }
    // EST (UTC-5) before the transition, EDT (UTC-4) on/after it.
    expect(result[0]?.start.toISOString()).toBe('2026-03-05T14:00:00.000Z')
    expect(result.at(-1)?.start.toISOString()).toBe('2026-03-10T13:00:00.000Z')
  })

  it('keeps a 9:00 AM local rule at 9:00 AM local across the fall-back transition', () => {
    // 2026 fall-back: clocks fall 2:00 AM -> 1:00 AM on Sunday 2026-11-01 (EDT -> EST).
    const pattern: RecurrencePattern = { frequency: 'daily', interval: 1 }
    const result = expandOccurrences(pattern, {
      anchor: '2026-10-29',
      timezone: 'America/New_York',
      from: new Date('2026-10-28T00:00:00Z'),
      to: new Date('2026-11-04T00:00:00Z'),
      startMinute: STARTS_AT_9AM,
    })

    expect(dateKeys(result)).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ])
    for (const occurrence of result) {
      const local = toZonedTime(occurrence.start, 'America/New_York')
      expect([local.getHours(), local.getMinutes()]).toEqual([9, 0])
    }
    // EDT (UTC-4) before the transition, EST (UTC-5) on/after it.
    expect(result[0]?.start.toISOString()).toBe('2026-10-29T13:00:00.000Z')
    expect(result.at(-1)?.start.toISOString()).toBe('2026-11-03T14:00:00.000Z')
  })
})

describe('expandOccurrences — window edges', () => {
  it('returns nothing when from is after to', () => {
    const pattern: RecurrencePattern = { frequency: 'daily', interval: 1 }
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-01',
      timezone: 'UTC',
      from: new Date('2026-01-10T00:00:00Z'),
      to: new Date('2026-01-01T00:00:00Z'),
      startMinute: STARTS_AT_9AM,
    })

    expect(result).toEqual([])
  })

  it('only returns occurrences whose start intersects [from, to]', () => {
    const pattern: RecurrencePattern = { frequency: 'daily', interval: 1 }
    const result = expandOccurrences(pattern, {
      anchor: '2026-01-01',
      timezone: 'UTC',
      from: new Date('2026-01-05T09:00:00Z'),
      to: new Date('2026-01-08T09:00:00Z'),
      startMinute: STARTS_AT_9AM,
    })

    expect(dateKeys(result)).toEqual(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'])
  })
})
