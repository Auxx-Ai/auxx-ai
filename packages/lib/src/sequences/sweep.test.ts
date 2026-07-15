// packages/lib/src/sequences/sweep.test.ts
// Unit tests for the hourly enrollment sweep's lookahead-window math (client-notifications
// plan §4.3 — `N = abs(min(anchorOffsetDays over steps)) + 2` days, floor 3). Pure function,
// no I/O — mirrors `anchor.test.ts`'s convention.

import { describe, expect, it } from 'vitest'
import { computeSweepLookaheadDays } from './sweep'

describe('computeSweepLookaheadDays', () => {
  it('floors at 3 days when there are no anchor steps', () => {
    expect(computeSweepLookaheadDays([])).toBe(3)
  })

  it('floors at 3 days when every anchor offset is small/positive', () => {
    expect(computeSweepLookaheadDays([0])).toBe(3)
    expect(computeSweepLookaheadDays([1, 2])).toBe(3)
  })

  it('is abs(most negative offset) + 2 for the default -2d reminder', () => {
    // visit_reminders' seeded steps: -2d, 0d — most negative is -2.
    expect(computeSweepLookaheadDays([-2, 0])).toBe(4)
  })

  it('widens correctly for a template edited to a further-out reminder', () => {
    expect(computeSweepLookaheadDays([-10, -2, 0])).toBe(12)
  })

  it('ignores positive offsets when computing the negative floor', () => {
    expect(computeSweepLookaheadDays([-2, 3, 10])).toBe(4)
  })

  it('treats an all-positive-offset sequence as the 3-day floor, not a negative one', () => {
    // Math.min(...offsets, 0) always includes 0, so a template with only future-side anchors
    // (e.g. an invoice "overdue"/"still outstanding" sequence) never goes negative.
    expect(computeSweepLookaheadDays([3, 10])).toBe(3)
  })
})
