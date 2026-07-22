// apps/web/src/components/calendar/core/clipboard-offset.test.ts

import { describe, expect, it } from 'vitest'
import { computePasteTimes } from './clipboard-offset'
import type { CopiedVisitItem } from './clipboard-store'

function item(overrides: Partial<CopiedVisitItem> & { start: Date; end: Date }): CopiedVisitItem {
  return {
    kind: 'visit',
    visitId: overrides.visitId ?? 'visit-1',
    workOrderRecordId: overrides.workOrderRecordId ?? 'work-order:wo-1',
    title: overrides.title ?? 'Job',
    assigneeUserId: overrides.assigneeUserId ?? null,
    ...overrides,
  }
}

describe('computePasteTimes', () => {
  it('preserves multi-day relative structure (Mon+Wed pasted on Thu -> Thu+Sat)', () => {
    // 2024-01-01 is a Monday; 2024-01-03 a Wednesday; 2024-01-04 a Thursday.
    const monday = item({
      visitId: 'mon',
      start: new Date(2024, 0, 1, 9, 0),
      end: new Date(2024, 0, 1, 10, 0),
    })
    const wednesday = item({
      visitId: 'wed',
      start: new Date(2024, 0, 3, 13, 30),
      end: new Date(2024, 0, 3, 14, 30),
    })

    const results = computePasteTimes(
      [monday, wednesday],
      { day: new Date(2024, 0, 4) }, // Thursday
      { startAtSlot: false }
    )

    const byId = new Map(results.map((r) => [r.item.visitId, r]))
    const monResult = byId.get('mon')!
    const wedResult = byId.get('wed')!

    // Mon -> Thu (Jan 4), Wed -> Sat (Jan 6) — the +3 day delta from the earliest item.
    expect(monResult.startTime).toEqual(new Date(2024, 0, 4, 9, 0))
    expect(monResult.endTime).toEqual(new Date(2024, 0, 4, 10, 0))
    expect(wedResult.startTime).toEqual(new Date(2024, 0, 6, 13, 30))
    expect(wedResult.endTime).toEqual(new Date(2024, 0, 6, 14, 30))
  })

  it('preserves each item duration', () => {
    const shortVisit = item({
      visitId: 'short',
      start: new Date(2024, 0, 1, 9, 0),
      end: new Date(2024, 0, 1, 9, 45),
    })
    const longVisit = item({
      visitId: 'long',
      start: new Date(2024, 0, 1, 12, 0),
      end: new Date(2024, 0, 1, 14, 0),
    })

    const results = computePasteTimes(
      [shortVisit, longVisit],
      { day: new Date(2024, 0, 10) },
      { startAtSlot: false }
    )

    for (const result of results) {
      const original = result.item.visitId === 'short' ? shortVisit : longVisit
      const originalDuration = original.end.getTime() - original.start.getTime()
      const pastedDuration = result.endTime.getTime() - result.startTime.getTime()
      expect(pastedDuration).toBe(originalDuration)
    }
  })

  it('shifts every item so the earliest starts at the clicked slot time, keeping relative offsets', () => {
    const first = item({
      visitId: 'first',
      start: new Date(2024, 0, 1, 9, 0),
      end: new Date(2024, 0, 1, 10, 0),
    })
    const second = item({
      visitId: 'second',
      start: new Date(2024, 0, 1, 11, 0), // 2h after `first`'s start
      end: new Date(2024, 0, 1, 11, 30),
    })

    const results = computePasteTimes(
      [first, second],
      { day: new Date(2024, 0, 5), time: new Date(2024, 0, 5, 14, 0) },
      { startAtSlot: true }
    )

    const byId = new Map(results.map((r) => [r.item.visitId, r]))
    const firstResult = byId.get('first')!
    const secondResult = byId.get('second')!

    // Earliest item lands exactly on the slot time.
    expect(firstResult.startTime).toEqual(new Date(2024, 0, 5, 14, 0))
    // The second item keeps its original 2h offset from the first.
    expect(secondResult.startTime).toEqual(new Date(2024, 0, 5, 16, 0))
    // Durations stay intact under the extra shift too.
    expect(firstResult.endTime.getTime() - firstResult.startTime.getTime()).toBe(60 * 60_000)
    expect(secondResult.endTime.getTime() - secondResult.startTime.getTime()).toBe(30 * 60_000)
  })

  it('ignores startAtSlot when the target carries no time (month-view / day-only paste)', () => {
    const visit = item({
      visitId: 'v',
      start: new Date(2024, 0, 1, 9, 0),
      end: new Date(2024, 0, 1, 10, 0),
    })

    const results = computePasteTimes([visit], { day: new Date(2024, 0, 8) }, { startAtSlot: true })

    expect(results[0]!.startTime).toEqual(new Date(2024, 0, 8, 9, 0))
  })

  it('returns an empty array for an empty clipboard', () => {
    expect(computePasteTimes([], { day: new Date() }, { startAtSlot: false })).toEqual([])
  })
})
